/**
 * 轻量 i18n：zh* → 中文，其余 → 英文。字典值支持函数（带占位参数）。
 *
 * 故意不依赖 vscode：语言由 activate() 调用 initLang() 注入。
 * 这样 killTree 等纯逻辑模块也能安全使用文案——它们必须在无 vscode 的
 * 环境下可用（Windows 集成测试直接以 node 运行，require('vscode') 会失败）。
 */

const zhDict = {
  // ── 树视图 ──
  scriptsCount: (n: number) => `${n} 个脚本`,
  projectRunning: (n: number) => `运行中 (${n})`,
  projectRunningTip: (n: number) => `${n} 个服务进程运行中（展开查看明细）`,
  running: '运行中',
  adopted: '扩展代管',
  scriptTooltipRunning: (pid: number) => `（PID ${pid}）`,
  scriptTooltipAdopted: '（脚本进程已退出，服务由扩展代管）',
  showOutput: '查看输出',
  runScript: '运行脚本',
  refreshTitle: '刷新并检测外部脚本',
  serviceTooltip: (port: number, addrs: string, pid: number) =>
    `端口 ${port}\n地址 ${addrs}\n进程 PID ${pid}`,
  serviceTooltipRoot: '\n\n该服务由脚本主进程监听\n点击 ⟳ 重启整个脚本',
  serviceTooltipChild: '\n点击 ⟳ 仅重启此服务\n点击 ✕ 结束此服务',
  serviceTooltipNoRespawn:
    '\n\n此服务依赖脚本主进程，无法单独重启或单独结束（单独结束会导致整个脚本退出）\n重启请用脚本行的 ⟳，停止请用脚本行的 ■',
  respawnUnsupported: (port: number) =>
    `服务 :${port} 依赖脚本主进程，无法单独重启，请重启整个脚本（脚本行 ⟳）`,
  killUnsupported: (port: number) =>
    `服务 :${port} 依赖脚本主进程，单独结束会导致整个脚本退出且无法单独恢复；如需停止请用脚本行的 ■`,

  // ── 内置命令 ──
  builtinGroup: '常用命令',
  builtinCount: (n: number) => `${n} 个命令`,
  builtinGroupTooltip: (pm: string) => `${pm} 常用命令，展开后点击即运行`,
  inputPackageName: (cmd: string) => `输入包名（将执行 ${cmd}）`,

  // ── 浏览器打开 ──
  openInBrowser: '在浏览器打开',
  noPortToOpen: '该脚本当前未检测到监听端口，无法打开',
  choosePortToOpen: '选择要打开的地址',

  // ── 外部运行检测（手动刷新快照） ──
  externalRunning: (pid: number) => `外部运行中 · PID ${pid}`,
  externalTooltip: (cmdline: string | undefined, time: string) =>
    cmdline
      ? `外部进程（非本扩展启动）\n命令行: ${cmdline}\n检测于 ${time}，点击刷新重新检测`
      : `外部进程（非本扩展启动）\n检测于 ${time}，点击刷新重新检测`,
  externalPortTooltip: (port: number, addrs: string, pid: number) =>
    `端口 ${port}\n地址 ${addrs}\n进程 PID ${pid}\n外部进程监听，仅展示（无法查看输出/重启）`,
  externalRunWarning: (pid: number, script: string) =>
    `检测到「${script}」可能有外部进程在运行（PID ${pid}），继续启动可能发生端口冲突。仍要运行吗？`,
  continueRun: '仍然运行',
  cancel: '取消',
  confirmKillExternalScript: (pids: string, script: string) =>
    `即将结束外部运行的「${script}」进程树（${pids}），确定继续？`,
  externalKilled: (pid: number) => `外部进程（PID ${pid}）已结束`,
  killExternalFail: (msg: string) => `结束外部进程失败: ${msg}`,
  detecting: '正在扫描项目并检测外部脚本…',

  // ── 运行器 / 输出面板 ──
  alreadyRunning: '脚本已在运行中',
  spawnFail: (msg: string) => `进程启动失败: ${msg}`,
  scriptExited: (code: string | number) => `脚本已退出（代码 ${code}）`,
  runHeader: (time: string, cmd: string, pid: number, dir: string) =>
    `===== ${time} 运行: ${cmd}（PID ${pid}，目录 ${dir}）`,
  adoptedNotice: '启动器进程已结束，剩余服务由扩展代管继续运行（停止脚本将结束全部服务）',
  restarting: '正在重启...',
  // 单服务重启
  respawnNoCmdline: '无法获取该服务的启动命令，不能单独重启',
  respawnFailNoPid: (port: number) => `重启服务 :${port} 失败：进程未创建`,
  respawned: (port: number, pid: number, cmd: string) =>
    `已重启服务 :${port}（新 PID ${pid}，命令: ${cmd}）`,
  respawnSpawnErr: (port: number, msg: string) => `重启的服务 :${port} 启动失败: ${msg}`,
  verifyFailNewExited: '新进程已退出',
  verifyFailTimeout: '8 秒内未见端口监听',
  verifyFailMsg: (port: number, reason: string) =>
    `服务 :${port} 重启后未恢复监听（${reason}）。该服务可能依赖脚本主进程（如 Next.js dev 的 worker），无法单独重启，请重启整个脚本（脚本行 ⟳）`,
  verifyFailQuick: (port: number) =>
    `服务 :${port} 无法单独重启（可能依赖脚本主进程），请重启整个脚本`,
  singleServiceRedirect: (port: number) => `该脚本仅有一个服务 :${port}，直接重启整个脚本`,

  // ── 监控提示 ──
  portListening: (ports: string) =>
    `检测到服务监听 ${ports}，应用启动中（框架打印 Ready 前可能静默 10s+，属正常）`,

  // ── 崩溃通知 ──
  crashNotified: (name: string, script: string, code: string | number) =>
    `「${name} · ${script}」异常退出（代码 ${code}）`,

  // ── 启动组 ──
  groupUnresolved: (n: number) => `${n} 个未解析`,
  groupTooltipTitle: (name: string) => `启动组「${name}」\n点击 ▶ 启动全部成员`,
  memberUnresolved: '未解析（项目不存在或脚本未声明）',
  memberTooltip: '\n⟳ 重启 · ■ 停止 · 📄 查看输出 · ↗ 在浏览器打开',
  memberTooltipIdle: '\n▶ 启动该脚本 · ✕ 从组移除',
  pickMemberOutput: '查看哪个成员的输出？',
  groupResult: (name: string, started: number, skipped: number, failed: number, unresolved: number) =>
    `启动组「${name}」：已启动 ${started} · 跳过 ${skipped} · 失败 ${failed} · 未解析 ${unresolved}`,
  addToGroupPick: (script: string) => `将「${script}」添加到哪个启动组？`,
  newGroupOption: '新建启动组…',
  newGroupNamePrompt: '输入新启动组名称',
  pickGroupMembers: '选择组成员（可多选；稍后也可右键脚本行继续添加）',
  groupCreated: (name: string, n: number, appended: boolean) =>
    n > 0
      ? `启动组「${name}」${appended ? '已存在，新添' : '已创建（'}${n} 个成员${appended ? '' : '）'}`
      : `启动组「${name}」${appended ? '已存在（未选择新成员）' : '已创建（空），右键任意脚本行「添加到启动组」收集成员'}`,
  confirmDeleteGroup: (name: string, n: number) =>
    `即将删除启动组「${name}」（${n} 个成员，不影响正在运行的脚本），确定？`,
  confirmDeleteBtn: '删除',
  groupWriteFail: (msg: string) => `保存启动组配置失败: ${msg}`,

  // ── 交互弹窗 ──
  conflictOwnedByScript: (port: number, name: string, script: string) =>
    `端口 ${port} 被脚本「${name} · ${script}」占用，请先停止该脚本后重试`,
  conflictExternal: (port: number, pid: number, script: string) =>
    `端口 ${port} 被外部进程（PID ${pid}）占用，脚本「${script}」服务启动失败`,
  killOccupier: '结束占用进程',
  ignore: '忽略',
  confirmKillExternal: (pid: number, addrs: string) =>
    `即将结束外部进程 PID ${pid}（${addrs}），确定继续？`,
  confirmKillBtn: '结束进程',
  processKilled: (pid: number) => `进程 PID ${pid} 已结束`,
  warnAlreadyRunning: '脚本已在运行中，请先停止',
  startFail: (msg: string) => `启动失败: ${msg}`,
  stopFail: (msg: string) => `停止失败: ${msg}`,
  notRunning: '脚本未在运行',
  restartServiceFail: (msg: string) => `重启服务失败: ${msg}`,
  restartingService: (port: number) => `正在重启服务 :${port}...`,
  killRootService: '该服务由脚本主进程监听，请停止整个脚本（■ 按钮）',
  killServiceFail: (msg: string) => `结束服务失败: ${msg}`,
  taskkillFail: (msg: string) => `taskkill 失败: ${msg}`,
  serviceKilled: (port: number, pid: number) => `已结束服务 :${port}（PID ${pid}）`,
};

