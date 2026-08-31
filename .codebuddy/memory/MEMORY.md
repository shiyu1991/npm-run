# npm-run 项目记忆

## 项目定位
- d:\workspace\npm-run 是 VSCode 扩展 "npm-run Manager"（package.json name: npm-run-manager，当前 0.8.2；已发布至 0.8.1，0.8.2 待发）
- 功能：扫描工作区 npm 项目、一键运行脚本、按端口追踪/结束服务、外部脚本运行检测（手动刷新）、常用命令、在浏览器打开
- 构建：esbuild（node esbuild.js），测试：mocha（out-test），仅 Windows 集成测试在 test/integration.test.ts
- fixtures/app-a 起两个静态 server（45731/45732）；app-b 固定端口 45800

## 0.8.2 脚本进程环境三件套（2026-08-31，用户已实测通过，待发市场）
- 起因：用户 core 项目（z-vlm-forge）经面板跑 dev:webpack + code-inspector-plugin，点击页面元素无法跳源码；hover"运行脚本"（集成终端）正常
- **终极根因：ELECTRON_RUN_AS_NODE=1**——VSCode 系扩展宿主自身以纯 Node 模式运行，该变量遗传给 spawn 的脚本进程；launch-ide 再启动编辑器 exe（同 Electron 二进制）被拉成纯 Node 模式，`-g` 被拒 exit 9（Node 非法选项退出码=9，stderr "bad option: -g"）。集成终端由主进程（GUI 模式）派生无此变量故正常。**修复：spawnEnv() 里 delete env.ELECTRON_RUN_AS_NODE**
- **新增配置 npm-run.env**（object）：注入到所有 spawn（run/respawnService）的用户环境变量，spawn 时一次性读取（改配置必须 ⟳ 重启脚本）；合并优先级 process.env < 编辑器标识 < 用户 env（String 归一，undefined/null 跳过）。用户场景配 `{"CODE_INSPECTOR":"1","CODE_EDITOR":"<CodeBuddy CN.exe 全路径>"}`
- src/editorEnv.ts：withEditorHints（补 TERM_PROGRAM/VSCODE_PID/VSCODE_CWD，已有不覆盖——launch-ide 不看这些，属 react-dev-utils 类工具的兼容增强）+ spawnEnv（完整环境组装）。ScriptRunner 构造注入 () => 配置读取器
- 测试 test/editorEnv.test.ts 9 用例；全量 87 pass；VSIX 90.24KB

## launch-ide / code-inspector-plugin 机制（排查所得，跨项目有用）
- launch-ide（@code-inspector/core 依赖）编辑器识别优先级：**CODE_EDITOR env/.env.local（唯一支持完整 exe 路径的入口，`F(路径)=null → 直接采用`）> 插件 editor 配置（只认系列名 idea/code/codebuddy…，传路径会被忽略落回扫描）> usePid 父进程链（core 未启用）> Get-CimInstance 全量进程扫描（固定顺序 kiro→…→codebuddy→code→…，找 basename 精确匹配的运行进程，返回完整路径）> VISUAL/EDITOR**
- editor:'idea' 语义 = "优先返回运行中的 idea*.exe"，没运行则退回扫描顺序第一个命中（本机常是 CodeBuddy CN.exe）
- Next.js 在求值 next.config 前加载 .env.local → config 里 process.env.CODE_INSPECTOR 能读到 .env.local 的值（无需终端手动设）；launch-ide 的 Z() 读 .env.local 时 process.env 优先
- 诊断手法：patch 第三方包 dist（备份→锚点替换→本地验证→现场抓 [LI-DBG] 日志→恢复）；execute_command 的 shell ≈ 扩展宿主同源环境，但**无 ELECTRON_RUN_AS_NODE**（工具进程非 EH 直接派生），复现"扩展 spawn 环境"问题时注意这点差异
- PowerShell Test-Path 中文路径可能乱码误报文件不存在——用 node fs 或看 Next 启动日志（Environments 行）确认

