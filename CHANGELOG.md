# Changelog / 更新日志


## 0.7.4 / 2026-08-30

- New: ↗ on script and service rows opens the listening address in your default browser (`0.0.0.0` / `[::]` wildcards become `localhost`); if a script listens on several ports you pick one first
- New: a collapsible "Common Commands" group per project — install / ci / update / remove / prune / outdated, one click to run; the package manager is detected from the lockfile (npm / pnpm / yarn) so a pnpm project never runs `npm install`, and `remove` asks for the package name first
- 新增：脚本行与服务行的 ↗ 按钮可在默认浏览器打开监听地址（`0.0.0.0` / `[::]` 等通配地址自动转为 `localhost`）；脚本有多个端口时先选择再打开
- 新增：每个项目下新增默认折叠的「常用命令」分组——install / ci / update / remove / prune / outdated，一键运行；包管理器按 lockfile 自动识别（npm / pnpm / yarn），pnpm 项目不会误跑 `npm install`，remove 会先让你输入包名

## 0.7.3 / 2026-08-26

- Changed: refreshed extension icon and activity-bar icon — rounded play triangle over a progress bar with a centered dot, matching the new style
- 更换：全新扩展图标与活动栏图标——圆角播放三角 + 居中圆点进度条，风格统一

## 0.7.2 / 2026-08-26

