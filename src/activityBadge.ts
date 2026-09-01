/**
 * 活动栏图标徽标的计数口径：与项目行「运行中 (n)」一致——
 * 每个运行中脚本按其监听服务数计（尚未检出端口按 1，至少表明脚本在跑），
 * 外部运行按其监听端口数计（至少 1）。
 *
 * 入参用结构化最小类型（不导入 vscode / types）：纯函数，可在无 vscode 的单测环境直接运行。
 */

/** 活动栏徽标数量：全部运行中服务进程的聚合数 */
export function activityBadgeCount(
  /** 运行中脚本实例（调用方已排除内置命令：不监听端口，树口径也不计入） */
  instances: Iterable<{ services: { size: number } }>,
  /** 外部运行检测结果 */
  external: Iterable<{ hit: { ports: readonly unknown[] } }>
): number {
  let count = 0;
  for (const inst of instances) {
    count += Math.max(1, inst.services.size);
  }
  for (const ext of external) {
    count += Math.max(1, ext.hit.ports.length);
  }
  return count;
}
