# Changelog / 更新日志

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
