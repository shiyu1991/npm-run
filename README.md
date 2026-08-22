# npm-run

[English](#english) | [中文](#中文)

Visual npm scripts manager for VSCode / CodeBuddy: scan all npm projects in your workspace (monorepo friendly), run any script with one click, and **automatically track every listening port/service spawned by the script** — kill a single service without stopping the others.

## 中文

npm 脚本可视化管理面板（VSCode / CodeBuddy）：

- **项目扫描**：自动扫描工作区内所有 npm 项目（支持 monorepo 子包，排除 `node_modules` 等），按项目分组展示 scripts
- **一键运行**：脚本行内 ▶ 按钮运行，输出实时流入输出面板（按脚本复用，保留历史）
- **多端口服务追踪**：脚本运行后自动发现其进程树监听的所有端口，作为服务子节点实时增删——一个脚本跑出多个服务一目了然
- **服务管理**：服务节点显示 IP + 端口，可单独结束某一个服务（如 `concurrently` 同时起的 3 个服务只杀 1 个），其余不受影响
- **端口冲突处理**：脚本因端口被占（`EADDRINUSE`）失败时，自动区分"被自己其他脚本占用"与"被外部进程占用"，后者提供二次确认的一键结束
- **安全退出**：关闭窗口 / 卸载扩展时自动清理全部进程树，不残留孤儿进程

### 界面结构

```
📦 项目名（如 app-a）            3 个脚本
├─ ⌨ dev                        vite --host      [▶]
│  ├─ 📡 127.0.0.1:5173 · [::]:5173   PID 1234  [✕]
│  └─ 📡 127.0.0.1:3000               PID 5678  [✕]
└─ ⌨ build                      vite build       [▶]
```

### 使用

1. 点击活动栏 npm-run 图标打开面板
2. 展开项目 → 点击脚本行右侧 ▶ 运行
3. 运行中脚本自动展开服务列表，点 ✕ 单独结束某服务，点 ■ 停止整个脚本
4. 点击脚本名或 📄 按钮查看实时输出

### 配置

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `npm-run.exclude` | `["**/node_modules/**", ...]` | 扫描 package.json 时排除的 glob |
| `npm-run.pollIntervalMs` | `1500` | 端口/进程轮询间隔（毫秒），修改即时生效 |

## English

Visual npm scripts manager for VSCode / CodeBuddy:

- **Project scan**: finds every `package.json` in the workspace (monorepo friendly, `node_modules` excluded), groups scripts by project
- **One-click run**: inline ▶ button per script; output streams into a per-script output channel
- **Multi-port service tracking**: automatically discovers every listening port of the script's process tree and shows them as service children — one script, multiple services, at a glance
- **Per-service kill**: each service node shows IP + port with a ✕ button; kill one service (e.g. one of three started via `concurrently`) without touching the others
- **Port conflict handling**: on `EADDRINUSE`, tells you whether the port is held by another of *your* scripts or an external process, and offers a confirmed one-click kill for the latter
- **Clean exit**: kills all process trees when the window closes or the extension is deactivated — no orphan processes

## License

MIT
