import * as vscode from 'vscode';
import { ProjectScanner } from './projectScanner';
import { ScriptRunner, RunnerEvents, instanceKey } from './runner';
import { ServiceMonitor } from './serviceMonitor';
import { snapshotProcesses, snapshotPorts } from './sysSnapshot';
import { killProcessTree } from './killTree';
import { toBrowseUrl } from './urlBuilder';
import { isDependentWorker } from './respawnGuard';
import { BuiltinCommand, builtinKey, commandLine } from './builtins';
import { NpmRunTreeProvider, TreeNode, LaunchGroupProject } from './treeProvider';
import { NpmProject, RunningScript, ExternalState } from './types';
import { buildProcessIndex, collectSubtreePids } from './processTree';
import { matchExternalScripts } from './externalDetect';
import { resolveGroups, makeRef, relativeDirOf, ResolvedGroup } from './launchGroups';
import { t, initLang } from './i18n';

let runner: ScriptRunner | undefined;

/** 工作区 folder 列表 → relativeDirOf 所需的最小结构 */
function workspaceFolders(): { name: string; fsPath: string }[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => ({ name: f.name, fsPath: f.uri.fsPath }));
}

/** NpmProject → launchGroups 解析所需的最小结构（raw 透传原对象） */
function toGroupProjects(projects: readonly NpmProject[]): LaunchGroupProject[] {
  const folders = workspaceFolders();
  return projects.map((p) => ({
    name: p.name,
    relativeDir: relativeDirOf(p.dir.fsPath, folders),
    scripts: new Set(p.scripts.keys()),
    raw: p,
  }));
}

