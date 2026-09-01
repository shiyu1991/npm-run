/** 纯逻辑：内置包管理命令表与包管理器识别。不依赖 vscode，可单测。 */

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

export interface BuiltinCommand {
  /** 稳定标识，兼作实例 key 后缀（与同名脚本区分，如 builtin:install） */
  id: string;
  /** 展示名 */
  label: string;
  /** 传给包管理器 CLI 的参数；<pkg> 为包名占位，运行时替换 */
  args: string[];
  /** 需要用户输入包名 */
  needsPackage?: boolean;
}

/** 各包管理器的差异部分（install / outdated 三者一致，故不列入） */
const VARIANTS: Record<
  PackageManager,
  { ci: string[]; update: string[]; remove: string; prune?: string[] }
> = {
  npm: { ci: ['ci'], update: ['update'], remove: 'uninstall', prune: ['prune'] },
  pnpm: {
    ci: ['install', '--frozen-lockfile'],
    update: ['update'],
    remove: 'remove',
    prune: ['prune'],
  },
  // yarn 无 prune 等价物：yarn install 自带修剪行为，故不提供该条目
  yarn: { ci: ['install', '--frozen-lockfile'], update: ['upgrade'], remove: 'remove' },
};

/** 某项目可用的内置命令（顺序即树中展示顺序） */
export function builtinCommands(pm: PackageManager): BuiltinCommand[] {
  const v = VARIANTS[pm];
  const list: BuiltinCommand[] = [
    { id: 'install', label: 'install', args: ['install'] },
    { id: 'ci', label: 'ci', args: v.ci },
    { id: 'update', label: v.update[0], args: v.update },
    { id: 'remove', label: 'remove <pkg>', args: [v.remove, '<pkg>'], needsPackage: true },
  ];
  if (v.prune) {
    list.push({ id: 'prune', label: 'prune', args: v.prune });
  }
  list.push({ id: 'outdated', label: 'outdated', args: ['outdated'] });
  return list;
}

/**
 * 内置命令在实例表中的 key 后缀。
 * 必须与同名脚本区分：package.json 允许 `install` 等生命周期脚本，
 * 若共用 key 会导致「npm run install」与「npm install」的状态、输出、停止互相串台。
 */
const BUILTIN_PREFIX = 'builtin:';

export const builtinKey = (id: string): string => `${BUILTIN_PREFIX}${id}`;

/** builtinKey 的逆判断：实例脚本名是否为内置命令（徽标等统计口径区分脚本与内置命令用） */
export const isBuiltinName = (name: string): boolean => name.startsWith(BUILTIN_PREFIX);

/** 完整命令行文本（展示用），如 `pnpm install --frozen-lockfile` */
export function commandLine(pm: PackageManager, args: readonly string[]): string {
  return [pm, ...args].join(' ');
}

/** 按项目中存在的 lockfile 判定包管理器；无法判定时回退 npm */
export function detectPackageManager(lockfileNames: readonly string[]): PackageManager {
  if (lockfileNames.includes('pnpm-lock.yaml')) {
    return 'pnpm';
  }
  if (lockfileNames.includes('yarn.lock')) {
    return 'yarn';
  }
  return 'npm';
}
