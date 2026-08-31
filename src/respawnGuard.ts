/**
 * 单服务重启防呆：识别"依赖脚本主进程、裸拉起必然退出"的 worker。
 *
 * 静态特征表（本模块）+ 会话内失败学习（runner.noRespawnCmdlines，
 * respawn 后新进程立即退出时回写）双层识别。
 * 设计纪律：宁漏判不误判——漏判只是多失败一次，误判会把真能单独
 * 重启的服务（如 concurrently 起的独立 server）挡掉。
 */

/** 已知依赖父进程的 worker：cmdline 命中即视为不可单独重启 */
const KNOWN_DEPENDENT_WORKERS: readonly RegExp[] = [
  // Next.js dev/start 的 HTTP server worker：由主进程 fork、经 IPC 接收端口句柄，
  // 裸拉起（无父 IPC）立即退出（\b 防 .jsx 等前缀同名文件误命中）
  /next[\\/]dist[\\/]server[\\/]lib[\\/]start-server\.js\b/i,
];

/** cmdline 是否命中已知"依赖父进程"特征（cmdline 缺省 = 无法判定，不命中） */
export function isDependentWorker(cmdline: string | undefined): boolean {
  if (!cmdline) {
    return false;
  }
  return KNOWN_DEPENDENT_WORKERS.some((re) => re.test(cmdline));
}
