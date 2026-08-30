# npm-run Manager

[English](#english) | [中文](#中文)

Visual npm scripts manager for VSCode and any VSCode-based editor — Cursor, Windsurf, Kiro, Trae, CodeBuddy, Tongyi Lingma, Baidu Comate, Void, VSCodium and more: scan all npm projects in your workspace (monorepo friendly), run any script with one click, and **automatically track every listening port/service spawned by the script** — kill or restart a single service without stopping the others.

> UI languages: follows the editor display language (中文 / English).

## 中文

npm 脚本可视化管理面板（VSCode、Cursor、Windsurf、Kiro、Trae、CodeBuddy、通义灵码、文心快码、Void、VSCodium 等 VSCode 系编辑器通用）：

- **项目扫描**：自动扫描工作区内所有 npm 项目（支持 monorepo 子包，排除 `node_modules` 等），按项目分组展示 scripts
- **一键运行**：脚本行内 ▶ 按钮运行，输出实时流入输出面板（按脚本复用，保留历史）
- **常用命令**：每个项目下默认折叠的「常用命令」分组，提供 install / ci / update / remove / prune / outdated，一键运行；包管理器按 lockfile 自动识别（npm / pnpm / yarn），pnpm 项目不会误跑 `npm install`，remove 会先让你输入包名
- **多端口服务追踪**：脚本运行后自动发现其进程树监听的所有端口，作为服务子节点实时增删——一个脚本跑出多个服务一目了然
- **服务管理**：服务节点显示 IP + 端口，可单独结束某一个服务（如 `concurrently` 同时起的 3 个服务只杀 1 个），也可单独重启某一个服务，其余不受影响
- **在浏览器打开**：脚本行 / 服务行的 ↗ 按钮用默认浏览器打开监听地址（`0.0.0.0` / `[::]` 等通配地址自动转 `localhost`），脚本有多个端口时先选一个
- **外部脚本检测**：在别的 IDE / 终端启动的 `npm run dev` 也能看到——打开面板或点击刷新时做一次进程快照，通过命令行中的 `node_modules` 路径把外部脚本精确匹配回项目（npm / pnpm / yarn 均支持），显示"外部运行中 · PID"及其监听端口，可一键结束；检测为用户触发的快照式，无后台轮询
- **端口冲突处理**：脚本因端口被占（`EADDRINUSE`）失败时，自动区分"被自己其他脚本占用"与"被外部进程占用"，后者提供二次确认的一键结束
- **安全退出**：关闭窗口 / 卸载扩展时自动清理全部进程树，不残留孤儿进程

### 界面结构

```
📦 项目名（如 app-a）            3 个脚本
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

### 配置

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `npm-run.exclude` | `["**/node_modules/**", ...]` | 扫描 package.json 时排除的 glob |
| `npm-run.pollIntervalMs` | `1500` | 端口/进程轮询间隔（毫秒），修改即时生效 |

## English

Visual npm scripts manager for VSCode and any VSCode-based editor (Cursor, Windsurf, Kiro, Trae, CodeBuddy, Tongyi Lingma, Baidu Comate, Void, VSCodium, ...):

- **Project scan**: finds every `package.json` in the workspace (monorepo friendly, `node_modules` excluded), groups scripts by project
- **One-click run**: inline ▶ button per script (⟳ restarts the whole script, ■ stops it); output streams into a per-script output channel
- **Common commands**: a collapsible group per project with install / ci / update / remove / prune / outdated, run with one click; the package manager is detected from the lockfile (npm / pnpm / yarn) so a pnpm project never runs `npm install`, and `remove` asks for the package name first
- **Multi-port service tracking**: automatically discovers every listening port of the script's process tree and shows them as service children — one script, multiple services, at a glance
- **Per-service control**: each service node shows IP + port with ⟳ restart and ✕ kill buttons; restart or kill just one service (e.g. one of three started via `concurrently`) without touching the others
- **Open in browser**: ↗ on a script or service row opens its listening address in the default browser (`0.0.0.0` / `[::]` wildcards become `localhost`); when a script listens on several ports you pick one first
- **External script detection**: scripts started outside the extension (another IDE, a terminal) are visible too — opening the panel or clicking refresh takes a one-shot process snapshot and matches external `npm run` commands back to their project via the `node_modules` path in the process command line (npm / pnpm / yarn supported), showing "external · PID" with its listening ports and a one-click kill; detection is strictly user-triggered, no background polling
- **Port conflict handling**: on `EADDRINUSE`, tells you whether the port is held by another of *your* scripts or an external process, and offers a confirmed one-click kill for the latter
- **Clean exit**: kills all process trees when the window closes or the extension is deactivated — no orphan processes

### Panel layout

```
📦 project name (e.g. app-a)     3 scripts
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

### Configuration

| Setting | Default | Description |
|---|---|---|
| `npm-run.exclude` | `["**/node_modules/**", ...]` | Glob patterns excluded when scanning for package.json |
| `npm-run.pollIntervalMs` | `1500` | Port/process poll interval in ms; changes apply immediately |

## License

MIT
