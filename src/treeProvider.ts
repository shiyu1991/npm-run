import * as vscode from 'vscode';
import { NpmProject, RunningScript } from './types';

export type TreeNode =
  | { kind: 'project'; project: NpmProject }
  | { kind: 'script'; project: NpmProject; script: string; command: string; instance?: RunningScript }
  | { kind: 'service'; project: NpmProject; script: string; instance: RunningScript; port: number };

/** 树数据提供者：项目 → 脚本 → 服务（IP:端口） */
export class NpmRunTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly scanner: { projects: readonly NpmProject[] },
    private readonly instances: Map<string, RunningScript>,
    private readonly keyOf: (project: NpmProject, script: string) => string
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === 'project') {
      const item = new vscode.TreeItem(
        node.project.name,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.iconPath = new vscode.ThemeIcon('package');
      item.description = `${node.project.scripts.size} 个脚本`;
      item.tooltip = node.project.dir.fsPath;
      item.contextValue = 'project';
      return item;
    }

    if (node.kind === 'script') {
      const running = node.instance !== undefined;
      const adoptedOnly = node.instance?.adoptedOnly === true;
      const item = new vscode.TreeItem(
        node.script,
        running ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
      );
      item.contextValue = running ? 'script-running' : 'script';
      item.description = running ? (adoptedOnly ? '扩展代管' : '运行中') : node.command;
      item.tooltip = running
        ? `npm run ${node.script}${
            adoptedOnly ? '（脚本进程已退出，服务由扩展代管）' : `（PID ${node.instance!.rootPid}）`
          }\n${node.command}`
        : `npm run ${node.script}\n${node.command}`;
      item.iconPath = running
        ? new vscode.ThemeIcon('sync~spin')
        : new vscode.ThemeIcon('terminal');
      item.command = running
        ? { command: 'npm-run.showOutput', title: '查看输出', arguments: [node] }
        : { command: 'npm-run.runScript', title: '运行脚本', arguments: [node] };
      return item;
    }

    // service
    const svc = node.instance.services.get(node.port);
    const label = svc ? svc.addresses.map((a) => `${a}:${svc.port}`).join(' · ') : String(node.port);
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('radio-tower');
    item.contextValue = svc?.isRoot ? 'service-root' : 'service';
    item.description = svc ? `PID ${svc.pid}` : undefined;
    item.tooltip = svc
      ? `端口 ${svc.port}\n地址 ${svc.addresses.join(', ')}\n进程 PID ${svc.pid}` +
        (svc.isRoot
          ? '\n\n该服务由脚本主进程监听\n点击 ⟳ 重启整个脚本'
          : '\n点击 ⟳ 仅重启此服务\n点击 ✕ 结束此服务')
      : undefined;
    return item;
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) {
      return this.scanner.projects.map((project) => ({ kind: 'project', project }));
    }
    if (node.kind === 'project') {
      return [...node.project.scripts.entries()].map(([script, command]) => ({
        kind: 'script',
        project: node.project,
        script,
        command,
        instance: this.instances.get(this.keyOf(node.project, script)),
      }));
    }
    if (node.kind === 'script') {
      const inst = node.instance;
      if (!inst) {
        return [];
      }
      // 按端口升序，diff 重建 Map 后顺序仍稳定
      return [...inst.services.keys()].sort((a, b) => a - b).map((port) => ({
        kind: 'service' as const,
        project: node.project,
        script: node.script,
        instance: inst,
        port,
      }));
    }
    return [];
  }
}
