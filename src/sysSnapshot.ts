import { execFile } from 'child_process';
import { ListeningSocket, parseNetstatWindows, parseLsof, parseSs } from './portScanner';
import { ProcessInfo } from './processTree';

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

function execFileText(cmd: string, args: string[], timeoutMs = 5000): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => resolve(err ? '' : String(stdout))
    );
  });
}

/** 进程全量快照（一次拉取，内存过滤，禁止逐 PID 查询） */
export async function snapshotProcesses(): Promise<ProcessInfo[]> {
  if (isWin) {
    // wmic 已在新版 Windows 移除，用 PowerShell CIM；tab 分隔（命令行内可能含 | 等字符）
    const out = await execFileText('powershell.exe', [
      '-NoProfile',
      '-Command',
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' +
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)`t$($_.CommandLine)" }',
    ]);
    const procs: ProcessInfo[] = [];
    for (const line of out.split('\n')) {
      const m = /^(\d+)\t(\d+)\t([^\t]*)\t?(.*)$/.exec(line.replace(/\r$/, ''));
      if (m) {
        procs.push({ pid: Number(m[1]), ppid: Number(m[2]), name: m[3], commandLine: m[4] ?? '' });
      }
    }
    return procs;
  }
  // macOS / Linux：args= 拿完整命令行，首 token 作为进程名
  const out = await execFileText('ps', ['-eo', 'pid=,ppid=,args=']);
  const procs: ProcessInfo[] = [];
  for (const line of out.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 3) {
      const pid = Number(parts[0]);
      const ppid = Number(parts[1]);
      if (Number.isFinite(pid) && Number.isFinite(ppid)) {
        const args = parts.slice(2).join(' ');
        procs.push({ pid, ppid, name: parts[2], commandLine: args });
      }
    }
  }
  return procs;
}

/** 端口监听全量快照 */
export async function snapshotPorts(): Promise<ListeningSocket[]> {
  if (isWin) {
    return parseNetstatWindows(await execFileText('netstat', ['-ano']));
  }
  if (isMac) {
    return parseLsof(await execFileText('lsof', ['-i', '-P', '-n']));
  }
  return parseSs(await execFileText('ss', ['-tlnp']));
}