const enDict: typeof zhDict = {
  // ── Tree view ──
  scriptsCount: (n: number) => `${n} script${n === 1 ? '' : 's'}`,
  projectRunning: (n: number) => `running (${n})`,
  projectRunningTip: (n: number) => `${n} service process${n === 1 ? '' : 'es'} running (expand for details)`,
  running: 'running',
  adopted: 'adopted',
  scriptTooltipRunning: (pid: number) => ` (PID ${pid})`,
  scriptTooltipAdopted: ' (launcher exited, services adopted by the extension)',
  showOutput: 'Show Output',
  runScript: 'Run Script',
  refreshTitle: 'Refresh & detect external scripts',
  serviceTooltip: (port: number, addrs: string, pid: number) =>
    `Port ${port}\nAddresses ${addrs}\nProcess PID ${pid}`,
  serviceTooltipRoot: '\n\nListened by the script main process\nClick ⟳ to restart the whole script',
  serviceTooltipChild: '\nClick ⟳ to restart only this service\nClick ✕ to kill this service',
  serviceTooltipNoRespawn:
    '\n\nThis service depends on the script main process; it can neither restart nor be killed alone (killing it takes down the whole script)\nUse ⟳ to restart or ■ to stop via the script row',
  respawnUnsupported: (port: number) =>
    `Service :${port} depends on the script main process and cannot restart alone — please restart the whole script (⟳ on the script row)`,
  killUnsupported: (port: number) =>
    `Service :${port} depends on the script main process; killing it alone takes down the whole script and cannot be revived alone — use ■ on the script row to stop`,

  // ── Built-in commands ──
  builtinGroup: 'Common Commands',
  builtinCount: (n: number) => `${n} command${n === 1 ? '' : 's'}`,
  builtinGroupTooltip: (pm: string) => `Common ${pm} commands; expand and click to run`,
  inputPackageName: (cmd: string) => `Package name (will run ${cmd})`,

  // ── Open in browser ──
  openInBrowser: 'Open in Browser',
  noPortToOpen: 'No listening port detected for this script yet',
  choosePortToOpen: 'Select an address to open',

  // ── External run detection (manual refresh snapshot) ──
  externalRunning: (pid: number) => `external · PID ${pid}`,
  externalTooltip: (cmdline: string | undefined, time: string) =>
    cmdline
      ? `External process (not started by this extension)\nCommand: ${cmdline}\nDetected at ${time}; click refresh to re-detect`
      : `External process (not started by this extension)\nDetected at ${time}; click refresh to re-detect`,
  externalPortTooltip: (port: number, addrs: string, pid: number) =>
    `Port ${port}\nAddresses ${addrs}\nProcess PID ${pid}\nListened by an external process; display only (no output/restart)`,
  externalRunWarning: (pid: number, script: string) =>
    `"${script}" may already be running externally (PID ${pid}); starting it again may cause a port conflict. Run anyway?`,
  continueRun: 'Run anyway',
  cancel: 'Cancel',
  confirmKillExternalScript: (pids: string, script: string) =>
    `About to kill the externally running "${script}" process tree (${pids}). Continue?`,
  externalKilled: (pid: number) => `External process (PID ${pid}) terminated`,
  killExternalFail: (msg: string) => `Failed to kill external process: ${msg}`,
  detecting: 'Scanning projects & detecting external scripts…',

  // ── Runner / output panel ──
  alreadyRunning: 'Script is already running',
  spawnFail: (msg: string) => `Failed to start process: ${msg}`,
  scriptExited: (code: string | number) => `Script exited (code ${code})`,
  runHeader: (time: string, cmd: string, pid: number, dir: string) =>
    `===== ${time} Run: ${cmd} (PID ${pid}, dir ${dir})`,
  adoptedNotice:
    'Launcher process ended; remaining services keep running under extension management (stopping the script will kill them all)',
  restarting: 'Restarting...',
  // Single-service restart
  respawnNoCmdline: 'Cannot get the launch command of this service; single restart unavailable',
  respawnFailNoPid: (port: number) => `Failed to restart service :${port}: process not created`,
  respawned: (port: number, pid: number, cmd: string) =>
    `Service :${port} restarted (new PID ${pid}, command: ${cmd})`,
  respawnSpawnErr: (port: number, msg: string) => `Restarted service :${port} failed to start: ${msg}`,
  verifyFailNewExited: 'new process exited',
  verifyFailTimeout: 'no listener within 8s',
  verifyFailMsg: (port: number, reason: string) =>
    `Service :${port} did not resume listening after restart (${reason}). It probably depends on the script main process (e.g. the Next.js dev worker) and cannot restart alone — please restart the whole script (⟳ on the script row)`,
  verifyFailQuick: (port: number) =>
    `Service :${port} cannot restart alone (probably depends on the script main process) — please restart the whole script`,
  singleServiceRedirect: (port: number) =>
    `This script has a single service :${port}; restarting the whole script instead`,

  // ── Monitor notices ──
  portListening: (ports: string) =>
    `Detected service listening on ${ports}; app is starting (frameworks may stay silent 10s+ before printing Ready — this is normal)`,

  // ── Crash notice ──
  crashNotified: (name: string, script: string, code: string | number) =>
    `"${name} · ${script}" exited abnormally (code ${code})`,

  // ── Launch groups ──
  groupUnresolved: (n: number) => `${n} unresolved`,
  groupTooltipTitle: (name: string) => `Launch group "${name}"\nClick ▶ to start all members`,
  memberUnresolved: 'Unresolved (project not found or script not declared)',
  memberTooltip: '\n⟳ restart · ■ stop · 📄 show output · ↗ open in browser',
  memberTooltipIdle: '\n▶ start this script · ✕ remove from group',
  pickMemberOutput: 'Show output of which member?',
  groupResult: (name: string, started: number, skipped: number, failed: number, unresolved: number) =>
    `Launch group "${name}": started ${started} · skipped ${skipped} · failed ${failed} · unresolved ${unresolved}`,
  addToGroupPick: (script: string) => `Add "${script}" to which launch group?`,
  newGroupOption: 'New launch group…',
  newGroupNamePrompt: 'Name of the new launch group',
  pickGroupMembers: 'Pick group members (multi-select; add more anytime via the script row context menu)',
  groupCreated: (name: string, n: number, appended: boolean) =>
    n > 0
      ? `Launch group "${name}": ${appended ? 'appended' : 'created with'} ${n} member${n === 1 ? '' : 's'}`
      : `Launch group "${name}" ${appended ? 'already exists (no new members picked)' : 'created (empty) — right-click any script row → "Add to Launch Group" to collect members'}`,
  confirmDeleteGroup: (name: string, n: number) =>
    `About to delete launch group "${name}" (${n} member${n === 1 ? '' : 's'}; running scripts are not affected). Continue?`,
  confirmDeleteBtn: 'Delete',
  groupWriteFail: (msg: string) => `Failed to save launch group settings: ${msg}`,

  // ── Dialogs ──
  conflictOwnedByScript: (port: number, name: string, script: string) =>
    `Port ${port} is held by script "${name} · ${script}". Stop that script first and retry`,
  conflictExternal: (port: number, pid: number, script: string) =>
    `Port ${port} is held by an external process (PID ${pid}); service of script "${script}" failed to start`,
  killOccupier: 'Kill occupier',
  ignore: 'Ignore',
  confirmKillExternal: (pid: number, addrs: string) =>
    `About to kill external process PID ${pid} (${addrs}). Continue?`,
  confirmKillBtn: 'Kill process',
  processKilled: (pid: number) => `Process PID ${pid} terminated`,
  warnAlreadyRunning: 'Script is already running; stop it first',
  startFail: (msg: string) => `Start failed: ${msg}`,
  stopFail: (msg: string) => `Stop failed: ${msg}`,
  notRunning: 'Script is not running',
  restartServiceFail: (msg: string) => `Restart service failed: ${msg}`,
  restartingService: (port: number) => `Restarting service :${port}...`,
  killRootService: 'This service is listened by the script main process; stop the whole script (■ button)',
  killServiceFail: (msg: string) => `Kill service failed: ${msg}`,
  taskkillFail: (msg: string) => `taskkill failed: ${msg}`,
  serviceKilled: (port: number, pid: number) => `Service :${port} killed (PID ${pid})`,
};

/** 当前语言的词条表；未调用 initLang 时（纯 node 环境）回退中文 */
let current: typeof zhDict = zhDict;

/**
 * 按编辑器显示语言选定词条表，需在 activate() 中调用一次。
 * 展示语言在扩展宿主启动时确定，运行期切换显示语言会重启窗口，故只注入一次即可。
 */
export function initLang(language: string): void {
  current = language.toLowerCase().startsWith('zh') ? zhDict : enDict;
}

/** 词条表访问代理：始终指向当前语言的表（initLang 后可切换） */
export const t: typeof zhDict = new Proxy({} as typeof zhDict, {
  get: (_target, key) => (current as unknown as Record<string, unknown>)[key as string],
}) as typeof zhDict;
