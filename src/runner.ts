import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import { NpmProject, RunningScript, ServiceInfo } from './types';
import { extractConflictPort } from './errorParse';
import { killProcessTree } from './killTree';
import { spawnEnv } from './editorEnv';
import { snapshotPorts, snapshotProcesses } from './sysSnapshot';
import { buildProcessIndex, collectSubtreePids } from './processTree';
import { t } from './i18n';

export { killProcessTree };

export interface RunnerEvents {
  /** 脚本进程退出（正常退出或被杀） */
  onExit(key: string, instance: RunningScript, code: number | null): void;
  /** 输出中检测到端口冲突（EADDRINUSE） */
  onConflictPort(instance: RunningScript, port: number): void;
}

const isWin = process.platform === 'win32';

export function instanceKey(project: NpmProject, script: string): string {
  return `${project.dir.fsPath}|${script}`;
}

/** 脚本运行器：spawn 托管进程、输出管道、EADDRINUSE 行检测 */
export class ScriptRunner {
  /** 用户配置 npm-run.env 的读取器（每次 spawn 时读，改配置无需重启脚本之外的任何东西） */
  constructor(private extraEnv?: () => Record<string, unknown>) {}
  private children = new Map<string, ChildProcess>();
  /** 按 key 复用 OutputChannel，避免同一脚本多次运行堆积 channel 泄漏 */
  private channels = new Map<string, vscode.OutputChannel>();
  /** 等待某脚本退出的回调（重启时用：close 事件清理完实例后再启动） */
  private exitWaiters = new Map<string, Set<() => void>>();
  /** key → 实例（stop 时清理 adoptedPids 用） */
  private runningInstances = new Map<string, RunningScript>();
  /** key → 事件回调（代管进程终结时通知用） */
  private eventsMap = new Map<string, RunnerEvents>();

  /** 含"扩展代管"状态：根进程已退出但代管服务仍在 */
  isRunning(project: NpmProject, script: string): boolean {
    const key = instanceKey(project, script);
    if (this.children.has(key)) {
      return true;
    }
    const inst = this.runningInstances.get(key);
    return inst !== undefined && inst.adoptedPids.size > 0;
  }

  get runningKeys(): IterableIterator<string> {
    return this.children.keys();
  }

  private getOrCreateChannel(key: string, project: NpmProject, script: string): vscode.OutputChannel {
    let ch = this.channels.get(key);
    if (!ch) {
      ch = vscode.window.createOutputChannel(`npm-run: ${project.name} · ${script}`);
      this.channels.set(key, ch);
    }
    return ch;
  }

  /** 释放全部输出通道（扩展停用时调用） */
  disposeChannels(): void {
    for (const ch of this.channels.values()) {
      ch.dispose();
    }
    this.channels.clear();
  }

  /**
   * 启动命令：默认按 `npm run <script>` 执行；
   * 传 opts 时用指定包管理器与参数执行（内置命令，如 pnpm install）。
   */
  run(
    project: NpmProject,
    script: string,
    events: RunnerEvents,
    opts?: { cli?: string; args?: string[]; display?: string }
  ): RunningScript {
    const key = instanceKey(project, script);
    if (this.isRunning(project, script)) {
      throw new Error(t.alreadyRunning);
    }

    const output = this.getOrCreateChannel(key, project, script);
    const cli = opts?.cli ?? 'npm';
    const args = opts?.args ?? ['run', '--silent', script];
    const shown = opts?.display ?? `npm run ${script}`;
    const child = spawn(isWin ? `${cli}.cmd` : cli, args, {
      cwd: project.dir.fsPath,
      shell: isWin,
      windowsHide: true,
      env: spawnEnv(this.extraEnv?.() ?? {}, {
        pid: process.ppid,
        cwd: project.dir.fsPath,
      }),
    });

    const instance: RunningScript = {
      project,
      script,
      rootPid: child.pid ?? -1,
      services: new Map(),
      adoptedPids: new Set(),
      output,
    };

    this.children.set(key, child);
    this.runningInstances.set(key, instance);
    this.eventsMap.set(key, events);

    // 行缓冲：按行喂输出，兼顾展示与 EADDRINUSE 检测；
    // 同一实例同一端口冲突只上报一次，防止脚本重试输出多行 EADDRINUSE 弹窗轰炸
    const notifiedPorts = new Set<number>();
    let outBuf = '';
    let errBuf = '';
    const feed = (text: string, isErr: boolean) => {
      if (isErr) {
        errBuf += text;
      } else {
        outBuf += text;
      }
      output.append(text);
      const pending = isErr ? errBuf : outBuf;
      const lines = pending.split('\n');
      if (isErr) {
        errBuf = lines.pop() ?? '';
      } else {
        outBuf = lines.pop() ?? '';
      }
      for (const line of lines) {
        const port = extractConflictPort(line);
        if (port !== undefined && !notifiedPorts.has(port)) {
          notifiedPorts.add(port);
          events.onConflictPort(instance, port);
        }
      }
    };
    child.stdout?.on('data', (d: Buffer) => feed(d.toString('utf8'), false));
    child.stderr?.on('data', (d: Buffer) => feed(d.toString('utf8'), true));

    child.on('error', (err) => {
      output.appendLine(`\n[npm-run] ${t.spawnFail(err.message)}`);
      this.finish(key, instance, events, null);
    });
    child.on('close', (code) => {
      output.appendLine(`\n[npm-run] ${t.scriptExited(code ?? 'null')}`);
      this.finish(key, instance, events, code);
    });

    output.appendLine(
      t.runHeader(new Date().toLocaleTimeString(), shown, instance.rootPid, project.dir.fsPath)
    );
    output.show(true);
    return instance;
  }

