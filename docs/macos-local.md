# Mac 本地部署

本机网页与 Windows 版使用同一份源代码、数据结构和 `127.0.0.1:3456` 地址。支持 Apple Silicon 与 Intel Mac。运行不依赖 Homebrew、Docker、Xcode 或 SQLite 原生编译。

## 首次安装与日常打开

在项目目录双击 `Install.command`。脚本优先使用项目自己的 Node.js，其次使用已安装的 Node.js 24 + npm；找不到时下载官方 Node.js 24.18.0，按固定 SHA256 验证后放在被 Git 忽略的 `.runtime/node/`。归档来自 [Node.js 官方发行目录](https://nodejs.org/download/release/v24.18.0/)，校验值来自同目录的 `SHASUMS256.txt`。安装仅写项目目录，不改系统配置。随后对前后端执行锁文件安装和构建。

以后双击 `Start.command` 在 Google Chrome 打开网页，双击 `Stop.command` 停止后台服务。桌面「日常小院.app」也使用同一入口，复用服务时仍在 Chrome 打开；不依赖系统默认浏览器。未安装或无法打开 Chrome 时，终端会显示地址供手动打开，后台服务继续运行。启动器本身不修改系统默认浏览器设置。Start 会在依赖或构建缺失时自动安装；代码更新后应停止、重新安装构建、再启动。退出浏览器不停止服务。普通安装不设置开机自启；启用下文的每日采集补采后，有到期任务时会自动启动本项目服务。

## 可选的每日采集与开机补采

本机安装与 Chrome 扩展连接完成后，双击 `Enable-DailyCollection.command`。它在当前用户的 `~/Library/LaunchAgents/` 安装仅属于当前项目目录的后台检查，登录后运行、每60秒检查。纽约10点后首次登录或从睡眠唤醒时补上错过的采集，跨天只补最近一次已到期任务。每次实际采集仍要求 Chrome 登录B站、扩展已连接与本机Codex登录可用；不能在登录桌面之前读取浏览器，也不能在关机期间采集。详细规则见[每日采集](daily-collection.md)。

检查器先复用经过验证的正常服务，缺少服务时安全启动，端口被其他进程占用时会失败，不停止无关程序。已启动当天任务后不再每分钟启动服务或打开Chrome；失败或取消后需手动重试。若更新源码，先停用后台检查，安全停止小院、完成构建和重启后再启用。

停用并卸载此后台检查用 `Disable-DailyCollection.command`，仅移除已验证属于当前目录的 LaunchAgent，保留书架、摘要、Codex对话与项目目录。原有Codex10点定时任务独立存在，彻底停用自动采集需同时在其任务卡停用。生成的plist含本机绝对路径，不进入Git；配置不会复制到别人的电脑。启动检查仅保存被Git忽略的 `.runtime/daily-reading-schedule.json`（启用日期）与 `.runtime/daily-reading-browser.json`（最近应采集日期、是否已尝试），不另存观看清单。每日防重复标记由后端原子持久化。

```bash
.runtime/node/bin/node scripts/macos-daily-reading.mjs status
.runtime/node/bin/node scripts/reading-import.mjs daily-status
.runtime/node/bin/node --test scripts/macos-daily-reading.test.mjs scripts/macos-workbench.test.mjs scripts/reading-import.test.mjs
```

`status` 验证后台检查是否已安装和加载，`daily-status` 验证当天读取状态；安装成功不等于某次采集成功。检查器自身的启动错误在 `.runtime/daily-reading.stderr.log`，不记录观看清单。扩展断开或登录失效时，请在Chrome确认扩展启用和B站登录，再通过书架查看或重试。

## 像素图标桌面入口

双击项目中的 `Install-DesktopShortcut.command`，在桌面创建“日常小院.app”。它使用项目已有的原创像素小屋与盆栽标志，多尺寸 `.icns` 图标从 `assets/garden-launcher.png` 按最近邻缩放打包，保留像素边缘，与 Windows 图标使用同一视觉标识。

桌面入口通过 macOS 标准的终端入口打开当前项目的 `Start.command`，自动打开网页并复用已运行的服务。服务启动后可以关闭终端窗口，后台仍继续运行。入口本身不包含源码或个人数据；本机项目路径保存在入口内部，不进入 Git。启动失败会在终端显示原因，后台诊断见 `.runtime/backend.stderr.log`。安装脚本只更新属于同一项目的入口，遇到同名无关文件或其他安装的入口会停止，不覆盖它们。

项目移动后先将旧桌面入口移到废纸篓，再从新位置重建。将“日常小院.app”移到废纸篓只删除桌面入口；源码、个人数据与运行中的后台服务保留。停止服务仍需双击项目中的 `Stop.command`。

终端重建命令：

```bash
./Install-DesktopShortcut.command
```

## 终端使用

也可以在终端进入项目目录：

```bash
./Install.command --run-tests
./Start.command
./Stop.command
```

`./Start.command --no-browser` 只启动后台服务。开发模式：

```bash
export PATH="$PWD/.runtime/node/bin:$PATH"
cd backend
npm run dev
# 在另一个终端进入项目目录，再设置相同 PATH
cd frontend
npm run dev
```

开发网页地址为 `http://127.0.0.1:5173`。已有系统 Node.js 24 时无需设置本机运行时 PATH。

## Windows 数据迁移

GitHub 仅同步代码。待办、书架、学习计划、灵感、AI 对话、项目入口、附件与来源设置均为本机数据；新克隆默认是空小院，Windows 与 Mac 不会自动同步这些记录。

1. 在 Windows 执行 `Stop.cmd`，备份整个 `backend/data/`，以及 `backend/.env.local`。
2. 在 Mac 执行 `Stop.command`，先备份 Mac 已有数据。将 Windows 的 `backend/data/` 整个目录复制过来，包含 `reading-attachments/` 和各 JSON 文件；不要将两份 JSON 手动拼接。
3. 将需要的 `.env.local` 配置手动合并，保留 Mac 的绝对路径。重新配置 Obsidian、日报目录、本机 `.ics` 与项目工作目录；`C:/...` 路径不能直接在 Mac 使用。报告原件与 Obsidian 仓库需要另外复制或使用既有同步方式。
4. 再次启动，检查待办、附件和各来源。旧项目入口不会自动下载项目代码或迁移 Windows 的 Codex 对话。

日夜模式、语言与番茄钟存在浏览器本地存储中，不随数据目录迁移。不要把私人数据或 `.env.local` 提交到 Git。

## 可选来源与本机 AI

- Obsidian 与报告目录在设置中填写 Mac 的绝对路径。现有系统目录弹窗只支持 Windows，Mac 可手填路径；书架普通文件上传仍可使用。
- Apple Calendar 当前通过已有 iCloud 订阅或导出的 `.ics` 读取；启动小院不会自动获得系统日历权限，也不会自动读取 Apple Calendar。订阅应继续使用自己的已有链接；导出文件是快照。
- Ollama 与 Qwen 不包含在网页安装中。未安装时可继续使用普通待办、书架和灵感管理，AI 对话与自动分类会如实显示尚未就绪。模型需要另行在 Mac 安装；Windows 的便携 Ollama 不能直接使用。见 [本机 AI](local-ai.md)。
- 项目续航需要本机 Codex CLI 与 GitHub 的有效登录。桌面入口启动的后台服务可能使用与终端不同的 PATH；终端能运行 `codex` 不代表后台也能找到它。可在 `backend/.env.local` 中设置 `WORKBENCH_CODEX_EXECUTABLE` 为本机 Codex 可执行文件的绝对路径，具体排查见下文。连接状态须以页面实际验证为准。

## 故障排查与验证

- 日志：`.runtime/backend.stdout.log`、`.runtime/backend.stderr.log`。进程状态：`.runtime/backend.macos.json`。停止时校验目录、完整命令与进程启动时间，避免按失效 PID 停止无关程序。
- 端口已占用时不会停止其他服务。可在 `backend/.env.local` 调整 `PORT`（1024–65535）；配置变化后先 Stop 再 Start。
- 安装、启动或停止被强制中断后可能留下操作锁。确认没有相关脚本仍在运行，才删除空目录 `.runtime/macos-operation.lock` 或 `.runtime/node-install.lock`，然后重试。
- 克隆通常会保留脚本执行权限。如果双击提示权限不足，在项目目录运行 `chmod +x Install.command Start.command Stop.command Install-DesktopShortcut.command`。
- 锁文件安装失败时保留个人数据，修复网络后重跑 Install。不要为重装删除 `backend/data/`。

### 终端能用 Codex，项目库却无法连接

1. 在能运行 Codex 的终端执行 `command -v codex`，确认得到真实、可执行的绝对路径。本机安装位置可能随 Codex 版本或安装方式变化，不要复制另一台电脑的路径。
2. 在 `backend/.env.local` 中新增或修改 `WORKBENCH_CODEX_EXECUTABLE=实际的绝对路径`，保留其他配置。例如当前已验证的 ChatGPT Mac 安装使用 `/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`。此配置仅留在本机，不提交 Git。
3. 先执行 `./Stop.command`，再执行 `./Start.command`，让服务重新读取配置。进入项目库，点击“同步 Codex 与 GitHub”。
4. 确认 Codex 显示“已读取”，项目条目、最近对话与提交历史可正常读取。GitHub 的“已关联”状态不能替代 Codex 连接验证。

此操作读取当前设备的真实 Codex 项目与对话，不会迁移另一台设备的 Codex 数据。提交历史来自项目对应的本机 Git 仓库；另一台设备未推送的提交不会因为刷新项目库而出现。

```bash
./Install.command --run-tests
export PATH="$PWD/.runtime/node/bin:$PATH"
node --test scripts/macos-workbench.test.mjs
curl --fail http://127.0.0.1:3456/api/health
```

启动器测试使用临时目录与合成服务，验证中文及空格路径、重复启动、配置保留、安全停止、端口冲突与进程身份不符，不访问个人记录。
