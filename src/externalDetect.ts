/**
 * 纯逻辑模块：外部脚本运行检测（快照式，由手动刷新/视图展开触发）。
 * 按"run 层链"组织：链根 = 祖先中无其他 run 层的最顶层进程（终端包装层如
 * powershell -Command "npm run dev"，覆盖 cmd 包装与 node 实体两层）。
 * 三级证据：
 * - A 级（确定归属）：链内（除链根自身，全局 npm 路径不算）进程 cmdline 含
 *   工作区项目 `<dir>\node_modules\` 绝对路径 → 挂到该项目（多项目嵌套取 needle 更长者）
 * - C 级（确定排除）：链内含 node_modules 路径但不指向任何工作区项目
 *   （如其他 IDE 打开的工作区外项目）→ 不显示
 * - B 级（唯一候选）：链内完全无 node_modules 路径证据（node launcher.js 类相对路径脚本）
 *   → 候选 = 工作区内声明了同名 script 的项目；仅唯一候选时挂，
 *   多候选时与工作区外同名脚本无法区分，宁缺毋滥不显示
 * 不依赖 vscode，可单测。
 */
import { ProcessInfo, buildProcessIndex, collectSubtreePids } from './processTree';
import { ListeningSocket } from './portScanner';

/** 匹配所需的最小项目结构（调用方由 NpmProject 映射，保持本模块可单测） */
export interface ProjectRef {
  /** 项目根目录（fsPath） */
  dir: string;
  /** 脚本名集合 */
  scripts: ReadonlySet<string>;
}

export interface ExternalHitPort {
  port: number;
  pid: number;
  addresses: string[];
}

export interface ExternalHit {
  projectDir: string;
  script: string;
  /** run 层链根 PID（结束外部进程时的进程树根，通常为终端包装层） */
  runPid: number;
  /** 证据进程（链根 + 路径匹配的执行层），去重合并 */
  pids: number[];
  /** 证据命令行（tooltip 展示用） */
  cmdline?: string;
  /** run 层链内监听的端口 */
  ports: ExternalHitPort[];
}

/** 父链回溯的最大深度（终端 → cmd → node npm → cmd → node 工具链足够） */
const MAX_PARENT_WALK = 8;

/** pnpm/yarn 简写模式的内置命令：出现在入口后第一个 token 位置时不当作脚本名 */
const BUILTIN_COMMANDS = new Set([
  'install', 'i', 'add', 'remove', 'rm', 'uninstall', 'un', 'update', 'up', 'upgrade',
  'test', 't', 'publish', 'run', 'exec', 'link', 'unlink', 'init', 'create', 'config',
  'cache', 'clean', 'info', 'list', 'ls', 'outdated', 'prune', 'pack', 'workspace',
  'workspaces', 'why', 'set', 'get', 'dlx', 'env', 'audit', 'doctor', 'rebuild',
  'generate-lockfile', 'install-test', 'symlink', 'login', 'logout', 'token', 'team',
  'owner', 'access', 'dedupe', 'patch', 'fetch', 'bin', 'server', 'help', 'version',
]);

