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

/** 解析 PowerShell CIM 输出（"pid|ppid|name|cmdline" 行；cmdline 可含 |，故仅限次切分） */
export function parseProcessListWin(out: string): ProcessInfo[] {
  const procs: ProcessInfo[] = [];
  for (const line of out.split('\n')) {
    const parts = line.trim().split('|');
    if (parts.length < 3) {
      continue;
    }
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) {
      continue;
    }
    const cmdline = parts.slice(3).join('|');
    procs.push({ pid, ppid, name: parts[2], cmdline: cmdline || undefined });
  }
  return procs;
}

/** 解析 ps -eo pid=,ppid=,args= 输出（args 为含空格的完整命令行） */
export function parseProcessListUnix(out: string): ProcessInfo[] {
  const procs: ProcessInfo[] = [];
  for (const line of out.split('\n')) {
    const m = /^(\d+)\s+(\d+)\s+(.+)$/.exec(line.trim());
    if (m) {
      procs.push({ pid: Number(m[1]), ppid: Number(m[2]), name: m[3], cmdline: m[3] });
    }
  }
  return procs;
}

/** 进程全量快照（一次拉取，内存过滤，禁止逐 PID 查询） */
export async function snapshotProcesses(): Promise<ProcessInfo[]> {
  if (isWin) {
    // wmic 已在新版 Windows 移除，用 PowerShell CIM；输出 "pid|ppid|name|cmdline" 行避免 JSON 解析歧义
    const out = await execFileText('powershell.exe', [
      '-NoProfile',
      '-Command',
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' +
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.Name)|$($_.CommandLine)" }',
    ]);
    return parseProcessListWin(out);
  }
  // macOS / Linux（args= 即完整命令行，兼作 cmdline 凭据）
  const out = await execFileText('ps', ['-eo', 'pid=,ppid=,args=']);
  return parseProcessListUnix(out);
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
