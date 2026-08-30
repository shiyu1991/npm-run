import { execFile } from 'child_process';
import { ProcessInfo, buildProcessIndex, collectSubtreePids } from './processTree';
import { t } from './i18n';

const isWin = process.platform === 'win32';

function execFileText(cmd: string, args: string[], timeoutMs = 5000): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => resolve(err ? '' : String(stdout))
    );
  });
}

/** 探测 PID 是否存在（不发送信号）；ESRCH=不存在，EPERM=存在但无权限 */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 杀掉指定 PID 及其全部后代进程树，返回错误信息（空串为成功） */
export async function killProcessTree(pid: number): Promise<string> {
  if (isWin) {
    return new Promise((resolve) => {
      execFile(
        'taskkill',
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true, timeout: 5000 },
        (err, _stdout, _stderr) => {
          if (!err) {
            resolve('');
            return;
          }
          // taskkill 输出编码随系统 locale（GBK/UTF-8），不可靠；
          // 用 PID 存在性探测判断：目标已不存在（重复停止/先一步退出）视为成功
          resolve(pidAlive(pid) ? t.taskkillFail(err.message) : '');
        }
      );
    });
  }
  // Unix：内存构建进程树后整树 SIGTERM，2s 后仍存活则 SIGKILL
  const out = await execFileText('ps', ['-eo', 'pid=,ppid=']);
  const procs: ProcessInfo[] = [];
  for (const line of out.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 3) {
      const pidNum = Number(parts[0]);
      const ppidNum = Number(parts[1]);
      if (Number.isFinite(pidNum) && Number.isFinite(ppidNum)) {
        procs.push({ pid: pidNum, ppid: ppidNum, name: parts.slice(2).join(' ') });
      }
    }
  }
  const pids = [...collectSubtreePids(pid, buildProcessIndex(procs))];
  for (const p of pids) {
    try {
      process.kill(p, 'SIGTERM');
    } catch {
      // 已退出
    }
  }
  await new Promise((r) => setTimeout(r, 2000));
  for (const p of pids) {
    try {
      process.kill(p, 0);
      process.kill(p, 'SIGKILL');
    } catch {
      // 已退出
    }
  }
  return '';
}