/** 路径规范化：Windows 大小写不敏感 + 统一反斜杠 */
function normPath(s: string): string {
  return s.toLowerCase().replace(/\//g, '\\');
}

/**
 * 从 cmdline 提取脚本名：
 * 1) 显式 run：npm / npm-cli.js / pnpm / pnpm.cjs / yarn / yarn.js … 后跟 run 再跟脚本名
 * 2) 简写：pnpm / yarn 入口后直接跟脚本名（排除内置命令；npm 无简写形态）
 * token 为空白分隔的完整词，天然词边界（dev 不误配 dev:watch）。
 */
export function extractScriptToken(cmdline: string): string | undefined {
  const run =
    /(?:^|["'\s\\/])(?:npm|pnpm|yarn)[^\s"']*["'\s]+run["'\s]+(?!-)([^"'\s&|;]+)/i.exec(cmdline);
  if (run) {
    return run[1];
  }
  const sh =
    /(?:^|["'\s\\/])(?:pnpm|yarn)[^\s"']*["'\s]+(?!-)([^"'\s&|;]+)/i.exec(cmdline);
  if (sh && !BUILTIN_COMMANDS.has(sh[1].toLowerCase())) {
    return sh[1];
  }
  return undefined;
}

/** 某 run 层进程的严格祖先中是否还有其他 run 层（有则它是链中间层而非链根） */
function hasRunAncestor(
  pid: number,
  index: Map<number, ProcessInfo>,
  runPids: ReadonlySet<number>
): boolean {
  let cur = index.get(pid);
  const visited = new Set<number>([pid]);
  for (let depth = 0; cur && depth < MAX_PARENT_WALK; depth++) {
    const parent = index.get(cur.ppid);
    if (!parent || visited.has(parent.pid)) {
      break;
    }
    if (runPids.has(parent.pid)) {
      return true;
    }
    visited.add(parent.pid);
    cur = parent;
  }
  return false;
}

/** 合并一条证据到命中结果（同 key 多链去重） */
function mergeEvidence(
  hits: Map<string, ExternalHit>,
  projectDir: string,
  script: string,
  runPid: number,
  execPids: number[],
  cmdline: string | undefined,
  subtreePids: ReadonlySet<number>,
  sockets: readonly ListeningSocket[]
): void {
  const key = `${projectDir}|${script}`;
  let hit = hits.get(key);
  if (!hit) {
    hit = { projectDir, script, runPid, pids: [], cmdline, ports: [] };
    hits.set(key, hit);
  }
  for (const pid of [runPid, ...execPids]) {
    if (!hit.pids.includes(pid)) {
      hit.pids.push(pid);
    }
  }
  for (const s of sockets) {
    if (subtreePids.has(s.pid) && !hit.ports.some((x) => x.port === s.port && x.pid === s.pid)) {
      hit.ports.push({ port: s.port, pid: s.pid, addresses: [...s.addresses] });
    }
  }
  hit.ports.sort((a, b) => a.port - b.port);
}

/**
 * 主入口：进程/端口快照 + 项目列表 + 排除集（调用方已展开的自身实例子树 PID）→
 * Map<`${dir}|${script}`（与 runner.instanceKey 同构）, ExternalHit>
 */
export function matchExternalScripts(
  procs: ProcessInfo[],
  sockets: ListeningSocket[],
  projects: readonly ProjectRef[],
  excludePids: ReadonlySet<number>
): Map<string, ExternalHit> {
  const index = buildProcessIndex(procs);
  const hits = new Map<string, ExternalHit>();

  // 1) 全部 run 层进程（pid → 脚本名）；链根 = 祖先中无其他 run 层的最顶层
  const runLayers = new Map<number, string>();
  for (const p of procs) {
    if (excludePids.has(p.pid) || !p.cmdline) {
      continue;
    }
    const script = extractScriptToken(p.cmdline);
    if (script) {
      runLayers.set(p.pid, script);
    }
  }
  const roots: { pid: number; script: string }[] = [];
  for (const [pid, script] of runLayers) {
    if (!hasRunAncestor(pid, index, new Set(runLayers.keys()))) {
      roots.push({ pid, script });
  }
  }

  const needles = projects.map((pr) => ({ pr, needle: normPath(pr.dir) + '\\node_modules\\' }));
  /** B 级候选：script → 链列表（链内无任何 node_modules 路径证据） */
  const bCandidates = new Map<string, { pid: number; subtree: Set<number>; cmdline?: string }[]>();

  // 2) 逐链分级
  for (const root of roots) {
    const subtree = collectSubtreePids(root.pid, index);
    // 链内任一进程被排除 = 整链属于扩展自身实例，跳过
    let skip = false;
    for (const pid of subtree) {
      if (excludePids.has(pid)) {
        skip = true;
        break;
      }
    }
    if (skip) {
      continue;
    }

    // 链内（除链上各 run 层自身——其 cmdline 含包管理器全局安装路径，不算项目证据）
    // 找路径证据
    let anchored: ProjectRef | undefined;
    let needleLen = 0;
    const execPids: number[] = [];
    let foreignEvidence = false;
    for (const pid of subtree) {
      if (runLayers.has(pid)) {
        continue;
      }
      const p = index.get(pid);
      if (!p?.cmdline) {
        continue;
      }
      const c = normPath(p.cmdline);
      if (!c.includes('node_modules')) {
        continue;
      }
      let matched = false;
      for (const { pr, needle } of needles) {
        if (c.includes(needle)) {
          matched = true;
          if (needle.length > needleLen) {
            anchored = pr;
            needleLen = needle.length;
          }
        }
      }
      if (matched) {
        execPids.push(pid);
      } else {
        // 有 node_modules 路径但不指向任何工作区项目（外部项目）
        foreignEvidence = true;
      }
    }

    if (anchored) {
      // A 级：确定归属（脚本名须存在于该项目声明中）
      if (anchored.scripts.has(root.script)) {
        mergeEvidence(
          hits, anchored.dir, root.script, root.pid, execPids,
          index.get(root.pid)?.cmdline, subtree, sockets
        );
      }
      continue;
    }
    if (foreignEvidence) {
      // C 级：链内路径证据指向工作区外，确定不属于本工作区
      continue;
    }
    // B 级候选：链内无任何路径证据，待唯一性判定
    const list = bCandidates.get(root.script) ?? [];
    list.push({ pid: root.pid, subtree, cmdline: index.get(root.pid)?.cmdline });
    bCandidates.set(root.script, list);
  }

  // 3) B 级解析：候选 = 声明该 script 的工作区项目；仅唯一候选时挂
  for (const [script, chains] of bCandidates) {
    const candidates = projects.filter((pr) => pr.scripts.has(script));
    if (candidates.length !== 1) {
      continue; // 无候选或多个候选（与工作区外同名脚本无法区分），宁缺毋滥
    }
    for (const chain of chains) {
      mergeEvidence(
        hits, candidates[0].dir, script, chain.pid, [], chain.cmdline,
        chain.subtree, sockets
      );
    }
  }

  return hits;
}
