import * as vscode from 'vscode';
import { NpmProject, RunningScript, ExternalState } from './types';
import { t } from './i18n';

export type TreeNode =
  | { kind: 'project'; project: NpmProject }
  | {
      kind: 'script';
      project: NpmProject;
      script: string;
      command: string;
      instance?: RunningScript;
      external?: ExternalState;
    }
  | { kind: 'service'; project: NpmProject; script: string; instance: RunningScript; port: number }
  | { kind: 'external-port'; project: NpmProject; script: string; state: ExternalState; port: number };

/** 树数据提供者：项目 → 脚本 → 服务（IP:端口）/ 外部端口（只读） */
export class NpmRunTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly scanner: { projects: readonly NpmProject[] },
    private readonly instances: Map<string, RunningScript>,
    private readonly keyOf: (project: NpmProject, script: string) => string,
    /** 外部运行检测结果（key 与 instances 同构）；保持单实例引用，refresh 时 clear+set */
    private readonly externalRunning: Map<string, ExternalState>
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
      item.description = t.scriptsCount(node.project.scripts.size);
      item.tooltip = node.project.dir.fsPath;
      item.contextValue = 'project';
      return item;
    }

    if (node.kind === 'script') {
      // 状态判定链：自身实例优先于外部检测（实例在跑时外部条目已被清除，双保险）
      const running = node.instance !== undefined;
      const ext = node.external;
      const item = new vscode.TreeItem(
        node.script,
        running
          ? vscode.TreeItemCollapsibleState.Expanded
          : ext && ext.hit.ports.length > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None
      );
      if (running) {
        const adoptedOnly = node.instance?.adoptedOnly === true;
        item.contextValue = 'script-running';
        item.description = adoptedOnly ? t.adopted : t.running;
        item.tooltip = `npm run ${node.script}${
          adoptedOnly ? t.scriptTooltipAdopted : t.scriptTooltipRunning(node.instance!.rootPid)
        }\n${node.command}`;
        item.iconPath = new vscode.ThemeIcon('sync~spin');
        item.command = { command: 'npm-run.showOutput', title: t.showOutput, arguments: [node] };
      } else if (ext) {
        const evidencePid = ext.hit.pids[0];
        item.contextValue = 'script-external';
        item.description = t.externalRunning(evidencePid);
        item.tooltip = `npm run ${node.script}\n${node.command}\n${t.externalTooltip(
          ext.hit.cmdline,
          new Date(ext.detectedAt).toLocaleTimeString()
        )}`;
        item.iconPath = new vscode.ThemeIcon('circle-filled');
        // 点击外部行 = 重新检测（快照式状态的天然更新入口）
        item.command = { command: 'npm-run.refresh', title: t.refreshTitle };
      } else {
        item.contextValue = 'script';
        item.description = node.command;
        item.tooltip = `npm run ${node.script}\n${node.command}`;
        item.iconPath = new vscode.ThemeIcon('terminal');
        item.command = { command: 'npm-run.runScript', title: t.runScript, arguments: [node] };
      }
      return item;
    }

    if (node.kind === 'service') {
      const svc = node.instance.services.get(node.port);
      const label = svc ? svc.addresses.map((a) => `${a}:${svc.port}`).join(' · ') : String(node.port);
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('radio-tower');
      item.contextValue = svc?.isRoot ? 'service-root' : 'service';
      item.description = svc ? `PID ${svc.pid}` : undefined;
      item.tooltip = svc
        ? t.serviceTooltip(svc.port, svc.addresses.join(', '), svc.pid) +
          (svc.isRoot ? t.serviceTooltipRoot : t.serviceTooltipChild)
        : undefined;
      return item;
    }

    // external-port：外部进程监听的端口，只读展示
    const portInfo = node.state.hit.ports.find((p) => p.port === node.port);
    const label = portInfo
      ? portInfo.addresses.map((a) => `${a}:${portInfo.port}`).join(' · ')
      : String(node.port);
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('radio-tower');
    item.contextValue = 'external-port';
    item.description = portInfo ? `PID ${portInfo.pid}` : undefined;
    item.tooltip = portInfo
      ? t.externalPortTooltip(portInfo.port, portInfo.addresses.join(', '), portInfo.pid)
      : undefined;
    return item;
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) {
      return this.scanner.projects.map((project) => ({ kind: 'project', project }));
    }
    if (node.kind === 'project') {
      return [...node.project.scripts.entries()].map(([script, command]) => {
        const key = this.keyOf(node.project, script);
        return {
          kind: 'script' as const,
          project: node.project,
          script,
          command,
          instance: this.instances.get(key),
          external: this.instances.has(key) ? undefined : this.externalRunning.get(key),
        };
      });
    }
    if (node.kind === 'script') {
      const inst = node.instance;
      if (inst) {
        // 按端口升序，diff 重建 Map 后顺序仍稳定
        return [...inst.services.keys()].sort((a, b) => a - b).map((port) => ({
          kind: 'service' as const,
          project: node.project,
          script: node.script,
          instance: inst,
          port,
        }));
      }
      const ext = node.external;
      if (ext) {
        return ext.hit.ports.map((p) => ({
          kind: 'external-port' as const,
          project: node.project,
          script: node.script,
          state: ext,
          port: p.port,
        }));
      }
      return [];
    }
    return [];
  }
}
