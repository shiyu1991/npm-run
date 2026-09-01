/**
 * 启动组（Launch Group）配置解析：纯函数，不依赖 vscode（可在无编辑器环境单测）。
 *
 * 配置形如 `"npm-run.groups": { "dev-all": ["apps/web:dev", "core:dev"] }`，
 * ref 格式 `项目:脚本`，分隔符取第一个冒号（路径与项目名均不含冒号；脚本名可含冒号）。
 *
 * 项目匹配优先级：
 * 1. 相对 workspace root 的 posix 路径精确匹配（makeRef 生成的形态，无歧义）
 * 2. package.json name 兜底 —— 仅唯一命中才认；重名宁可不解析（诚实优于猜测）
 * 命中项目后脚本名必须在其声明中，否则整体未解析（不返回半解析结果）。
 */

/** 参与解析的项目最小结构；extension 侧通过 raw 字段携带原始 NpmProject */
export interface GroupProjectLike {
  name: string;
  /** 相对 workspace root 的路径（调用方归一为 posix 风格；根项目为 '.'） */
  relativeDir: string;
  /** 项目声明的脚本名集合 */
  scripts: ReadonlySet<string>;
}

/** 组内一个成员的解析结果；project 为空即未解析（保留原始 ref 供展示/回写） */
export interface GroupMember<T extends GroupProjectLike = GroupProjectLike> {
  ref: string;
  project?: T;
  script?: string;
}

export interface ResolvedGroup<T extends GroupProjectLike = GroupProjectLike> {
  name: string;
  members: GroupMember<T>[];
}

/** 路径规范化：统一斜杠方向、去尾斜杠、忽略大小写（Windows 友好） */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function resolveRef<T extends GroupProjectLike>(ref: string, projects: readonly T[]): GroupMember<T> {
  const idx = ref.indexOf(':');
  if (idx <= 0) {
    return { ref };
  }
  const rawProjPart = ref.slice(0, idx);
  const script = ref.slice(idx + 1);
  if (!script) {
    return { ref };
  }
  // 1) 相对路径精确匹配
  const byPath = projects.filter((p) => normPath(p.relativeDir) === normPath(rawProjPart));
  let hit: T | undefined = byPath.length === 1 ? byPath[0] : undefined;
  // 2) name 兜底（仅唯一命中才认，重名宁可不解析）
  if (!hit && byPath.length === 0) {
    const byName = projects.filter((p) => p.name === rawProjPart);
    if (byName.length === 1) {
      hit = byName[0];
    }
  }
  if (!hit) {
    return { ref };
  }
  if (!hit.scripts.has(script)) {
    return { ref };
  }
  return { ref, project: hit, script };
}

export function resolveGroups<T extends GroupProjectLike>(
  groups: Record<string, readonly string[]>,
  projects: readonly T[]
): ResolvedGroup<T>[] {
  return Object.entries(groups ?? {}).map(([name, refs]) => ({
    name,
    members: (Array.isArray(refs) ? refs : []).filter((r): r is string => typeof r === 'string')
      .map((ref) => resolveRef(ref, projects)),
  }));
}

/**
 * 生成存储用 ref：子包项目用相对路径（防重名歧义），根项目（relativeDir '.'）用项目名。
 * 生成的 ref 保证可被 resolveRef 再次解析（round-trip）。
 */
export function makeRef(relativeDir: string, name: string, script: string): string {
  const rel = normPath(relativeDir);
  return rel && rel !== '.' ? `${relativeDir}:${script}` : `${name}:${script}`;
}

/**
 * 项目目录 → 启动组引用用的相对标识：
 * 单根工作区下为相对 root 的路径（根项目 '.'）；多根工作区为「文件夹名/子路径」
 * （folder 名不含冒号，保证 ref 的「项目:脚本」分隔语义不被盘符/folder 名破坏）。
 * 比较忽略大小写与斜杠方向（Windows 友好），返回值保留原始大小写。
 */
export function relativeDirOf(dir: string, folders: readonly { name: string; fsPath: string }[]): string {
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const d = norm(dir);
  for (const f of folders) {
    const r = norm(f.fsPath);
    const multi = folders.length > 1;
    if (d === r) {
      return multi ? f.name : '.';
    }
    if (r && d.startsWith(`${r}/`)) {
      const sub = dir.replace(/\\/g, '/').slice(r.length + 1);
      return multi && sub ? `${f.name}/${sub}` : sub || (multi ? f.name : '.');
    }
  }
  return dir.replace(/\\/g, '/');
}
