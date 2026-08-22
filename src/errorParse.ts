/** 纯逻辑模块：从脚本输出提取端口冲突（EADDRINUSE）端口号。 */

/**
 * 从输出文本中提取端口冲突端口号。
 * 覆盖格式：
 * - Node: `Error: listen EADDRINUSE: address already in use 0.0.0.0:3000`
 * - Node IPv6: `EADDRINUSE: address already in use :::8080` / `[::]:3000`
 * - Go: `listen tcp 0.0.0.0:8080: bind: address already in use`
 */
export function extractConflictPort(output: string): number | undefined {
  for (const line of output.split('\n')) {
    if (/EADDRINUSE|address already in use/i.test(line)) {
      const m =
        /(\d{1,3}(?:\.\d{1,3}){3}|\[[^\]]*\]|:::|\*|[a-z0-9.-]*):(\d{2,5})(?!\d)/i.exec(line);
      if (m) {
        const port = Number(m[2]);
        if (port > 0 && port <= 65535) {
          return port;
        }
      }
    }
  }
  return undefined;
}
