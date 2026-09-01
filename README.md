# npm-run Manager

[English](#english) | [中文](#中文)

Visual npm scripts manager for VSCode and any VSCode-based editor — Cursor, Windsurf, Kiro, Trae, CodeBuddy, Tongyi Lingma, Baidu Comate, Void, VSCodium and more: scan all npm projects in your workspace (monorepo friendly), run any script with one click, and **automatically track every listening port/service spawned by the script** — kill or restart a single service without stopping the others.

> UI languages: follows the editor display language (中文 / English).

## 中文

npm 脚本可视化管理面板（VSCode、Cursor、Windsurf、Kiro、Trae、CodeBuddy、通义灵码、文心快码、Void、VSCodium 等 VSCode 系编辑器通用）：

- **项目扫描**：自动扫描工作区内所有 npm 项目（支持 monorepo 子包，排除 `node_modules` 等），按项目分组展示 scripts
- **运行状态一目了然**：项目行带绿色圆点与「运行中 (n)」计数（每个运行中脚本按其监听服务数计，含外部运行），项目收起后也能一眼看出里面还有活着的进程
- **活动栏徽标**：有服务运行时活动栏图标显示数量角标（口径与项目行「运行中 (n)」一致），不用展开面板也能一眼看出还有活着的进程
- **一键运行**：脚本行内 ▶ 按钮运行，输出实时流入输出面板（按脚本复用，保留历史）；启动的进程自带与集成终端一致的编辑器标识环境变量，code-inspector-plugin（点击页面元素跳转源码）等工具与终端里手动 `npm run` 行为一致
- **常用命令**：每个项目下默认折叠的「常用命令」分组，提供 install / ci / update / remove / prune / outdated，一键运行；包管理器按 lockfile 自动识别（npm / pnpm / yarn），pnpm 项目不会误跑 `npm install`，remove 会先让你输入包名
- **多端口服务追踪**：脚本运行后自动发现其进程树监听的所有端口，作为服务子节点实时增删——一个脚本跑出多个服务一目了然
- **服务管理**：服务节点显示 IP + 端口，可单独结束某一个服务（如 `concurrently` 同时起的 3 个服务只杀 1 个），也可单独重启某一个服务，其余不受影响；依赖主进程的 worker（如 Next.js dev）单独重启/结束必败，其 ⟳ 自动显示为禁用图标并提示改用脚本行的 ⟳/■（↗ 在浏览器打开不受影响）
- **在浏览器打开**：脚本行 / 服务行的 ↗ 按钮用默认浏览器打开监听地址（`0.0.0.0` / `[::]` 等通配地址自动转 `localhost`），脚本有多个端口时先选一个
- **外部脚本检测**：在别的 IDE / 终端启动的 `npm run dev` 也能看到——打开面板或点击刷新时做一次进程快照，通过命令行中的 `node_modules` 路径把外部脚本精确匹配回项目（npm / pnpm / yarn 均支持），显示"外部运行中 · PID"及其监听端口，可一键结束；检测为用户触发的快照式，无后台轮询
- **端口冲突处理**：脚本因端口被占（`EADDRINUSE`）失败时，自动区分"被自己其他脚本占用"与"被外部进程占用"，后者提供二次确认的一键结束
- **启动组**：脚本行右键「添加到启动组」（选已有组或新建），树顶 🚀 组行 ▶ 一键启动全部成员——monorepo 多包 dev 一发拉起；组可展开看成员实时运行状态，成员 ✕ 移除、整组确认后删除；运行中 / 外部运行中的成员自动跳过并在汇总通知中说明；配置存于工作区 `npm-run.groups`，手动编辑同样有效
- **崩溃通知**：后台脚本异常退出（退出码非 0 且并非你主动停止，如 dev 服务挂掉）时弹通知，「查看输出」直达日志末尾；正常结束（如 build 完成）、主动停止/重启与「扩展代管」转换不打扰
- **安全退出**：关闭窗口 / 卸载扩展时自动清理全部进程树，不残留孤儿进程

### 界面结构

```
🚀 dev-all         运行中 (2) · 3 个脚本                  [▶ ■ 📄 ↗]
├─ ⌨ web-app · dev          运行中                         [⟳ ■ 📄 ↗ ✕]
├─ ⌨ admin-app · dev        运行中                         [⟳ ■ 📄 ↗ ✕]
└─ ⌨ mono-suite · dev       （未运行）                      [▶ ✕]
🟢 项目名（如 app-a）            运行中 (3)   ← 绿点+计数，项目收起也可见
├─ ⌨ dev (运行中)               vite --host   [⟳ ■ 📄 ↗]
│  ├─ 📡 127.0.0.1:5173 · [::]:5173  PID 1234  [⟳ ✕ ↗]
│  └─ 📡 127.0.0.1:3000              PID 5678  [⟳ ✕ ↗]
├─ ⌨ preview (外部运行中 · PID 8821)            [▶ ✕ ↗]
│  └─ 📡 127.0.0.1:4173               PID 8835      [↗]
├─ ⌨ build                      vite build       [▶]
└─ 🔧 常用命令                   6 个命令（默认折叠）
   ├─ ⌨ install                 npm install          [▶]
   └─ ⌨ remove <pkg>            npm uninstall <pkg>  [▶]
```

### 使用

1. 点击活动栏 npm-run 图标打开面板（打开或点击刷新时自动检测外部运行的脚本）
2. 展开项目 → 点击脚本行右侧 ▶ 运行
3. 运行中脚本自动展开服务列表：
   - 服务行点 ⟳ **仅重启该服务**（其余服务不受影响），点 ✕ 单独结束；若脚本只有这一个服务，⟳ 会直接重启整个脚本（效果必然等价）
   - 脚本行点 ⟳ 重启整个脚本，点 ■ 停止整个脚本
   - 点 ↗ 用默认浏览器打开监听地址（`0.0.0.0` / `[::]` 等通配地址自动转为 `localhost`）；脚本行有多个端口时先选一个
4. 点击脚本名或 📄 按钮查看实时输出
5. 若启动器进程退出（如 `concurrently` 场景）但仍有被单独重启过的服务在跑，脚本行显示**扩展代管**，服务继续被追踪，停止时统一清理
6. **外部运行中**的脚本（在别的 IDE / 终端启动）：显示 ● 实心圆图标与外部 PID，展开可见其监听端口；点 ▶ 运行前会提示可能端口冲突，点 ✕ 结束外部进程树；检测结果为快照，点击该行或刷新按钮重新检测
7. **常用命令**默认折叠在项目末尾：展开即可一键运行 install / ci / update / remove / prune / outdated；包管理器按 lockfile 自动识别（npm / pnpm / yarn），`remove` 会先请你输入包名
8. **启动组**：视图顶部 ＋ 按钮新建组（输入组名 → 多选脚本一次收集成员），或脚本行右键「添加到启动组」逐个收集；树顶组行聚合显示「运行中 (m) · n 个脚本」与旋转图标，▶ 一键启动全部成员（运行中 / 外部运行中的自动跳过并在汇总通知中说明）、■ 停止全组、📄 查看输出（多成员先选）、↗ 在浏览器打开（聚合全部成员端口）；运行中的成员行 ⟳ 重启、■ 停止、📄 输出、↗ 浏览器、✕ 移除（未运行成员只有 ▶ 启动 ✕ 移除，按钮语义与脚本行一致）；组行右键删除（不影响正在运行的脚本）；配置存于工作区 `npm-run.groups`，手动编辑同样生效

### 配置

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `npm-run.exclude` | `["**/node_modules/**", ...]` | 扫描 package.json 时排除的 glob |
| `npm-run.pollIntervalMs` | `1500` | 端口/进程轮询间隔（毫秒），修改即时生效 |
| `npm-run.env` | `{}` | 注入到扩展启动的每个脚本进程的环境变量，如 `{ "CODE_INSPECTOR": "1" }`——仅用于必须直接读进程环境的工具；项目级开关放 `.env.local`（Next.js 等框架自动加载）通常更合适，多数项目零配置 |
| `npm-run.groups` | `{}` | 启动组：组名 → 「项目:脚本」引用数组（如 `{ "dev-all": ["apps/web:dev"] }`）；通过树视图右键「添加到启动组」管理，也可手动编辑 |

## English

Visual npm scripts manager for VSCode and any VSCode-based editor (Cursor, Windsurf, Kiro, Trae, CodeBuddy, Tongyi Lingma, Baidu Comate, Void, VSCodium, ...):

- **Project scan**: finds every `package.json` in the workspace (monorepo friendly, `node_modules` excluded), groups scripts by project
- **Running at a glance**: the project row shows a green dot and a `running (n)` count (each running script counted by its listening services, external runs included), so a collapsed project never hides what is still running inside
- **Activity-bar badge**: while services are running, the activity-bar icon carries a numeric badge (same counting as the project rows' `running (n)`), so you can tell something is still up without opening the view
- **One-click run**: inline ▶ button per script (⟳ restarts the whole script, ■ stops it); output streams into a per-script output channel; spawned processes carry the same editor-identity env vars as the integrated terminal, so tools like code-inspector-plugin (click a page element to jump to source) behave exactly as when you `npm run` in a terminal
- **Common commands**: a collapsible group per project with install / ci / update / remove / prune / outdated, run with one click; the package manager is detected from the lockfile (npm / pnpm / yarn) so a pnpm project never runs `npm install`, and `remove` asks for the package name first
- **Multi-port service tracking**: automatically discovers every listening port of the script's process tree and shows them as service children — one script, multiple services, at a glance
- **Per-service control**: each service node shows IP + port with ⟳ restart and ✕ kill buttons; restart or kill just one service (e.g. one of three started via `concurrently`) without touching the others; workers that depend on the script main process (e.g. Next.js dev) get a disabled icon instead of ⟳/✕ (killing them takes the whole script down), hinting at the script row's ⟳/■ — ↗ open-in-browser stays available
- **Open in browser**: ↗ on a script or service row opens its listening address in the default browser (`0.0.0.0` / `[::]` wildcards become `localhost`); when a script listens on several ports you pick one first
- **External script detection**: scripts started outside the extension (another IDE, a terminal) are visible too — opening the panel or clicking refresh takes a one-shot process snapshot and matches external `npm run` commands back to their project via the `node_modules` path in the process command line (npm / pnpm / yarn supported), showing "external · PID" with its listening ports and a one-click kill; detection is strictly user-triggered, no background polling
- **Port conflict handling**: on `EADDRINUSE`, tells you whether the port is held by another of *your* scripts or an external process, and offers a confirmed one-click kill for the latter
- **Launch groups**: right-click any script row → "Add to Launch Group" (pick an existing group or create one); a rocket row at the top of the tree then starts every member with one ▶ click (monorepo multi-package dev in one shot). Groups are expandable (members show live running state), members can be removed via ✕, whole groups deleted after a confirm; runs skip already-running and externally-running members with a summary notice; settings live in workspace `npm-run.groups` and can be hand-edited too
- **Crash notification**: when a script exits abnormally (non-zero exit code, not stopped by you — e.g. a dev server that died) a notification pops with a "Show Output" button jumping to the last log lines; normal exits (e.g. a finished build), user-initiated stops/restarts and the "extension-adopted" transition never disturb you
- **Clean exit**: kills all process trees when the window closes or the extension is deactivated — no orphan processes

### Panel layout

```
🚀 dev-all         running (2) · 3 scripts                  [▶ ■ 📄 ↗]
├─ ⌨ web-app · dev          running                          [⟳ ■ 📄 ↗ ✕]
├─ ⌨ admin-app · dev        running                          [⟳ ■ 📄 ↗ ✕]
└─ ⌨ mono-suite · dev       (not running)                    [▶ ✕]
🟢 project name (e.g. app-a)     running (3)   ← green dot + count, visible even when collapsed
├─ ⌨ dev (running)              vite --host   [⟳ ■ 📄 ↗]
│  ├─ 📡 127.0.0.1:5173 · [::]:5173  PID 1234  [⟳ ✕ ↗]
│  └─ 📡 127.0.0.1:3000              PID 5678  [⟳ ✕ ↗]
├─ ⌨ preview (external · PID 8821)              [▶ ✕ ↗]
│  └─ 📡 127.0.0.1:4173               PID 8835      [↗]
├─ ⌨ build                      vite build       [▶]
└─ 🔧 Common Commands            6 commands (collapsed)
   ├─ ⌨ install                 npm install          [▶]
   └─ ⌨ remove <pkg>            npm uninstall <pkg>  [▶]
```

### Usage

1. Open the panel via the npm-run icon in the activity bar (opening it or clicking refresh also detects externally started scripts)
2. Expand a project → click ▶ on a script row to run it
3. A running script auto-expands its services:
   - ⟳ on a service row restarts **only that service** (others unaffected), ✕ kills just that one; if the script has a single service, ⟳ restarts the whole script directly (always equivalent)
   - ⟳ on the script row restarts the whole script, ■ stops it
   - ↗ opens the listening address in your default browser (`0.0.0.0` / `[::]` wildcards become `localhost`); if the script listens on several ports you pick one first
4. Click the script name or the 📄 button to view live output
5. If the launcher process exits (e.g. `concurrently`) while separately-restarted services keep running, the script row shows an **adopted** state; services stay tracked and are cleaned up together on stop
6. **Externally started** scripts (from another IDE / terminal): shown with a ● filled-circle icon and the external PID, expandable to their listening ports; ▶ warns about possible port conflicts before running, ✕ kills the external process tree; results are snapshot-based — click the row or the refresh button to re-detect
7. **Common Commands** is collapsed at the end of each project: expand it to run install / ci / update / remove / prune / outdated with one click; the package manager is detected from the lockfile (npm / pnpm / yarn), and `remove` asks for the package name first
8. **Launch groups**: the ＋ button in the view title creates a group (enter a name, then multi-pick scripts in one shot), or right-click script rows → "Add to Launch Group" to collect them one by one; the group row aggregates `running (m) · n scripts` with a spinner, and offers ▶ start all (already-running and externally-running members skipped, stated in a summary notice), ■ stop all, 📄 show output (pick when several run) and ↗ open in browser (aggregates all members' ports); running member rows offer ⟳ restart, ■ stop, 📄 output, ↗ browser and ✕ remove (non-running members just ▶ start ✕ remove — button semantics match script rows); delete the group from its context menu (running scripts unaffected); settings live in workspace `npm-run.groups` and hand-editing works too

### Configuration

| Setting | Default | Description |
|---|---|---|
| `npm-run.exclude` | `["**/node_modules/**", ...]` | Glob patterns excluded when scanning for package.json |
| `npm-run.pollIntervalMs` | `1500` | Port/process poll interval in ms; changes apply immediately |
| `npm-run.env` | `{}` | Environment variables injected into every script process started by the extension, e.g. `{ "CODE_INSPECTOR": "1" }` — only for tools that must read the process environment directly; project-level switches usually belong in `.env.local` (frameworks like Next.js load it automatically), so most projects need no configuration |
| `npm-run.groups` | `{}` | Launch groups: name → array of `"project:script"` refs (e.g. `{ "dev-all": ["apps/web:dev"] }`); managed via the "Add to Launch Group" context action in the tree view, or edited by hand |

## License

MIT