## 0.7.x 外部脚本检测（方案B：手动刷新快照，已装 2026-08-26）
- 需求：用户在别的 IDE/终端 npm run dev，本扩展刷新后树视图显示"外部运行中"
- src/externalDetect.ts（纯逻辑可单测）：matchExternalScripts(procs, sockets, projects, excludePids) → Map<dir|script, ExternalHit>，**按"run 层链"组织（0.7.2 定稿）**
  - 链根 = 祖先中无其他 run 层的最顶层进程（如 powershell -Command "npm run dev" 终端包装层）；链内任一 pid 在排除集 → 整链跳过
  - **A 级（确定归属）**：链内非 run 层进程 cmdline 含 `<项目dir>\node_modules\`（normPath 规范化）→ 挂该项目，needle 更长者优先；脚本名须在该项目声明中
  - **C 级（确定排除）**：链内有 node_modules 路径但不指向工作区任何项目（其他 IDE 的工作区外项目）→ 不显示。关键：链上 run 层自身的包管理器全局路径（C:\Program Files\nodejs\node_modules\npm\...）不算证据，否则 npm 中间层会误触 C 级
  - **B 级（唯一候选）**：链内完全无路径证据（node launcher.js 相对路径脚本，app-a 类）→ 候选 = 声明该 script 的工作区项目，仅唯一候选时挂；多候选（如 fixtures app-a/app-b 都有 dev）宁缺毋滥不显示
  - extractScriptToken：显式 `npm|pnpm|yarn... run <token>` 优先；pnpm/yarn 简写兜底（排除 50+ 内置命令）；token 完整词防 dev 误配 dev:watch
- 0.7.2 新增：treeView.onDidChangeVisibility(visible) → 自动 refresh（点活动栏图标展开即检测，仍属用户主动触发）；refreshing 防并发标志 + treeView.message "正在扫描项目并检测外部脚本…"（i18n t.detecting）
- ExternalHit：runPid（链根，kill 的树根）、pids、cmdline、ports（链子树内监听端口）
- extension.ts：externalRunning Map<key, ExternalState{hit,detectedAt}>（clear+set）；refresh = scanner.refresh + detectExternal + provider.refresh；startScript 外部命中先弹警告，自身启动成功后 delete 条目；killExternal（modal 确认 → killProcessTree(runPid)）
- treeProvider：三态 script / script-running / script-external（circle-filled，"外部运行中 · PID"，tooltip 含 cmdline+检测时间，点击行=重新刷新）；external-port 只读子节点
- 测试：test/externalDetect.test.ts 18 用例（C 级 IDEA 回归、B 级唯一候选/多候选、链根全局路径不算证据等）；全量 59 过；tsc 干净
- **端到端已实测**（真实快照 + 新模块）：本仓库 npm run watch（A 级，esbuild.exe service 子进程提供路径）✓；fixtures/app-a npm run dev（B 级，唯一候选时）✓ runPid 正确指向 powershell 链根；IDEA 的 nuxt/next dev 链（C 级）正确不显示
- 0.7.2.vsix（49.83KB，13 文件）已装 CodeBuddy；**已发布双市场（2026-08-26）：Marketplace DONE、Open VSX latest=0.7.2 均验证通过；git 由用户自行提交推送（203e907）**
- 诊断经验：Win32_Process 是唯一真相源；esbuild CLI 参数在外层 PowerShell 易出问题，用 esbuild JS API 写 .cjs 脚本打包临时模块最稳

## 0.7.4（2026-08-30 完成，版本号与 CHANGELOG 已写，未发市场）
- 树视图「在浏览器打开」：命令 npm-run.openInBrowser（link-external 图标），inline 覆盖 script-running / script-external / service / service-root / external-port（显式 5 条 when，不用正则）
- `src/urlBuilder.ts` → `toBrowseUrl(addresses, port)`：通配/回环地址 → localhost，网卡 IP 原样，IPv6 补方括号，443 用 https 其余 http
- 项目下「常用命令」分组（默认折叠）：`src/builtins.ts` 按包管理器生成 install / ci / update / remove / prune / outdated；remove 弹输入框要包名
- 包管理器按 lockfile 识别（pnpm-lock.yaml / yarn.lock / package-lock.json）→ `NpmProject.packageManager`；yarn 无 prune 等价物故不显示该条
- 内置命令实例 key 用 `builtin:<id>` 前缀：package.json 允许 install 等生命周期脚本，共用 key 会让 `npm run install` 与 `npm install` 状态串台
- `runner.run` 新增第 4 参 `opts{cli,args,display}`；i18n `runHeader` 改为接受完整命令串（不再硬编码 "npm run"）
- 内置命令不接入 ServiceMonitor（不监听端口，接入只会空转轮询）；停止与清理复用同一套 instances / stopAll

## 历史要点（详见 git log / CHANGELOG）
- 0.6.x：i18n 双语（代码走 src/i18n.ts 按 vscode.env.language；清单走 package.nls.*.json）+ manifest 本地化；已发布 VSCode Marketplace 与 Open VSX
- 0.5.x：firstPortAnnounced 消除 Next.js Starting→Ready 静默误判；单服务重启 verifyRespawn；单服务脚本重启恒等整脚本重启
- Next.js dev 的端口监听者 start-server.js 是 worker 模式（依赖父 IPC），裸拉起即退出——单服务重启对 Next.js 无效属框架行为

## 环境事实（跨会话有用）
- CodeBuddy CN 的扩展装在 <用户目录>\.codebuddycn\extensions\（不是 .codebuddy）；**本仓库记忆多台机器共用（一台 Administrator、一台 HeShiyu），机器相关路径以当前 %USERPROFILE% 为准，勿盲信旧记录**
- CodeBuddy CLI：<用户目录>\AppData\Local\Programs\CodeBuddy CN\bin\buddycn.cmd（不在 PATH，需带引号用 & 调用）；装完 VSIX 必须重载窗口
- 本地安装：`& "<cli路径>" --install-extension "<vsix绝对路径>" --force`；验证安装结果读 <用户目录>\.codebuddycn\extensions\npm-run-dev.npm-run-manager-<ver>\package.json（workspace 外，用 node 读）
- PowerShell 会吞 $ 和 $_，复杂命令写 .ps1 再 -File；不支持 cd /d 与 head；`node -e` 带中文/引号转义必坏，写 .cjs 文件再跑；**`git commit -m` 中文同样乱码（GBK 字节进历史，显示与存储双重乱）——必须 node .cjs 写 UTF-8 文件再 `git commit -F <file>`**；PowerShell Test-Path 中文路径可能乱码误报，用 node fs 验证
- nls 语言解析只看编辑器显示语言；Open VSX 验证用 /api/<ns>/<ext>/<version> 端点
- .vscodeignore 会覆盖 vsce 默认排除规则，需显式列 src/**、out-test/** 等

## 发布流程（0.8.1 实践版）
- Marketplace：`npx vsce publish -p $env:VSCE_PAT`（vsce 不在 PATH，必须 npx）
- Open VSX：`npx --yes ovsx publish npm-run-manager-<ver>.vsix -p $env:OVSX_PAT`（Cursor/CodeBuddy 实际源）
- **环境变量不跨命令保留**：设置与发布必须写在同一条命令内
- **ovsx 输出走 stderr，PowerShell 会误报 ❌**，实际可能已成功；用线上 API 验证才是准的
- 验证：Open VSX 用 `https://open-vsx.org/api/<ns>/<ext>` 查 latest（带版本号的端点刚发布时可能查不到）；Marketplace 用 `npx vsce show <ns>.<ext>`，发布后需等索引（几分钟到几十分钟）
- 发前检查：tsc 干净、全量测试过、CHANGELOG 双语条目、package.json 与 package-lock.json 版本号对齐