export function activate(context: vscode.ExtensionContext): void {
  initLang(vscode.env.language);
  const scanner = new ProjectScanner();
  // npm-run.env：注入到脚本进程的用户环境变量（如 code-inspector-plugin 的 CODE_INSPECTOR=1），
  // 每次 spawn 时读取，修改配置后启动的脚本即生效
  runner = new ScriptRunner(
    () => vscode.workspace.getConfiguration('npm-run').get<Record<string, unknown>>('env') ?? {}
  );
  const instances = new Map<string, RunningScript>();
  /** 外部运行检测结果（key 与 instances 同构）：手动刷新快照式更新 */
  const externalRunning = new Map<string, ExternalState>();

  const readGroups = (): Record<string, readonly string[]> =>
    vscode.workspace.getConfiguration('npm-run').get<Record<string, readonly string[]>>('groups') ?? {};

  const resolvedGroups = (): ResolvedGroup<LaunchGroupProject>[] =>
    resolveGroups(readGroups(), toGroupProjects(scanner.projects));

  /** 回写启动组配置到工作区 settings.json；失败（如未打开文件夹）弹错误并返回 false */
  const writeGroups = async (groups: Record<string, string[]>): Promise<boolean> => {
    try {
      await vscode.workspace
        .getConfiguration('npm-run')
        .update('groups', groups, vscode.ConfigurationTarget.Workspace);
      return true;
    } catch (e) {
      void vscode.window.showErrorMessage(
        t.groupWriteFail(e instanceof Error ? e.message : String(e))
      );
      return false;
    }
  };

  const provider = new NpmRunTreeProvider(
    scanner,
    instances,
    instanceKey,
    externalRunning,
    runner.noRespawnCmdlines,
    resolvedGroups
  );
  const treeView = vscode.window.createTreeView('npm-run.scripts', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  const intervalMs = vscode.workspace
    .getConfiguration('npm-run')
    .get<number>('pollIntervalMs', 1500);
  const monitor = new ServiceMonitor(() => provider.refresh(), Math.max(500, intervalMs));
  // 轮询间隔配置热生效
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('npm-run.pollIntervalMs')) {
        monitor.setInterval(
          Math.max(500, vscode.workspace.getConfiguration('npm-run').get<number>('pollIntervalMs', 1500))
        );
      }
      // 启动组配置变化（含本扩展 UI 回写）→ 即时刷新树
      if (e.affectsConfiguration('npm-run.groups')) {
        provider.refresh();
      }
    })
  );

  /** 端口冲突处理：区分"被其他脚本实例占用"与"被外部进程占用" */
  async function handleConflict(inst: RunningScript, port: number): Promise<void> {
    try {
      const [procs, sockets] = await Promise.all([snapshotProcesses(), snapshotPorts()]);
      const owner = sockets.find((s) => s.port === port);
      if (!owner) {
        return;
      }
      const index = buildProcessIndex(procs);
      for (const other of instances.values()) {
        if (other === inst) {
          continue;
        }
        if (collectSubtreePids(other.rootPid, index).has(owner.pid)) {
          void vscode.window.showWarningMessage(
            t.conflictOwnedByScript(port, other.project.name, other.script)
          );
          return;
        }
      }
      // 外部进程占用
      const pick = await vscode.window.showErrorMessage(
        t.conflictExternal(port, owner.pid, inst.script),
        t.killOccupier,
        t.ignore
      );
      if (pick === t.killOccupier) {
        const confirm = await vscode.window.showWarningMessage(
          t.confirmKillExternal(owner.pid, owner.addresses.join(', ')),
          { modal: true },
          t.confirmKillBtn
        );
        if (confirm === t.confirmKillBtn) {
          const err = await killProcessTree(owner.pid);
          if (err) {
            void vscode.window.showErrorMessage(err);
          } else {
            void vscode.window.showInformationMessage(t.processKilled(owner.pid));
          }
        }
      }
    } catch {
      // 快照失败时静默
    }
  }

  const runnerEvents: RunnerEvents = {
    onExit(key, instance, code) {
      // 脚本根进程退出但仍有代管服务：保留实例继续管理（树/监控/停止按钮仍可用）
      if (instance.adoptedPids.size > 0) {
        provider.refresh();
        return;
      }
      instances.delete(key);
      monitor.detach(key);
      provider.refresh();
      // 崩溃通知：非用户主动停止且异常退出（code 非 0；null = 被信号杀等，同样算异常）
      if (!instance.userInitiatedStop && code !== 0) {
        void vscode.window
          .showErrorMessage(
            t.crashNotified(instance.project.name, instance.script, code ?? 'null'),
            t.showOutput
          )
          .then((pick) => {
            if (pick === t.showOutput) {
              instance.output.show();
            }
          });
      }
    },
    onConflictPort(instance, port) {
      void handleConflict(instance, port);
    },
  };

  const startScript = async (project: NpmProject, script: string) => {
    if (runner!.isRunning(project, script)) {
      void vscode.window.showWarningMessage(t.warnAlreadyRunning);
      return;
    }
    const key = instanceKey(project, script);
    // 外部疑似运行中：提示可能端口冲突，用户确认后再启动
    const ext = externalRunning.get(key);
    if (ext) {
      const evidencePid = ext.hit.pids[0];
      const pick = await vscode.window.showWarningMessage(
        t.externalRunWarning(evidencePid, script),
        t.continueRun,
        t.cancel
      );
      if (pick !== t.continueRun) {
        return;
      }
    }
    try {
      const inst = runner!.run(project, script, runnerEvents);
      instances.set(key, inst);
      monitor.attach(key, inst);
      // 自身实例接管该脚本：清掉外部检测条目，避免自身停止后陈旧"外部运行中"复现
      externalRunning.delete(key);
      provider.refresh();
    } catch (e) {
      void vscode.window.showErrorMessage(t.startFail(e instanceof Error ? e.message : String(e)));
    }
  };

  /**
   * 内置命令（install / ci / update / remove / prune / outdated）。
   * 不接入端口监控：这类命令不监听端口，接入只会白白拉起轮询。
   */
  const runBuiltin = async (project: NpmProject, command: BuiltinCommand) => {
    const name = builtinKey(command.id);
    if (runner!.isRunning(project, name)) {
      void vscode.window.showWarningMessage(t.warnAlreadyRunning);
      return;
    }
    let args = command.args;
    if (command.needsPackage) {
      const pkg = await vscode.window.showInputBox({
        prompt: t.inputPackageName(commandLine(project.packageManager, command.args)),
        placeHolder: 'lodash',
      });
      if (!pkg) {
        return;
      }
      args = args.map((a) => (a === '<pkg>' ? pkg : a));
    }
    try {
      const inst = runner!.run(project, name, runnerEvents, {
        cli: project.packageManager,
        args,
        display: commandLine(project.packageManager, args),
      });
      instances.set(instanceKey(project, name), inst);
      provider.refresh();
    } catch (e) {
      void vscode.window.showErrorMessage(t.startFail(e instanceof Error ? e.message : String(e)));
    }
  };

  const runScript = async (node?: TreeNode) => {
    if (!node) {
      return;
    }
    if (node.kind === 'builtin') {
      await runBuiltin(node.project, node.command);
      return;
    }
    if (node.kind !== 'script') {
      return;
    }
    await startScript(node.project, node.script);
  };

  /** 树节点对应的实例名：脚本行 = 脚本名，内置命令 = builtin:<id> */
  function nodeScriptName(node: TreeNode): string | undefined {
    if (node.kind === 'script') {
      return node.script;
    }
    return node.kind === 'builtin' ? builtinKey(node.command.id) : undefined;
  }

  const stopScript = async (node?: TreeNode) => {
    if (!node) {
      return;
    }
    const name = nodeScriptName(node);
    if (name === undefined || (node.kind !== 'script' && node.kind !== 'builtin')) {
      return;
    }
    const err = await runner!.stop(node.project, name);
    if (err) {
      void vscode.window.showErrorMessage(t.stopFail(err));
      return;
    }
    // close 事件触发后由 onExit 清理并刷新
  };

  /** 正在重启中的脚本 key：防止无反馈窗口期内的重复点击导致连环重启 */
  const restarting = new Set<string>();

  /** 脚本行与服务行都可触发：服务行上的重启 = 重启其所属脚本（单服务无法独立拉起） */
  const restartScript = async (node?: TreeNode) => {
    if (!node || (node.kind !== 'script' && node.kind !== 'service')) {
      return;
    }
    await restartByKey(node.project, node.script);
  };

  /** 整脚本重启核心（stop → 等待退出清理 → 重新启动）；restarting 集防连点连环重启 */
  async function restartByKey(project: NpmProject, script: string): Promise<void> {
    const key = instanceKey(project, script);
    if (restarting.has(key)) {
      return; // 一次重启还在进行中，忽略重复触发
    }
    if (!runner!.isRunning(project, script)) {
      void vscode.window.showWarningMessage(t.notRunning);
      return;
    }
    restarting.add(key);
    try {
      // 立即给出反馈，避免用户以为没点上而再点
      instances.get(key)?.output.appendLine(`[npm-run] ${t.restarting}`);
      const err = await runner!.stop(project, script);
      if (err) {
        void vscode.window.showErrorMessage(t.stopFail(err));
        return;
      }
      // 等 close 事件完成实例清理后再启动，否则会被"已在运行中"拦截
      await runner!.waitForExit(key);
      await startScript(project, script);
    } finally {
      restarting.delete(key);
    }
  }

  /** 组成员行 ⟳：未运行 → 直接启动（组内一键拉起挂掉的成员）；运行中 → 整脚本重启 */
  /** 成员行 ▶（仅未运行态显示）：启动该成员脚本 */
  const memberStart = async (node?: TreeNode) => {
    if (!node || node.kind !== 'group-member' || !node.member.project || !node.member.script) {
      return;
    }
    await startScript(node.member.project.raw, node.member.script);
  };

  /** 成员行 ⟳（仅运行态显示）：整脚本重启（对依赖主进程的 worker 安全：整树杀+整树拉） */
  const memberRestart = async (node?: TreeNode) => {
    if (!node || node.kind !== 'group-member' || !node.member.project || !node.member.script) {
      return;
    }
    const project = node.member.project.raw;
    if (!runner!.isRunning(project, node.member.script)) {
      void vscode.window.showWarningMessage(t.notRunning);
      return;
    }
    await restartByKey(project, node.member.script);
  };

  /** 单服务独立重启进行中的守卫（key|port），防连点 */
  const restartingServices = new Set<string>();

  /** 服务行专属：仅重启这一个服务（杀掉后按其原始命令行由扩展代管拉起） */
  const restartService = async (node?: TreeNode) => {
    if (!node || node.kind !== 'service') {
      return;
    }
    const svc = node.instance.services.get(node.port);
    if (!svc || svc.isRoot) {
      return; // 根进程服务走 restartScript（菜单已分流）
    }
    // 双保险：命令面板等入口绕过菜单 when，命中"无法单独重启"时拦下并提示
    if (
      svc.cmdline &&
      (runner!.noRespawnCmdlines.has(svc.cmdline) || isDependentWorker(svc.cmdline))
    ) {
      void vscode.window.showWarningMessage(t.respawnUnsupported(svc.port));
      return;
    }
    // 实例仅此一个服务：单服务重启在效果上必然等于整脚本重启
    //（杀掉唯一服务会导致 launcher 类脚本整体退出，如 Next.js dev 的
    // start-server worker 死后主进程随之退出），直接转发整脚本重启一步到位
    if (node.instance.services.size <= 1) {
      node.instance.output.appendLine(`[npm-run] ${t.singleServiceRedirect(svc.port)}`);
      await restartScript(node);
      return;
    }
    const guard = `${instanceKey(node.project, node.script)}|${node.port}`;
    if (restartingServices.has(guard)) {
      return;
    }
    restartingServices.add(guard);
    try {
      node.instance.output.appendLine(`[npm-run] ${t.restartingService(svc.port)}`);
      const killErr = await killProcessTree(svc.pid);
      if (killErr) {
        void vscode.window.showErrorMessage(t.restartServiceFail(killErr));
        return;
      }
      const err = runner!.respawnService(node.instance, svc);
      if (err) {
        void vscode.window.showErrorMessage(err);
      }
    } finally {
      restartingServices.delete(guard);
    }
  };

  /** 哑命令：不可单独重启的服务行点击禁用图标 → 提示改用整脚本重启 */
  const respawnUnsupported = (node?: TreeNode) => {
    if (node && node.kind === 'service') {
      void vscode.window.showWarningMessage(t.respawnUnsupported(node.port));
    }
  };

  const showOutput = async (node?: TreeNode) => {
    if (!node) {
      return;
    }
    // 组行 📄：查看运行中成员的输出；多个成员先选一个
    if (node.kind === 'launch-group') {
      const live = node.group.members.filter(
        (m) => m.project && m.script && instances.has(instanceKey(m.project.raw, m.script!))
      );
      if (live.length === 0) {
        return; // 菜单 when 已限制运行态，防御性兜底
      }
      if (live.length === 1) {
        instances.get(instanceKey(live[0].project!.raw, live[0].script!))?.output.show();
        return;
      }
      const picked = await vscode.window.showQuickPick(
        live.map((m) => ({
          label: `$(terminal) ${m.script}`,
          description: m.project!.name,
          inst: instances.get(instanceKey(m.project!.raw, m.script!))!,
        })),
        { placeHolder: t.pickMemberOutput }
      );
      picked?.inst.output.show();
      return;
    }
    // 成员行 📄：该成员的输出通道
    if (node.kind === 'group-member') {
      if (node.member.project && node.member.script) {
        instances.get(instanceKey(node.member.project.raw, node.member.script))?.output.show();
      }
      return;
    }
    const name = nodeScriptName(node);
    if (name === undefined || (node.kind !== 'script' && node.kind !== 'builtin')) {
      return;
    }
    instances.get(instanceKey(node.project, name))?.output.show();
  };

  /** 节点可打开的地址：脚本行 = 其全部监听端口（升序），服务 / 外部端口行 = 自身 */
  function openTargets(node: TreeNode): { port: number; addresses: string[] }[] {
    if (node.kind === 'service') {
      const svc = node.instance.services.get(node.port);
      return svc ? [{ port: svc.port, addresses: svc.addresses }] : [];
    }
    if (node.kind === 'external-port') {
      const p = node.state.hit.ports.find((x) => x.port === node.port);
      return p ? [{ port: p.port, addresses: p.addresses }] : [];
    }
    // 组成员行：已运行成员的脚本行同款目标（全部监听端口，升序）
    if (node.kind === 'group-member') {
      if (!node.member.project || !node.member.script) {
        return [];
      }
      const inst = instances.get(instanceKey(node.member.project.raw, node.member.script));
      return inst
        ? [...inst.services.values()]
            .sort((a, b) => a.port - b.port)
            .map((s) => ({ port: s.port, addresses: s.addresses }))
        : [];
    }
    // 组行：聚合全部运行中成员的监听端口（升序；多端口时沿用先选后开的交互）
    if (node.kind === 'launch-group') {
      const targets: { port: number; addresses: string[] }[] = [];
      for (const m of node.group.members) {
        if (!m.project || !m.script) {
          continue;
        }
        const inst = instances.get(instanceKey(m.project.raw, m.script));
        if (inst) {
          targets.push(...[...inst.services.values()].map((s) => ({ port: s.port, addresses: s.addresses })));
        }
      }
      return targets.sort((a, b) => a.port - b.port);
    }
    if (node.kind !== 'script') {
      return [];
    }
    if (node.instance) {
      return [...node.instance.services.values()]
        .sort((a, b) => a.port - b.port)
        .map((s) => ({ port: s.port, addresses: s.addresses }));
    }
    return node.external
      ? node.external.hit.ports.map((p) => ({ port: p.port, addresses: p.addresses }))
      : [];
  }

  /** 在浏览器打开：单端口直接打开，多端口（脚本行）先选一个 */
  const openInBrowser = async (node?: TreeNode) => {
    if (!node) {
      return;
    }
    const targets = openTargets(node);
    if (targets.length === 0) {
      void vscode.window.showInformationMessage(t.noPortToOpen);
      return;
    }
    let target = targets[0];
    if (targets.length > 1) {
      const picked = await vscode.window.showQuickPick(
        targets.map((s) => ({ label: toBrowseUrl(s.addresses, s.port), target: s })),
        { placeHolder: t.choosePortToOpen }
      );
      if (!picked) {
        return;
      }
      target = picked.target;
    }
    await vscode.env.openExternal(vscode.Uri.parse(toBrowseUrl(target.addresses, target.port)));
  };

  const killService = async (node?: TreeNode) => {
    if (!node || node.kind !== 'service') {
      return;
    }
    const svc = node.instance.services.get(node.port);
    if (!svc) {
      return;
    }
    if (svc.isRoot) {
      void vscode.window.showWarningMessage(t.killRootService);
      return;
    }
    // 双保险：依赖主进程的 worker 单独结束会导致整个脚本退出且无法恢复，
    // 与单独重启同规则拦截（菜单 when 已隐藏 ✕，此处挡命令面板等入口）
    if (
      svc.cmdline &&
      (runner!.noRespawnCmdlines.has(svc.cmdline) || isDependentWorker(svc.cmdline))
    ) {
      void vscode.window.showWarningMessage(t.killUnsupported(svc.port));
      return;
    }
    const err = await killProcessTree(svc.pid);
    if (err) {
      void vscode.window.showErrorMessage(t.killServiceFail(err));
      return;
    }
    node.instance.output.appendLine(`[npm-run] ${t.serviceKilled(svc.port, svc.pid)}`);
    // 下一轮监控 tick 会自动从服务列表移除
  };

  /** 外部脚本检测：一次进程+端口快照 → cmdline 证据匹配 → 更新 externalRunning（快照失败保留上次结果） */
  async function detectExternal(): Promise<void> {
    try {
      const [procs, sockets] = await Promise.all([snapshotProcesses(), snapshotPorts()]);
      // 排除集 = 自身实例整链（rootPid 子树 + 代管进程子树）
      const index = buildProcessIndex(procs);
      const exclude = new Set<number>();
      for (const inst of instances.values()) {
        for (const pid of collectSubtreePids(inst.rootPid, index)) {
          exclude.add(pid);
        }
        for (const apid of inst.adoptedPids) {
          exclude.add(apid);
          for (const pid of collectSubtreePids(apid, index)) {
            exclude.add(pid);
          }
        }
      }
      const projects = scanner.projects.map((p) => ({
        dir: p.dir.fsPath,
        scripts: new Set(p.scripts.keys()),
      }));
      const hits = matchExternalScripts(procs, sockets, projects, exclude);
      const now = Date.now();
      externalRunning.clear();
      for (const [key, hit] of hits) {
        // 自身实例优先（检测期间可能恰有实例启动）
        if (instances.has(key)) {
          continue;
        }
        externalRunning.set(key, { hit, detectedAt: now });
      }
    } catch {
      // 快照失败（命令不可用等）：静默，保留上次检测结果
    }
  }

  /** 刷新进行中标志：防手动点刷新与视图展开触发并发重复检测 */
  let refreshing = false;

  const refresh = async () => {
    if (refreshing) {
      return; // 上一轮刷新进行中（手动点 + 视图展开可能同时触发）
    }
    refreshing = true;
    treeView.message = t.detecting;
    try {
      await scanner.refresh();
      await detectExternal();
      provider.refresh();
    } finally {
      treeView.message = undefined;
      refreshing = false;
    }
  };

  // 树视图变为可见（点击活动栏图标展开）时自动刷新 = 用户主动触发的检测入口，
  // 与手动点刷新按钮等价；不可见时不做任何事
  context.subscriptions.push(
    treeView.onDidChangeVisibility((e) => {
      if (e.visible) {
        void refresh();
      }
    })
  );

  /** 结束外部运行的脚本进程树（以检测到的包管理器 run 层为根） */
  const killExternal = async (node?: TreeNode) => {
    if (!node || node.kind !== 'script' || !node.external) {
      return;
    }
    const { hit } = node.external;
    const shown = hit.pids.slice(0, 3).map((p) => `PID ${p}`).join(' / ');
    const pidList = hit.pids.length > 3 ? `${shown} …` : shown;
    const confirm = await vscode.window.showWarningMessage(
      t.confirmKillExternalScript(pidList, node.script),
      { modal: true },
      t.confirmKillBtn
    );
    if (confirm !== t.confirmKillBtn) {
      return;
    }
    const err = await killProcessTree(hit.runPid);
    if (err) {
      void vscode.window.showErrorMessage(t.killExternalFail(err));
      return;
    }
    void vscode.window.showInformationMessage(t.externalKilled(hit.runPid));
    externalRunning.delete(instanceKey(node.project, node.script));
    provider.refresh();
  };

  /** 启动组：逐成员启动；已在运行（幂等）与外部运行中的成员跳过，完成后一条汇总通知 */
  const runGroup = async (node?: TreeNode) => {
    if (!node || node.kind !== 'launch-group') {
      return;
    }
    let started = 0;
    let skipped = 0;
    let failed = 0;
    let unresolved = 0;
    for (const member of node.group.members) {
      if (!member.project || !member.script) {
        unresolved++;
        continue;
      }
      const project = member.project.raw;
      const script = member.script;
      const key = instanceKey(project, script);
      // 预检跳过：运行中（幂等）与外部运行中（避免逐个弹确认打断 + 端口冲突风险）
      if (runner!.isRunning(project, script) || externalRunning.has(key)) {
        skipped++;
        continue;
      }
      await startScript(project, script);
      if (runner!.isRunning(project, script)) {
        started++;
      } else {
        failed++;
      }
    }
    provider.refresh();
    void vscode.window.showInformationMessage(
      t.groupResult(node.group.name, started, skipped, failed, unresolved)
    );
  };

  /** 脚本行右键「添加到启动组」：QuickPick 选已有组或新建，回写工作区配置 */
  const addToGroup = async (node?: TreeNode) => {
    if (!node || node.kind !== 'script') {
      return;
    }
    const { project, script } = node;
    const ref = makeRef(relativeDirOf(project.dir.fsPath, workspaceFolders()), project.name, script);
    const current: Record<string, string[]> = {};
    for (const [g, refs] of Object.entries(readGroups())) {
      current[g] = Array.isArray(refs) ? [...refs] : [];
    }
    interface GroupPick extends vscode.QuickPickItem {
      target?: string;
    }
    const picks: GroupPick[] = [
      ...Object.keys(current).map((g) => ({
        label: `$(rocket) ${g}`,
        description: t.scriptsCount(current[g].length),
        target: g,
      })),
      { label: `$(add) ${t.newGroupOption}` },
    ];
    const picked = await vscode.window.showQuickPick(picks, {
      placeHolder: t.addToGroupPick(script),
    });
    if (!picked) {
      return;
    }
    let groupName = picked.target;
    if (!groupName) {
      groupName = (await vscode.window.showInputBox({ prompt: t.newGroupNamePrompt }))?.trim();
      if (!groupName) {
        return;
      }
      current[groupName] = current[groupName] ?? [];
    }
    if (!current[groupName].includes(ref)) {
      current[groupName].push(ref);
      await writeGroups(current);
    }
  };

  /** 成员行 ✕：从组中移除该成员（回写配置） */
  const removeFromGroup = async (node?: TreeNode) => {
    if (!node || node.kind !== 'group-member') {
      return;
    }
    const current: Record<string, string[]> = {};
    for (const [g, refs] of Object.entries(readGroups())) {
      current[g] = Array.isArray(refs) ? [...refs] : [];
    }
    if (!Array.isArray(current[node.groupName])) {
      return;
    }
    current[node.groupName] = current[node.groupName].filter((r) => r !== node.member.ref);
    await writeGroups(current);
  };

  /** 组行右键「删除启动组」：modal 确认后整组移除（不影响正在运行的脚本） */
  const deleteGroup = async (node?: TreeNode) => {
    if (!node || node.kind !== 'launch-group') {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      t.confirmDeleteGroup(node.group.name, node.group.members.length),
      { modal: true },
      t.confirmDeleteBtn
    );
    if (confirm !== t.confirmDeleteBtn) {
      return;
    }
    const current: Record<string, string[]> = {};
    for (const [g, refs] of Object.entries(readGroups())) {
      current[g] = Array.isArray(refs) ? [...refs] : [];
    }
    delete current[node.group.name];
    await writeGroups(current);
  };

  /** 组行 ■：停止组内全部运行中的成员（逐个 stop，用户自启脚本无需确认） */
  const stopGroup = async (node?: TreeNode) => {
    if (!node || node.kind !== 'launch-group') {
      return;
    }
    for (const member of node.group.members) {
      if (!member.project || !member.script) {
        continue;
      }
      const project = member.project.raw;
      if (runner!.isRunning(project, member.script)) {
        const err = await runner!.stop(project, member.script);
        if (err) {
          void vscode.window.showErrorMessage(t.stopFail(err));
        }
      }
    }
    // close 事件级联 onExit → refresh；此处兜底立即刷新一次
    provider.refresh();
  };

  /** 成员行 ■：停止该成员脚本 */
  const stopMember = async (node?: TreeNode) => {
    if (!node || node.kind !== 'group-member' || !node.member.project || !node.member.script) {
      return;
    }
    const project = node.member.project.raw;
    if (!runner!.isRunning(project, node.member.script)) {
      void vscode.window.showWarningMessage(t.notRunning);
      return;
    }
    const err = await runner!.stop(project, node.member.script);
    if (err) {
      void vscode.window.showErrorMessage(t.stopFail(err));
    }
  };

  /** 视图标题栏 ＋：输入组名 → 多选脚本一次收集成员 → 创建（组名已存在则追加去重） */
  const newGroup = async () => {
    const name = (await vscode.window.showInputBox({ prompt: t.newGroupNamePrompt }))?.trim();
    if (!name) {
      return;
    }
    interface MemberPick extends vscode.QuickPickItem {
      project: NpmProject;
      script: string;
    }
    const folders = workspaceFolders();
    const picks: MemberPick[] = scanner.projects.flatMap((p) =>
      [...p.scripts.keys()].map((script) => ({
        label: `$(terminal) ${script}`,
        description: p.name,
        project: p,
        script,
      }))
    );
    const chosen = await vscode.window.showQuickPick(picks, {
      canPickMany: true,
      placeHolder: t.pickGroupMembers,
    });
    const current: Record<string, string[]> = {};
    for (const [g, refs] of Object.entries(readGroups())) {
      current[g] = Array.isArray(refs) ? [...refs] : [];
    }
    const appended = Object.prototype.hasOwnProperty.call(current, name);
    current[name] = current[name] ?? [];
    let added = 0;
    for (const pick of chosen ?? []) {
      const ref = makeRef(relativeDirOf(pick.project.dir.fsPath, folders), pick.project.name, pick.script);
      if (!current[name].includes(ref)) {
        current[name].push(ref);
        added++;
      }
    }
    if (await writeGroups(current)) {
      void vscode.window.showInformationMessage(t.groupCreated(name, added, appended));
    }
  };

  context.subscriptions.push(
    treeView,
    // 扫描结果变化（初始扫描完成 / package.json 增删改）→ 刷新树视图
    // 没有这条订阅，初始异步扫描完成后树不会重渲染，一直显示为空
    scanner.onDidChange(() => provider.refresh()),
    vscode.commands.registerCommand('npm-run.runScript', runScript),
    vscode.commands.registerCommand('npm-run.stopScript', stopScript),
    vscode.commands.registerCommand('npm-run.restartScript', restartScript),
    vscode.commands.registerCommand('npm-run.restartService', restartService),
    vscode.commands.registerCommand('npm-run.respawnUnsupported', respawnUnsupported),
    vscode.commands.registerCommand('npm-run.showOutput', showOutput),
    vscode.commands.registerCommand('npm-run.killService', killService),
    vscode.commands.registerCommand('npm-run.killExternal', killExternal),
    vscode.commands.registerCommand('npm-run.openInBrowser', openInBrowser),
    vscode.commands.registerCommand('npm-run.refresh', refresh),
    vscode.commands.registerCommand('npm-run.runGroup', runGroup),
    vscode.commands.registerCommand('npm-run.addToGroup', addToGroup),
    vscode.commands.registerCommand('npm-run.removeFromGroup', removeFromGroup),
    vscode.commands.registerCommand('npm-run.deleteGroup', deleteGroup),
    vscode.commands.registerCommand('npm-run.memberRestart', memberRestart),
    vscode.commands.registerCommand('npm-run.memberStart', memberStart),
    vscode.commands.registerCommand('npm-run.newGroup', newGroup),
    vscode.commands.registerCommand('npm-run.stopGroup', stopGroup),
    vscode.commands.registerCommand('npm-run.stopMember', stopMember),
    scanner.watch(),
    { dispose: () => monitor.dispose() }
  );

  void scanner.refresh();
}

export async function deactivate(): Promise<void> {
  // 返回 Promise 让 VSCode 等待 kill 完成（最长 5s），防止扩展宿主退出后遗留孤儿端口进程
  await runner?.stopAll();
  runner?.disposeChannels();
}
