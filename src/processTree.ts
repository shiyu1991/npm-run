/** 纯逻辑模块：进程快照索引与子树收集。不依赖 vscode，可单测。 */

export interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string;
}

export type ProcessIndex = Map<number, ProcessInfo>;

export function buildProcessIndex(procs: ProcessInfo[]): ProcessIndex {
  return new Map(procs.map((p) => [p.pid, p]));
}

/**
 * 收集包含根在内的整棵进程子树 PID 集合。
 * - 根不存在于快照 → 空集
 * - 防御异常数据（父子环）不死循环
 */
export function collectSubtreePids(rootPid: number, index: ProcessIndex): Set<number> {
  const children = new Map<number, number[]>();
  for (const p of index.values()) {
    const list = children.get(p.ppid);
    if (list) {
      list.push(p.pid);
    } else {
      children.set(p.ppid, [p.pid]);
    }
  }
  const visited = new Set<number>();
  const stack = [rootPid];
  while (stack.length > 0) {
    const pid = stack.pop()!;
    if (visited.has(pid) || !index.has(pid)) {
      continue;
    }
    visited.add(pid);
    for (const c of children.get(pid) ?? []) {
      stack.push(c);
    }
  }
  return visited;
}
