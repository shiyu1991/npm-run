import * as vscode from 'vscode';
import { ProjectScanner } from './projectScanner';
import { ScriptRunner, RunnerEvents, instanceKey } from './runner';
import { ServiceMonitor } from './serviceMonitor';
import { snapshotProcesses, snapshotPorts } from './sysSnapshot';
import { killProcessTree } from './killTree';
import { NpmRunTreeProvider, TreeNode } from './treeProvider';
import { NpmProject, RunningScript } from './types';
import { buildProcessIndex, collectSubtreePids } from './processTree';
import { t } from './i18n';

let runner: ScriptRunner | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const scanner = new ProjectScanner();
  runner = new ScriptRunner();
  const instances = new Map<string, RunningScript>();

  const provider = new NpmRunTreeProvider(scanner, instances, instanceKey);
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
    try {
      const inst = runner!.run(project, script, runnerEvents);
      instances.set(instanceKey(project, script), inst);
      monitor.attach(instanceKey(project, script), inst);
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

  const refresh = async () => {
    await scanner.refresh();
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
