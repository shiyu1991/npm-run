import * as vscode from 'vscode';
import { parseProjects, PackageFileInput } from './scanFilter';
import { detectPackageManager } from './builtins';
import { NpmProject } from './types';

/** 判定包管理器用的 lockfile（组合 glob 一次扫描，避免逐目录 stat） */
const LOCKFILE_GLOB = '**/{pnpm-lock.yaml,yarn.lock,package-lock.json}';

/** 目录键：忽略大小写与斜杠方向差异（Windows 盘符大小写不稳定） */
const dirKey = (p: string): string => p.replace(/\\/g, '/').toLowerCase();

const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.git/**',
  '**/coverage/**',
];

/** 扫描工作区 npm 项目，监听 package.json 变更自动刷新 */
export class ProjectScanner {
  private _projects: NpmProject[] = [];
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private pending: Promise<void> = Promise.resolve();
  private debounceTimer: NodeJS.Timeout | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly debounceMs = 500) {}

  get projects(): readonly NpmProject[] {
    return this._projects;
  }

  async refresh(): Promise<void> {
    // 串行化：并发调用排队执行，避免竞态（后发先至导致旧数据覆盖新数据）
    this.pending = this.pending.then(() => this.doRefresh());
    return this.pending;
  }

  private async doRefresh(): Promise<void> {
    const exclude = vscode.workspace
      .getConfiguration('npm-run')
      .get<string[]>('exclude', DEFAULT_EXCLUDE);
    // findFiles 的 exclude 是单个 glob，用 {} 组合多个模式
    const excludeGlob = exclude.length > 0 ? `{${exclude.join(',')}}` : undefined;
    const uris = await vscode.workspace.findFiles('**/package.json', excludeGlob);

    const files: PackageFileInput[] = [];
    for (const uri of uris) {
      try {
        const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        files.push({ dir: vscode.Uri.joinPath(uri, '..').fsPath, content });
      } catch {
        // 文件读取失败（权限/竞争删除）跳过
      }
    }

    // 按目录聚合 lockfile 名，用于判定各项目实际使用的包管理器
    const lockUris = await vscode.workspace.findFiles(LOCKFILE_GLOB, excludeGlob);
    const lockfiles = new Map<string, string[]>();
    for (const uri of lockUris) {
      const dir = dirKey(vscode.Uri.joinPath(uri, '..').fsPath);
      const name = uri.path.split('/').pop() ?? '';
      const list = lockfiles.get(dir);
      if (list) {
        list.push(name);
      } else {
        lockfiles.set(dir, [name]);
      }
    }

    this._projects = parseProjects(files).map((lite) => {
      const dir = vscode.Uri.file(lite.dir);
      return {
        name: lite.name,
        dir,
        packageJsonUri: vscode.Uri.joinPath(dir, 'package.json'),
        scripts: lite.scripts,
        packageManager: detectPackageManager(lockfiles.get(dirKey(lite.dir)) ?? []),
      };
    });
    this._onDidChange.fire();
  }

  /** 监听 package.json 增删改，自动刷新（防抖 + 排除 node_modules，防 npm install 刷新风暴） */
  watch(): vscode.Disposable {
    const watcher = vscode.workspace.createFileSystemWatcher('**/package.json');
    // 引擎兼容 1.85：watcher 无 exclude 参数，回调内过滤 node_modules 等目录的海量变更
    const ignored = (uri: vscode.Uri): boolean =>
      /\/(node_modules|dist|build|out|coverage)\//.test(uri.path) || uri.path.includes('/.git/');
    const debounced = (uri: vscode.Uri) => {
      if (ignored(uri)) {
        return;
      }
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = undefined;
        void this.refresh();
      }, this.debounceMs);
    };
    this.disposables.push(
      watcher.onDidCreate(debounced),
      watcher.onDidChange(debounced),
      watcher.onDidDelete(debounced)
    );
    return new vscode.Disposable(() => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      for (const d of this.disposables) {
        d.dispose();
      }
      this.disposables.length = 0;
    });
  }
}
