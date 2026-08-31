/**
 * 复刻 VSCode 系编辑器给「集成终端」注入的编辑器标识环境变量。
 *
 * 背景：code-inspector-plugin、react-dev-utils(launchEditor) 等 dev 工具
 * 依靠 TERM_PROGRAM=vscode / VSCODE_PID / VSCODE_CWD 等信号识别宿主编辑器，
 * 实现"点击页面元素 → 编辑器打开对应源码"。VSCode 只把这些变量注入集成终端，
 * 不会注入扩展宿主进程——因此经本扩展 spawn 的 dev server 常被识别失败
 * （进程扫描兜底也只认 Code.exe 等已知进程名，认不出 CodeBuddy 等 fork）。
 * 在终端里手动 npm run 一切正常、经扩展启动却无法跳转，根因即此。
 *
 * 已存在的同名变量不覆盖（编辑器从终端启动时主进程可能已带上正确值）。
 */
export function withEditorHints(
  env: NodeJS.ProcessEnv,
  hints: { pid: number; cwd?: string }
): NodeJS.ProcessEnv {
  const injected: NodeJS.ProcessEnv = { ...env };
  if (injected.TERM_PROGRAM === undefined) {
    injected.TERM_PROGRAM = 'vscode';
  }
  if (injected.VSCODE_PID === undefined) {
    // 扩展宿主的父进程即编辑器主进程；launchEditor 系只拿它做存在性判断
    injected.VSCODE_PID = String(hints.pid);
  }
  if (injected.VSCODE_CWD === undefined && hints.cwd) {
    injected.VSCODE_CWD = hints.cwd;
  }
  return injected;
}

/**
 * 组装脚本进程的完整环境：
 * 基础（process.env + 禁色 CI 标识）→ 编辑器标识注入 → 用户 npm-run.env 配置（最高优先级）。
 * 用户配置值统一转字符串（vscode 配置里数字/布尔也合法传入）。
 *
 * 必须剥离 ELECTRON_RUN_AS_NODE：扩展宿主进程本身以纯 Node 模式运行（该变量=1），
 * 它会遗传给 spawn 的脚本进程；脚本里的工具（如 code-inspector-plugin 的 launch-ide）
 * 再去启动编辑器 exe 时，同一个二进制因该变量被拉起为纯 Node 模式，
 * `-g` 等编辑器参数被当非法选项拒绝（exit 9）。集成终端由主进程（GUI 模式）派生、
 * 无此变量，所以终端里跑同样命令一切正常。
 */
export function spawnEnv(
  extra: Record<string, unknown>,
  hints: { pid: number; cwd?: string }
): NodeJS.ProcessEnv {
  const env = withEditorHints(
    { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' },
    hints
  );
  delete env.ELECTRON_RUN_AS_NODE;
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null) {
      env[key] = String(value);
    }
  }
  return env;
}
