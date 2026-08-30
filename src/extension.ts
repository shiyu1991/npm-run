import * as vscode from 'vscode';
import { ProjectScanner } from './projectScanner';
import { ScriptRunner, RunnerEvents, instanceKey } from './runner';
import { ServiceMonitor } from './serviceMonitor';
import { snapshotProcesses, snapshotPorts } from './sysSnapshot';
import { killProcessTree } from './killTree';
import { toBrowseUrl } from './urlBuilder';
import { NpmRunTreeProvider, TreeNode } from './treeProvider';
import { NpmProject, RunningScript, ExternalState } from './types';
import { buildProcessIndex, collectSubtreePids } from './processTree';
import { matchExternalScripts } from './externalDetect';
import { t } from './i18n';

let runner: ScriptRunner | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const scanner = new ProjectScanner();
  runner = new ScriptRunner();
  const instances = new Map<string, RunningScript>();
  /** 外部运行检测结果（key 与 instances 同构）：手动刷新快照式更新 */
  const externalRunning = new Map<string, ExternalState>();

  const provider = new NpmRunTreeProvider(scanner, instances, instanceKey, externalRunning);
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
    onExit(key, instance) {
      // 脚本根进程退出但仍有代管服务：保留实例继续管理（树/监控/停止按钮仍可用）
      if (instance.adoptedPids.size > 0) {
        provider.refresh();
        return;
      }
      instances.delete(key);
      monitor.detach(key);
      provider.refresh();
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

  const runScript = async (node?: TreeNode) => {
    if (!node || node.kind !== 'script') {
      return;
    }
    await startScript(node.project, node.script);
  };

  const stopScript = async (node?: TreeNode) => {
    if (!node || node.kind !== 'script') {
      return;
    }
    const err = await runner!.stop(node.project, node.script);
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
    const { project, script } = node;
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

  const showOutput = (node?: TreeNode) => {
    if (!node || node.kind !== 'script') {
      return;
    }
    instances.get(instanceKey(node.project, node.script))?.output.show();
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

  context.subscriptions.push(
    treeView,
    // 扫描结果变化（初始扫描完成 / package.json 增删改）→ 刷新树视图
    // 没有这条订阅，初始异步扫描完成后树不会重渲染，一直显示为空
    scanner.onDidChange(() => provider.refresh()),
    vscode.commands.registerCommand('npm-run.runScript', runScript),
    vscode.commands.registerCommand('npm-run.stopScript', stopScript),
    vscode.commands.registerCommand('npm-run.restartScript', restartScript),
    vscode.commands.registerCommand('npm-run.restartService', restartService),
    vscode.commands.registerCommand('npm-run.showOutput', showOutput),
    vscode.commands.registerCommand('npm-run.killService', killService),
    vscode.commands.registerCommand('npm-run.killExternal', killExternal),
    vscode.commands.registerCommand('npm-run.openInBrowser', openInBrowser),
    vscode.commands.registerCommand('npm-run.refresh', refresh),
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