  /** 停止脚本：杀完整进程树（从根 npm 包装层开始）+ 清理代管进程 */
  async stop(project: NpmProject, script: string): Promise<string> {
    const key = instanceKey(project, script);
    const child = this.children.get(key);
    const inst = this.runningInstances.get(key);
    // 标记用户主动停止：随后的 close → onExit 不作崩溃通知（重启流程同样受益）
    if (inst) {
      inst.userInitiatedStop = true;
    }
    const errs: string[] = [];
    if (child?.pid !== undefined) {
      errs.push(await killProcessTree(child.pid));
    }
    if (inst) {
      for (const pid of [...inst.adoptedPids]) {
        errs.push(await killProcessTree(pid));
        // 同步移除，避免随后 finish() 误判"仍有代管"而保留实例
        inst.adoptedPids.delete(pid);
      }
      // 代管状态下停止：主动终结实例（不等 close 事件），
      // 保证随后的整脚本重启（stop → start）不会撞"已在运行中"
      if (!this.children.has(key) && inst.adoptedPids.size === 0) {
        this.runningInstances.delete(key);
        const events = this.eventsMap.get(key);
        this.eventsMap.delete(key);
        events?.onExit(key, inst, null);
      }
    }
    const firstErr = errs.find((e) => e) ?? '';
    // kill 失败：进程可能未死、close 不会触发；回滚标志，
    // 防止该进程之后真崩溃时被误判为"主动停止"而漏通知
    if (firstErr && inst) {
      inst.userInitiatedStop = false;
    }
    return firstErr;
  }

