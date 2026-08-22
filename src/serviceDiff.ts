/** 纯逻辑模块：端口服务快照 diff。不依赖 vscode，可单测。 */

export interface ServiceSnapshot {
  port: number;
  pid: number;
  addresses: string[];
}

export interface ServicesDiff {
  added: ServiceSnapshot[];
  removed: number[];
  changed: ServiceSnapshot[];
}

function sameAddresses(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/** 比较前后两轮端口快照：added = 新监听端口，removed = 消失端口，changed = pid/地址变化（服务重启） */
export function diffServices(
  prev: Map<number, ServiceSnapshot>,
  next: Map<number, ServiceSnapshot>
): ServicesDiff {
  const added: ServiceSnapshot[] = [];
  const removed: number[] = [];
  const changed: ServiceSnapshot[] = [];
  for (const [port, s] of next) {
    const p = prev.get(port);
    if (!p) {
      added.push(s);
    } else if (p.pid !== s.pid || !sameAddresses(p.addresses, s.addresses)) {
      changed.push(s);
    }
  }
  for (const port of prev.keys()) {
    if (!next.has(port)) {
      removed.push(port);
    }
  }
  return { added, removed, changed };
}
