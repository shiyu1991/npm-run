import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import { NpmProject, RunningScript } from './types';
import { extractConflictPort } from './errorParse';
import { killProcessTree } from './killTree';

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
  private children = new Map<string, ChildProcess>();
  /** 按 key 复用 OutputChannel，避免同一脚本多次运行堆积 channel 泄漏 */
  private channels = new Map<string, vscode.OutputChannel>();
  /** 等待某脚本退出的回调（重启时用：close 事件清理完实例后再启动） */
  private exitWaiters = new Map<string, Set<() => void>>();

  isRunning(project: NpmProject, script: string): boolean {
    return this.children.has(instanceKey(project, script));
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

  run(project: NpmProject, script: string, events: RunnerEvents): RunningScript {
    const key = instanceKey(project, script);
    if (this.children.has(key)) {
      throw new Error('脚本已在运行中');
    }

    const output = this.getOrCreateChannel(key, project, script);
    const npmCmd = isWin ? 'npm.cmd' : 'npm';
    const child = spawn(npmCmd, ['run', '--silent', script], {
      cwd: project.dir.fsPath,
      shell: isWin,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' },
    });

    const instance: RunningScript = {
      project,
      script,
      rootPid: child.pid ?? -1,
      services: new Map(),
      output,
    };

    this.children.set(key, child);

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
      output.appendLine(`\n[npm-run] 进程启动失败: ${err.message}`);
      this.finish(key, instance, events, null);
    });
    child.on('close', (code) => {
      output.appendLine(`\n[npm-run] 脚本已退出（代码 ${code ?? 'null'}）`);
      this.finish(key, instance, events, code);
    });

    output.appendLine(
      `===== ${new Date().toLocaleTimeString()} 运行: npm run ${script}（PID ${instance.rootPid}，目录 ${project.dir.fsPath}）`
    );
    output.show(true);
    return instance;
  }

  /** 停止脚本：杀完整进程树（从根 npm 包装层开始） */
  async stop(project: NpmProject, script: string): Promise<string> {
    const key = instanceKey(project, script);
    const child = this.children.get(key);
    if (!child || child.pid === undefined) {
      return '';
    }
    return killProcessTree(child.pid);
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

  /** 停止全部托管脚本（扩展停用时防孤儿进程） */
  async stopAll(): Promise<void> {
    const pids = [...this.children.values()]
      .map((c) => c.pid)
      .filter((p): p is number => p !== undefined);
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
    events.onExit(key, instance, code);
  }
}
