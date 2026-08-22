/** 纯逻辑模块：package.json 内容解析与项目过滤。不依赖 vscode，可单测。 */

export interface NpmProjectLite {
  name: string;
  dir: string;
  scripts: Map<string, string>;
}

export interface PackageFileInput {
  dir: string;
  content: string;
}

function basename(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? dir;
}

/** 解析所有 package.json 内容：跳过非法 JSON / 非 object / 无脚本的项目，结果按目录排序 */
export function parseProjects(files: PackageFileInput[]): NpmProjectLite[] {
  const projects: NpmProjectLite[] = [];
  for (const f of files) {
    let json: unknown;
    try {
      json = JSON.parse(f.content);
    } catch {
      continue;
    }
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      continue;
    }
    const obj = json as { name?: unknown; scripts?: unknown };
    const scripts =
      typeof obj.scripts === 'object' && obj.scripts !== null && !Array.isArray(obj.scripts)
        ? obj.scripts as Record<string, unknown>
        : undefined;
    if (!scripts) {
      continue;
    }
    const entries = Object.entries(scripts).filter(
      (e): e is [string, string] => typeof e[1] === 'string'
    );
    if (entries.length === 0) {
      continue;
    }
    const name =
      typeof obj.name === 'string' && obj.name.trim() !== '' ? obj.name : basename(f.dir);
    projects.push({ name, dir: f.dir, scripts: new Map(entries) });
  }
  return projects.sort((a, b) => a.dir.localeCompare(b.dir));
}
