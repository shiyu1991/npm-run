import * as vscode from 'vscode';
import { NpmProject, RunningScript, ExternalState } from './types';
import { BuiltinCommand, builtinCommands, builtinKey, commandLine } from './builtins';
import { t } from './i18n';
import { isDependentWorker } from './respawnGuard';
import { ResolvedGroup, GroupMember, GroupProjectLike } from './launchGroups';

/** launchGroups 解析输入中的项目形态：raw 携带原始 NpmProject（extension 侧构造） */
export type LaunchGroupProject = GroupProjectLike & { raw: NpmProject };

export type TreeNode =
  | { kind: 'project'; project: NpmProject }
  | { kind: 'builtin-group'; project: NpmProject }
  | { kind: 'builtin'; project: NpmProject; command: BuiltinCommand; instance?: RunningScript }
  | {
      kind: 'script';
      project: NpmProject;
      script: string;
      command: string;
      instance?: RunningScript;
      external?: ExternalState;
    }
  | { kind: 'service'; project: NpmProject; script: string; instance: RunningScript; port: number }
  | { kind: 'external-port'; project: NpmProject; script: string; state: ExternalState; port: number }
  | { kind: 'launch-group'; group: ResolvedGroup<LaunchGroupProject> }
  | { kind: 'group-member'; groupName: string; member: GroupMember<LaunchGroupProject> };