  /** 等待指定脚本退出（close 事件触发、实例清理完成后 resolve），超时兜底放行 */
  waitForExit(key: string, timeoutMs = 3000): Promise<void> {
    if (!this.children.has(key)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      let waiters = this.exitWaiters.get(key);
      if (!waiters) {
        waiters = new Set();
        this.exitWaiters.set(key, waiters);
      }
      waiters.add(done);
    });
  }

  /**
   * 单服务重启：以服务原始命令行重新拉起进程，由扩展代管（adoptedPids）。
   * 监控轮询会把代管 PID 并入归属集合，树中该端口条目保留；停止/退出脚本时一并清理。
   */
  respawnService(inst: RunningScript, svc: ServiceInfo): string {
    if (!svc.cmdline) {
      return t.respawnNoCmdline;
    }
    const child = spawn(svc.cmdline, {
      cwd: inst.project.dir.fsPath,
      shell: true,
      windowsHide: true,
      env: spawnEnv(this.extraEnv?.() ?? {}, {
        pid: process.ppid,
        cwd: inst.project.dir.fsPath,
      }),
    });
    if (child.pid === undefined) {
      return t.respawnFailNoPid(svc.port);
    }
    inst.adoptedPids.add(child.pid);
    inst.output.appendLine(`[npm-run] ${t.respawned(svc.port, child.pid, svc.cmdline)}`);
    child.stdout?.on('data', (d: Buffer) => inst.output.append(d.toString('utf8')));
    child.stderr?.on('data', (d: Buffer) => inst.output.append(d.toString('utf8')));
    child.on('error', (err) => {
      inst.output.appendLine(`\n[npm-run] ${t.respawnSpawnErr(svc.port, err.message)}`);
      inst.adoptedPids.delete(child.pid!);
    });
    child.on('close', () => {
      inst.adoptedPids.delete(child.pid!);
      // 脚本根已退出且这是最后一个代管进程 → 实例真正终结
      this.finalizeIfGone(inst);
    });
    this.verifyRespawn(inst, svc.port, child, svc.cmdline);
    return '';
  }

  /**
   * 已确认无法单独重启的 cmdline（respawn 后新进程立即退出 = 结构性依赖父进程）。
   * 会话级跨实例生效：服务随整脚本重启再现时，树中直接禁用其单独重启按钮。
   */
  readonly noRespawnCmdlines = new Set<string>();

  /**
   * 单服务重启后验证：目标端口应在数秒内由新拉起的进程（或其子进程）恢复监听。
   * 若新进程很快退出且端口未恢复——典型如 Next.js dev 的 start-server worker
   * （依赖父进程 IPC/环境，裸拉起立即退出）——明确提示改用整脚本重启，
   * 避免用户误以为服务已恢复。
   */
  private verifyRespawn(
    inst: RunningScript,
    port: number,
    child: ChildProcess,
    cmdline: string
  ): void {
    let settled = false;
    const fail = (reason: string, exited = false) => {
      if (settled) {
        return;
      }
      settled = true;
      if (exited) {
        // 新进程立即退出 = 结构性依赖父进程：记住该 cmdline，
        // 此后此类服务的 ⟳ 在树中显示为禁用图标（无需事件刷新，下次渲染自然生效）
        this.noRespawnCmdlines.add(cmdline);
      }
      inst.output.appendLine(`[npm-run] ${t.verifyFailMsg(port, reason)}`);
      void vscode.window.showWarningMessage(t.verifyFailQuick(port));
    };
    void (async () => {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !settled) {
        await new Promise((r) => setTimeout(r, 1000));
        if (child.exitCode !== null) {
          fail(t.verifyFailNewExited, true);
          return;
        }
        try {
          const hit = (await snapshotPorts()).find((s) => s.port === port);
          if (!hit) {
            continue;
          }
          const subtree = collectSubtreePids(child.pid!, buildProcessIndex(await snapshotProcesses()));
          if (subtree.has(hit.pid)) {
            settled = true; // 端口已由新进程恢复
          } else {
            settled = true; // 端口被其他进程占用：端口冲突流程会另行提示，这里不重复报
          }
        } catch {
          // 快照失败：跳过本轮，继续等待
        }
      }
      fail(t.verifyFailTimeout);
    })();
  }

  /** 停止全部托管脚本（扩展停用时防孤儿进程） */
  async stopAll(): Promise<void> {
    const pids = [...this.children.values()]
      .map((c) => c.pid)
      .filter((p): p is number => p !== undefined);
    for (const inst of this.runningInstances.values()) {
      for (const pid of inst.adoptedPids) {
        pids.push(pid);
      }
    }
    await Promise.all(pids.map((pid) => killProcessTree(pid)));
  }

  private finish(key: string, instance: RunningScript, events: RunnerEvents, code: number | null): void {
    this.children.delete(key);
    const waiters = this.exitWaiters.get(key);
    if (waiters) {
      this.exitWaiters.delete(key);
      for (const done of waiters) {
        done();
      }
    }
    // 仍有代管服务在运行（launcher 类脚本在子进程全被替换后会自然退出）：
    // 不清杀代管进程，实例转入"扩展代管"状态继续存活，由 stop/stopAll 统一清理
    if (instance.adoptedPids.size > 0) {
      instance.adoptedOnly = true;
      instance.output.appendLine(`[npm-run] ${t.adoptedNotice}`);
      events.onExit(key, instance, code);
      return;
    }
    this.runningInstances.delete(key);
    this.eventsMap.delete(key);
    events.onExit(key, instance, code);
  }

  /** 根进程已退出且代管进程全部结束 → 通知终结（respawn 的 close 回调里用） */
  private finalizeIfGone(inst: RunningScript): void {
    const key = instanceKey(inst.project, inst.script);
    if (this.children.has(key) || inst.adoptedPids.size > 0) {
      return;
    }
    if (!this.runningInstances.has(key)) {
      return;
    }
    this.runningInstances.delete(key);
    const events = this.eventsMap.get(key);
    this.eventsMap.delete(key);
    events?.onExit(key, inst, null);
  }
}