- New: opening the view (clicking the activity-bar icon) now triggers a refresh automatically — detection stays strictly user-initiated, just with a more natural entry point; a "detecting…" hint shows while the snapshot runs
- Improved: three-tier evidence matching. Scripts with no path evidence (e.g. `node launcher.js` relative-path commands, which the previous release could never detect) are now detected when exactly one workspace project declares that script name; a process chain whose `node_modules` paths point outside the workspace (other IDEs' projects) is deterministically excluded; exact `node_modules` path anchoring remains the strongest evidence
- 新增：点击活动栏图标展开视图即自动刷新——检测仍严格由用户主动触发，只是入口更自然；快照期间显示"检测中…"提示
- 改进：三级证据匹配。无路径凭据的脚本（如 `node launcher.js` 相对路径命令，上一版完全检测不到）在工作区内仅一个项目声明该脚本名时可被检测；进程链内 `node_modules` 路径指向工作区外（其他 IDE 的项目）时被确定性排除；`node_modules` 路径精确锚定仍是最强证据

## 0.7.1 / 2026-08-26

- Fixed: external detection no longer guesses by script name — a `npm run dev` started in another project outside the workspace (e.g. from IDEA) is no longer wrongly shown under a workspace project that happens to declare the same script name. Only exact evidence counts: the process command line must contain that project's `node_modules` path. Scripts without path evidence (e.g. bare `node server.js`) are now honestly not shown instead of guessed
- 修复：外部检测不再按脚本名猜测——工作区外的其他项目（如 IDEA 里）启动的 `npm run dev` 不会再错误显示到恰好声明了同名脚本的工作区项目下。只认精确证据：进程命令行必须包含该项目的 `node_modules` 路径。无路径凭据的脚本（如裸 `node server.js`）宁可诚实不显示，也不再猜测

## 0.7.0 / 2026-08-26

- New: external script detection — click the refresh button in the tree view to take a one-shot process/port snapshot and mark scripts started outside the extension (other IDEs, terminals) as "external · PID xxxx", with their listening ports shown as read-only child rows; detection is snapshot-based (no background polling), run again by clicking refresh
- New: scripts started via npm / pnpm / yarn are matched back to their project through the `node_modules` path in the process command line (exact match); matches without path evidence are labeled "possibly external" instead of pretending to be sure
- New: running a script that appears to run externally asks for confirmation first (possible port conflict); the new "Kill External Process" action ends the external process tree after a modal confirm
- 新增：外部脚本检测——点击树视图刷新按钮做一次进程/端口快照，把在扩展外（其他 IDE、终端）启动的脚本标注为"外部运行中 · PID xxxx"，其监听端口以只读子行展示；检测为快照式（无后台轮询），再次点击刷新即重新检测
- 新增：npm / pnpm / yarn 启动的脚本通过进程命令行中的 `node_modules` 路径精确匹配回所属项目；无路径凭据的匹配标"疑似外部运行中"，不装作确定
- 新增：对疑似外部运行中的脚本点运行会先弹确认（防端口冲突）；新增"结束外部进程"操作，modal 确认后结束整条外部进程树

## 0.6.1 / 2026-08-24

- Improved: static texts in the manifest (view name, command titles, configuration descriptions, extension description) are now localized via `package.nls.json` / `package.nls.zh-cn.json` — the whole extension is bilingual now
- 优化：清单静态文案（视图名、命令标题、配置项描述、扩展描述）改用 `package.nls.json` / `package.nls.zh-cn.json` 本地化——扩展实现完全双语

## 0.6.0 / 2026-08-24

- New: i18n support — all user-facing texts (tree view, output panel, dialogs) now follow the editor display language (Chinese for `zh*`, English otherwise)
- 新增：国际化——树视图、输出面板、弹窗等全部用户可见文案跟随编辑器显示语言（`zh*` 中文，其余英文）

## 0.5.4

- Improved: when a script has a single service, restarting it from the service row now restarts the whole script directly (single-service restart is always equivalent — killing the only service makes launcher-style scripts exit anyway), avoiding the "single restart fails → restart whole script manually" two-step for Next.js dev and friends
- 优化：脚本仅有一个服务时，服务行的重启直接执行整脚本重启（单服务重启在效果上必然等价——杀掉唯一服务会导致 launcher 类脚本整体退出），避免 Next.js dev 等场景"单服务重启失败 → 再手动重启整个脚本"的两步操作

## 0.5.3

- Fixed: single-service restart now verifies the port actually resumes listening afterwards; if the new process exits quickly without listening (e.g. the Next.js dev worker depends on its parent IPC), it clearly tells you to restart the whole script instead of failing silently
- 修复：单服务重启后增加端口恢复验证——若新进程很快退出且端口未恢复（如 Next.js dev 的 worker 依赖主进程 IPC，无法独立启动），明确提示"请重启整个脚本"，不再静默无效重启

## 0.5.2

- Improved: prints a notice in the output panel when the first listening port of a script is detected, removing the "stuck" misjudgment during the silent Starting→Ready window (frameworks like Next.js may stay silent 10s+ before printing Ready on warm starts)
- Improved: packaging hygiene — added `.vscodeignore` so only `dist/`, `media/` and metadata ship in the VSIX
- 优化：启动后首次检测到端口监听时在输出面板提示"应用启动中"，消除 Next.js 等框架 Starting→Ready 静默窗口期的"卡死"误判（二次启动打印 Ready 可能需 10s+）
- 优化：打包瘦身——新增 `.vscodeignore`，VSIX 仅包含 `dist/`、`media/` 与元数据

## 0.5.1

- Docs: README and extension description clarify compatibility with all VSCode-based editors (VSCode, Cursor, Windsurf, Kiro, Trae, CodeBuddy, Tongyi Lingma, Baidu Comate, Void, VSCodium, ...)
- Docs: README usage section covers restart operations (⟳ on the script row restarts the whole script, ⟳ on a service row restarts that service only) and the "extension-adopted" state
- 文档：中英文说明及扩展描述明确兼容所有 VSCode 系编辑器（VSCode、Cursor、Windsurf、Kiro、Trae、CodeBuddy、通义灵码、文心快码、Void、VSCodium 等）
- 文档：README 使用说明补充重启操作（脚本行 ⟳ 整脚本重启、服务行 ⟳ 单服务重启）及"扩展代管"状态说明

## 0.5.0

- New: per-service restart — remembers each service's original launch command; restarting a service kills only that one and re-spawns it under extension management (other services unaffected)
- New: when the script's root process exits but adopted services keep running (launcher-style scripts exit naturally once all children were replaced), the instance stays alive in an "extension-adopted" state; stopping the script or closing the window cleans everything up — no orphans
- New: root-process services offer a "restart the whole script" action on the service row
- Fixed: rapid repeated clicks on restart no longer cause restart loops (re-entry guard + immediate feedback in the output panel)
- 新增：单服务独立重启——记住服务的原始启动命令，重启时仅杀掉该服务并由扩展代管拉起（其余服务不受影响）
- 新增：脚本进程退出后若仍有代管服务，实例转入"扩展代管"状态继续运行（launcher/concurrently 类脚本在子进程全部被替换后会自然退出，属正常语义），停止/窗口关闭时统一清理，无孤儿
- 新增：根进程服务行提供"重启整个脚本"入口
- 修复：快速连点重启按钮导致连环重启（防重入保护 + 输出面板即时反馈）

## 0.4.1

- Improved: removed redundant activationEvents declaration (auto-generated from contributes since VSCode 1.74)
- Fixed: missing view icon
- 优化：移除冗余的 activationEvents 声明（VSCode 1.74+ 依据 contributes 自动生成）
- 修复：视图缺少图标（补充 view icon）

## 0.4.0

- New: one-click restart for running scripts (stop → wait for exit & cleanup → start again)
- 新增：运行中脚本支持一键重启（停止 → 等待退出清理 → 自动重新启动）

## 0.3.1

- Reverted: withdrew the external service detection introduced in 0.3.0 due to regressions; restored the stable 0.2.1 behavior
- 回退：撤销 0.3.0 的外部服务检测功能（存在回归问题），恢复 0.2.1 的稳定行为

## 0.2.1

- Renamed: extension ID `npm-run` → `npm-run-manager` (the original ID was taken on the VSCode Marketplace)
- 重命名：扩展 ID `npm-run` → `npm-run-manager`（原 ID 在 VSCode Marketplace 已被占用）

## 0.2.0

- Fixed: script list empty after opening a window (scan-completed event was not wired to the tree refresh)
- Fixed: stopping an already-exited script no longer reports a bogus "stop failed"
- Fixed: duplicate port-conflict popups (each port is reported once per instance)
- Fixed: OutputChannel leak (re-running the same script no longer piles up channels)
- Improved: waits for process-tree cleanup on uninstall/window close — no orphan processes
- Improved: package.json watch excludes node_modules with debounce — no more refresh storms during npm install
- Improved: poll interval config changes apply immediately
- Improved: services sorted by port for a stable list
- Improved: package size 637KB → 27KB
- 修复：打开窗口后脚本列表不显示（扫描完成事件未连接到树刷新）
- 修复：重复停止已退出的脚本误报"停止失败"
- 修复：端口冲突提示重复弹窗（同一实例同一端口只提示一次）
- 修复：OutputChannel 泄漏（同一脚本多次运行不再堆积输出通道）
- 优化：扩展卸载/窗口关闭时等待进程树清理完成，杜绝孤儿进程
- 优化：package.json 监听排除 node_modules 并加防抖，npm install 不再触发刷新风暴
- 优化：轮询间隔配置修改即时生效
- 优化：服务列表按端口排序，显示稳定
- 优化：包体积 637KB → 27KB

## 0.1.0

- Initial release: project scan, one-click run, multi-port service tracking, per-service kill, port conflict hints
- 初始版本：项目扫描、一键运行、多端口服务追踪、单服务结束、端口冲突提示