/** 树数据提供者：项目 → 脚本 → 服务（IP:端口）/ 外部端口（只读） */
export class NpmRunTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly scanner: { projects: readonly NpmProject[] },
    private readonly instances: Map<string, RunningScript>,
    private readonly keyOf: (project: NpmProject, script: string) => string,
    /** 外部运行检测结果（key 与 instances 同构）；保持单实例引用，refresh 时 clear+set */
    private readonly externalRunning: Map<string, ExternalState>,
    /** 已学习"无法单独重启"的 cmdline（来自 runner 的 respawn 失败回写，会话级） */
    private readonly noRespawnCmdlines: ReadonlySet<string>,
    /** 已解析的启动组（每次渲染时读取最新配置，热更新自然生效） */
    private readonly groupsReader: () => readonly ResolvedGroup<LaunchGroupProject>[]
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === 'launch-group') {
      const unresolved = node.group.members.filter((m) => !m.project).length;
      const running = this.groupRunningCount(node.group);
      const item = new vscode.TreeItem(node.group.name, vscode.TreeItemCollapsibleState.Collapsed);
      // 组行状态聚合（对齐项目行模式）：运行中显示旋转图标 + 运行数，收起也一目了然
      item.description =
        (running > 0 ? `${t.projectRunning(running)} · ` : '') +
        t.scriptsCount(node.group.members.length) +
        (unresolved > 0 ? ` · ${t.groupUnresolved(unresolved)}` : '');
      if (running > 0) {
        item.iconPath = new vscode.ThemeIcon('sync~spin');
        item.contextValue = 'launch-group-running';
      } else {
        item.iconPath = new vscode.ThemeIcon('rocket');
        item.contextValue = 'launch-group';
      }
      const lines = node.group.members.map((m) => {
        if (!m.project) {
          return `⚠ ${m.ref}（${t.memberUnresolved}）`;
        }
        const live = m.script !== undefined && this.instances.has(this.keyOf(m.project.raw, m.script));
        return `${m.project.name} · ${m.script}${live ? ` ${t.running}` : ''}`;
      });
      item.tooltip = `${t.groupTooltipTitle(node.group.name)}\n${lines.join('\n')}`;
      return item;
    }

    if (node.kind === 'group-member') {
      const m = node.member;
      const resolved = m.project !== undefined && m.script !== undefined;
      const item = new vscode.TreeItem(
        resolved ? `${m.project!.name} · ${m.script}` : m.ref,
        vscode.TreeItemCollapsibleState.None
      );
      item.iconPath = new vscode.ThemeIcon('terminal');
      // 成员行运行态（对齐脚本行三态模式）：运行中 → 旋转图标 + 运行中 + 运行态菜单
      let live = false;
      if (resolved) {
        const inst = this.instances.get(this.keyOf(m.project!.raw, m.script!));
        if (inst) {
          live = true;
          item.description = t.running;
          item.iconPath = new vscode.ThemeIcon('sync~spin');
          item.contextValue = 'group-member-running';
        } else {
          item.contextValue = 'group-member';
        }
      } else {
        item.description = t.memberUnresolved;
        item.contextValue = 'group-member';
      }
      item.tooltip = m.ref + (resolved ? (live ? t.memberTooltip : t.memberTooltipIdle) : '');
      return item;
    }

    if (node.kind === 'project') {
      const running = this.runningCountOf(node.project);
      const item = new vscode.TreeItem(
        node.project.name,
        vscode.TreeItemCollapsibleState.Expanded
      );
      // 项目收起时也一眼可见：绿色圆点 + 运行中数量（运行脚本 × 各自服务数聚合）
      item.iconPath =
        running > 0
          ? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'))
          : new vscode.ThemeIcon('package');
      item.description =
        running > 0 ? t.projectRunning(running) : t.scriptsCount(node.project.scripts.size);
      item.tooltip =
        running > 0
          ? `${node.project.dir.fsPath}\n${t.projectRunningTip(running)}`
          : node.project.dir.fsPath;
      item.contextValue = 'project';
      return item;
    }

    if (node.kind === 'builtin-group') {
      // 默认折叠：常用命令是低频操作，不该挤占脚本列表
      const item = new vscode.TreeItem(
        t.builtinGroup,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.iconPath = new vscode.ThemeIcon('tools');
      item.description = t.builtinCount(builtinCommands(node.project.packageManager).length);
      item.tooltip = t.builtinGroupTooltip(node.project.packageManager);
      item.contextValue = 'builtin-group';
      return item;
    }

    if (node.kind === 'builtin') {
      const cmd = node.command;
      const full = commandLine(node.project.packageManager, cmd.args);
      const item = new vscode.TreeItem(cmd.label, vscode.TreeItemCollapsibleState.None);
      if (node.instance) {
        item.contextValue = 'builtin-running';
        item.description = t.running;
        item.tooltip = `${full}\n${t.scriptTooltipRunning(node.instance.rootPid)}`;
        item.iconPath = new vscode.ThemeIcon('sync~spin');
        item.command = { command: 'npm-run.showOutput', title: t.showOutput, arguments: [node] };
      } else {
        item.contextValue = 'builtin';
        item.description = full;
        item.tooltip = full;
        item.iconPath = new vscode.ThemeIcon('terminal');
        item.command = { command: 'npm-run.runScript', title: t.runScript, arguments: [node] };
      }
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
      // 依赖主进程的 worker（特征表命中或失败学习过）：单独重启必败，⟳ 置换为禁用图标
      const noRespawn = !!svc && !svc.isRoot && !!svc.cmdline && this.isNoRespawn(svc.cmdline);
      item.contextValue = svc?.isRoot
        ? 'service-root'
        : noRespawn
          ? 'service-norespawn'
          : 'service';
      item.description = svc ? `PID ${svc.pid}` : undefined;
      item.tooltip = svc
        ? t.serviceTooltip(svc.port, svc.addresses.join(', '), svc.pid) +
          (svc.isRoot
            ? t.serviceTooltipRoot
            : noRespawn
              ? t.serviceTooltipNoRespawn
              : t.serviceTooltipChild)
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
      // 启动组平铺在树顶（全局动作区），其后为各项目
      const groups = this.groupsReader().map((group) => ({ kind: 'launch-group' as const, group }));
      return [...groups, ...this.scanner.projects.map((project) => ({ kind: 'project' as const, project }))];
    }
    if (node.kind === 'launch-group') {
      return node.group.members.map((member) => ({
        kind: 'group-member' as const,
        groupName: node.group.name,
        member,
      }));
    }
    if (node.kind === 'project') {
      const scripts = [...node.project.scripts.entries()].map(([script, command]) => {
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
      // 常用命令分组置于脚本之后（脚本是高频操作，排前面）
      return [...scripts, { kind: 'builtin-group' as const, project: node.project }];
    }
    if (node.kind === 'builtin-group') {
      return builtinCommands(node.project.packageManager).map((command) => ({
        kind: 'builtin' as const,
        project: node.project,
        command,
        instance: this.instances.get(this.keyOf(node.project, builtinKey(command.id))),
      }));
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

  /** cmdline 是否已知/已学习为"依赖主进程、无法单独重启" */
  private isNoRespawn(cmdline: string): boolean {
    return this.noRespawnCmdlines.has(cmdline) || isDependentWorker(cmdline);
  }

  /** 组内正在运行的成员数（含扩展代管状态），组行状态聚合用 */
  private groupRunningCount(group: ResolvedGroup<LaunchGroupProject>): number {
    let count = 0;
    for (const m of group.members) {
      if (m.project && m.script && this.instances.has(this.keyOf(m.project.raw, m.script))) {
        count++;
      }
    }
    return count;
  }

  /**
   * 项目下正在运行的服务进程数：每个运行中的脚本按其监听端口数计
   * （尚未检测到端口时按 1 计，至少表明脚本在跑）；外部运行按端口数同理。
   */
  private runningCountOf(project: NpmProject): number {
    let count = 0;
    for (const script of project.scripts.keys()) {
      const key = this.keyOf(project, script);
      const inst = this.instances.get(key);
      if (inst) {
        count += Math.max(1, inst.services.size);
        continue;
      }
      const ext = this.externalRunning.get(key);
      if (ext) {
        count += Math.max(1, ext.hit.ports.length);
      }
    }
    return count;
  }
}
