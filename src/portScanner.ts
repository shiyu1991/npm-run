/** 纯逻辑模块：三平台端口命令输出解析。不依赖 vscode，可单测。 */

export interface ListeningSocket {
  port: number;
  pid: number;
  /** 监听地址列表（同端口可能同时监听 IPv4/IPv6） */
  addresses: string[];
}

interface RawSocket {
  address: string;
  port: number;
  pid: number;
}

/** "0.0.0.0:135" / "[::1]:5173" → { address, port } */
function splitAddressPort(s: string): { address: string; port: number } | undefined {
  const v6 = /^\[(.+)\]:(\d+)$/.exec(s);
  if (v6) {
    return { address: `[${v6[1]}]`, port: Number(v6[2]) };
  }
  const v4 = /^(.+):(\d+)$/.exec(s);
  if (v4) {
    return { address: v4[1], port: Number(v4[2]) };
  }
  return undefined;
}

/** 按 (port, pid) 合并同端口多地址（IPv4 + IPv6 双栈监听） */
function mergeSockets(entries: RawSocket[]): ListeningSocket[] {
  const map = new Map<string, ListeningSocket>();
  for (const e of entries) {
    const key = `${e.port}|${e.pid}`;
    const found = map.get(key);
    if (found) {
      if (!found.addresses.includes(e.address)) {
        found.addresses.push(e.address);
      }
    } else {
      map.set(key, { port: e.port, pid: e.pid, addresses: [e.address] });
    }
  }
  return [...map.values()];
}

/** Windows `netstat -ano` 输出解析 */
export function parseNetstatWindows(output: string): ListeningSocket[] {
  const entries: RawSocket[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    // TCP  <local addr:port>  <foreign addr:port>  LISTENING  <pid>
    const parts = rawLine.trim().split(/\s+/);
    if (parts.length >= 5 && parts[0] === 'TCP' && parts[3] === 'LISTENING') {
      const local = splitAddressPort(parts[1]);
      const pid = Number(parts[4]);
      if (local && Number.isFinite(pid) && local.port > 0) {
        entries.push({ ...local, pid });
      }
    }
  }
  return mergeSockets(entries);
}

/** macOS `lsof -i -P -n` 输出解析（需 -P -P 保留数字端口） */
export function parseLsof(output: string): ListeningSocket[] {
  const entries: RawSocket[] = [];
  for (const rawLine of output.split('\n')) {
    // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME (LISTEN)
    const parts = rawLine.trim().split(/\s+/);
    if (parts.length >= 9 && parts[parts.length - 1] === '(LISTEN)') {
      const pid = Number(parts[1]);
      const name = parts[parts.length - 2];
      const idx = name.lastIndexOf(':');
      if (idx > 0) {
        const address = name.slice(0, idx);
        const port = Number(name.slice(idx + 1));
        if (Number.isFinite(pid) && Number.isFinite(port) && port > 0) {
          entries.push({ address, port, pid });
        }
      }
    }
  }
  return mergeSockets(entries);
}

/** Linux `ss -tlnp` 输出解析 */
export function parseSs(output: string): ListeningSocket[] {
  const entries: RawSocket[] = [];
  for (const rawLine of output.split('\n')) {
    // LISTEN  recv-q  send-q  <local addr:port>  <peer>  users:(("name",pid=123,fd=4))
    const parts = rawLine.trim().split(/\s+/);
    if (parts[0] !== 'LISTEN') {
      continue;
    }
    const local = splitAddressPort(parts[3]);
    const pidMatch = /pid=(\d+)/.exec(rawLine);
    if (local && pidMatch) {
      entries.push({ ...local, pid: Number(pidMatch[1]) });
    }
  }
  return mergeSockets(entries);
}
