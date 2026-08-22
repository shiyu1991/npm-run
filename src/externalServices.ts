/** 纯逻辑模块：外部服务检测（IDE 进程树内、非托管、非 IDE 自身的监听端口）。 */

import { ProcessInfo, ProcessIndex, buildProcessIndex, collectSubtreePids } from './processTree';
import { ListeningSocket } from './portScanner';

/** IDE 主进程名特征（Code / CodeBuddy / Cursor / VSCodium / Windsurf / Trae / Electron） */
const IDE_NAME_RE = /code|codebuddy|vscodium|cursor|electron|windsurf|trae/i;

/** 沿祖先链向上，返回最顶层的 IDE 进程 PID（集成终端与扩展宿主的共同祖先）；无则 undefined */
export function findIdeRoot(index: ProcessIndex, startPid: number): number | undefined {
  const chain: number[] = [];
  let cur: number | undefined = startPid;
  while (cur !== undefined && index.has(cur)) {
    chain.push(cur);
    cur = index.get(cur)!.ppid;
  }
  let root: number | undefined;
  for (const pid of chain) {
    if (IDE_NAME_RE.test(index.get(pid)!.name)) {
      root = pid; // 持续向上取最顶层
    }
  }
  return root;
}

export interface ExternalService {
  port: number;
  addresses: string[];
  pid: number;
  name: string;
  commandLine: string;
}

export interface ExternalScanInput {
  procs: ProcessInfo[];
  sockets: ListeningSocket[];
  /** 扩展宿主 PID（其子树包含托管脚本与语言服务器，全部排除） */
  extensionHostPid: number;
  /** 托管脚本根 PID 列表（已在树中展示，排除防重复） */
  managedRootPids: number[];
}

/** 计算"外部服务"：IDE 树内监听端口、但不属于扩展宿主子树、也不是 IDE 自身二进制的进程 */
export function computeExternalServices(input: ExternalScanInput): ExternalService[] {
  const index = buildProcessIndex(input.procs);
  const ideRoot = findIdeRoot(index, input.extensionHostPid);
  if (ideRoot === undefined) {
    return []; // 找不到 IDE 根时宁可不报，防全系统误杀
  }
  const inIde = collectSubtreePids(ideRoot, index);
  const excluded = collectSubtreePids(input.extensionHostPid, index); // 含托管脚本与扩展内部进程
  const result: ExternalService[] = [];
  for (const s of input.sockets) {
    if (!inIde.has(s.pid) || excluded.has(s.pid)) {
      continue;
    }
    const proc = index.get(s.pid);
    if (!proc || IDE_NAME_RE.test(proc.name)) {
      continue; // IDE 自身监听（CDP/utility 等）
    }
    result.push({
      port: s.port,
      addresses: s.addresses,
      pid: s.pid,
      name: proc.name,
      commandLine: proc.commandLine ?? '',
    });
  }
  return result.sort((a, b) => a.port - b.port);
}
