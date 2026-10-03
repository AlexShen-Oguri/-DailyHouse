# 日常小院 · 本机个人工作台

按个人需求重构的本地工作台，现已支持 **Windows 和 macOS 双端本地部署与使用**，Mac 支持 Apple Silicon 和 Intel。沿用原创像素田园界面，加入木纹、纸纹、园丁与盆栽，支持中文 / English 和白昼 / 夜晚切换。当前八个入口为我的小院、今日待办、待读书架、学习计划、灵感库、项目库、知识书屋和小院设置。

## 打开与关闭

| 平台 | 首次安装与构建 | 启动 | 停止 |
| --- | --- | --- | --- |
| Windows | 安装 Node.js 24 后双击 `Install.cmd` | `Start.cmd` 或已有桌面快捷方式 | `Stop.cmd` |
| macOS | 双击 `Install.command`，需要时自动安装项目内 Node.js 24 | `Start.command` 或桌面的“日常小院” | `Stop.command` |

两端共享源代码与数据格式，个人记录保存在各自本机，不会通过 GitHub 自动同步。Windows 与 Mac 之间的数据迁移见 [Mac 本地部署与数据迁移](docs/macos-local.md)。

**Mac**：首次双击项目中的 `Install.command` 安装依赖并构建，以后双击 `Start.command` 打开 http://127.0.0.1:3456/ 。关闭网页或终端后后台服务继续运行；双击 `Stop.command` 停止。重复启动会复用已有服务。支持 Apple Silicon 和 Intel；没有 Node.js 24 + npm 时会下载并校验官方运行时，保存到项目的 `.runtime/node`，无需 Homebrew 或管理员安装。首次安装需要联网。详见 [Mac 本地部署与数据迁移](docs/macos-local.md)。

**Mac 桌面入口**：双击 `Install-DesktopShortcut.command`，在桌面创建带有小院专属像素小屋与盆栽图标的“日常小院”应用快捷方式。以后双击它即可启动服务并打开网页，不需要先打开终端。项目目录移动后需重建入口。将桌面入口移到废纸篓只移除快捷方式，保留项目和个人数据；停止服务仍使用 `Stop.command`。

**Windows**：双击桌面 **日常小院** 图标，或 **启动日常小院.cmd**，打开相同地址。后台启动后可以关闭命令行窗口；重复启动不会重复创建服务。停止时双击项目中的 Stop.cmd，或上一级的停止个人工作台.cmd。

Windows 的 CMD 使用系统文件类型图标，因此另提供同名风格的快捷方式图标。桌面两个入口启动同一个程序。

## 已实现

- **主页番茄钟**：25 / 5、50 / 10 分钟及 1–180 分钟自定义专注 / 休息；支持开始、暂停、继续和重置。切换页面或刷新后按同一截止时间继续，结束后手动开始下一阶段，可关闭提示音。番茄苗随着专注时间长出叶子、开花并结出果实：30 分钟及以内是红色小番茄，31–60 分钟是红色大番茄，超过 60 分钟是有金属反光的金色大番茄；暂停冻结成长，休息保留收成。只保存当前浏览器的计时状态，不建立专注历史。
- **学习计划**：课程与长期目标独立管理，每个计划有专属时间线，可持续记录进展、疑问、阶段成果和资料链接，并将下一步加入今日待办。计划、记录和链接均可删除；计划与记录支持 30 天恢复，独立待办和外部资料保留。没有 AI 提示词生成。详见 [学习计划](docs/learning-plans.md)。
- 收支账本已按用户要求暂时移除，不提供银行连接。
- **灵感库**：气泡与列表共用一批想法，专属时间线可持续追加、编辑与删除记录；融合保留来源。「接着想下去」与本机 Qwen 持续讨论、追问和探索组合，支持多个会话、取消和删除；立项是独立确认操作。想法移除后 30 天可恢复，也可明确永久删除。详见 [使用说明](docs/ideas.md)。
- **项目续航**：默认读取真实 Codex 工作目录、最近一轮对话、Git 状态与 GitHub 关联；独立立项确认会创建本机工作目录、私有 GitHub 仓库和 Codex 项目，并交接完整灵感上下文。旧目标与下一步笔记单独保留。网站移除、恢复和永久删除只管理网站记录，不删除外部项目。详见 [项目续航](docs/project-resume.md)。
- **待办**：手动添加、日期、完成/恢复、删除；日历日程保持只读。
- **待读书架**：未完成 / 已完成为两个主入口；一排紧凑类型入口包含全部、书籍、视频、课程 / 教程、GitHub、文章、科技早报与审美图鉴。搜索、主题分类与进行状态位于次层；支持链接、随手记、编辑与重新开始。分类为编程 / AI、科技、商业 / 经济、设计、自然科学、人文社科、语言、效率 / 职业、生活技能、其他 / 待分类，用户可手动修正。
- **完成与回收站**：手动完成保存成功后打勾并淡出，链接、封面与笔记留在“已完成”。新完成动作记录日期，旧记录没有可靠时间就不补造；目前没有完成日期筛选。逐项、批量及全部移除进入 30 天回收站，支持单项或批量恢复原状态，并可确认永久删除单条回收站记录；到期不可恢复，自动导入继续尊重来源抑制，不让删除内容复活。
- **快捷导入**：批量粘贴链接、选择本机 PDF / EPUB / Markdown / TXT、读取 URL / webloc / JSON / CSV 链接清单，或手填书名。每批最多 30 项，预览可改标题、类型与分类，确认后由本机 Qwen 分类；失败可重试、低置信可确认，手选分类优先。文件保留工作台副本，可打开或下载。
- **导入闭环**：保留历史 JSON 的近一周候选校验；手动收藏不受观看时间或进度限制。所有导入提供去重、批次日志、撤销和 30 天回收站。撤销保护后续编辑，自动分类不影响撤回。
- **视频封面**：B站视频、课程和教程条目可保存并显示来源封面；邻近视口按顺序尝试补充公开元数据，失败结果缓存 24 小时。图片懒加载，缺失时保留原有书签与文字布局。此能力不读取登录凭证，也不代表已接通观看历史自动同步。
- **Obsidian 书屋**：连接已有本机仓库，按标题/路径搜索 Markdown、阅读基础排版与代码、跳转双链、在 Obsidian 打开。相对路径按当前笔记目录解析；不静默选取有歧义的同名笔记。最多列出 5000 篇，预览文件限 1 MB；复杂嵌入和插件效果在 Obsidian 中查看。
- **日历**：Windows 优先 Google Calendar 的 iCal，Mac 优先 Apple Calendar；保留本地 `.ics`。支持重复、例外、改期、全天、时区和夏令时，显示今天起 180 天的日程并可按月查看。日历只读，本地文件是快照。
- **每日采集**：每天纽约时间 09:45 的 Codex 任务发现正式日报、刷新日历，并通过已登录浏览器采集近一周 B站实用内容。电脑和 Codex 须运行，登录或页面覆盖不足会如实提示。见 [完整流程](docs/daily-collection.md)。
- **本机 AI**：Qwen3.5-4B Q4_K_M 通过本机 Ollama API 运行，无托管推理费用；Start.cmd 自动启动已安装的模型服务。安装与资源说明见 [本机 AI](docs/local-ai.md)。
- **界面偏好**：页顶切换中文 / English 与白昼 / 夜晚；当前浏览器会记住选择。界面标签和日期格式随语言切换，个人标题、笔记和来源内容保留原文。
- **小院动态**：同构图日夜风景交叉淡入，太阳 / 月亮拨钮、园丁、植物与夜间萤火虫；支持首页暂停按钮、设置总开关、系统减少动态、离屏与后台暂停。

Obsidian 仓库和日历来源均以当前设置中实际验证的状态为准。Windows 设置中的 Obsidian、ICS 与书架日报目录均可弹出本机文件 / 文件夹选择窗口，也可手填路径；选择后仍需保存连接。这里没有 Apple ID 或银行密码输入框。

## 日报如何进入书架

书架连接已有的「每日 AI 科技早报」与「每日审美图鉴」产物。既有报告流程每天纽约时间 09:00 开始制作；本工作台只读发现已经生成的正式 PDF，不负责定时生成报告，也不保证 09:00 文件已经完成。

在书架的「日报来源与目录」设置两个本机目录。只识别各目录根层中命名为 `YYYY-MM-DD_AI科技早报.pdf`、`YYYY-MM-DD_每日审美图鉴.pdf` 的非空正式文件，不递归收录草稿或中间产物。科技日期代表报道覆盖日；审美日期代表刊期。

打开书架、点击刷新或重新聚焦窗口时检查新文件；书架页面可见时也会每分钟检查一次。可直接打开 PDF 并记录阅读状态；已读文件发生变化时显示「读后有更新」。报告原件保留在来源目录中，工作台不修改或删除它们。

## 已移除

内容表现、热点雷达、文件整理、桌面拾遗、小红书相关功能、Things、飞书、AI 规划与其他冗余连接器、旧后台调度器已从运行代码中移除。桌面拾遗的入口、设置和扫描 API 均已删除；既有手动待办保留。学习进度小卡取消。

已实现书架闭环、每日条件式采集、持续灵感对话与真实 Codex / Git 项目续航。跨来源控制台、Obsidian 写入、Issue / PR 采集和更深入的项目自动化仍在 [后续方案](docs/daily-automation-proposal.md)。旧工作流地址转到灵感库；没有 AI 提示词生成工具。

日报移除不删除原 PDF，后续扫描不会自动收回同一日报；30 天内可从书架回收站恢复。旧版本永久移除的条目没有快照，不能据此承诺恢复。

原源码、配置及脚本在 .runtime/legacy 中保留，旧 SQLite 数据文件仍留在 backend/data；它们不会被新版加载。

## B站候选与本机导入 CLI

导入处理已授权浏览器页面实际读到的历史，不读取浏览器 cookie，也不提供官方历史接口。每日任务复用同一流程。候选限最近 **7 × 24 小时**、已知播放比例严格低于 **25%** 的教育或实用内容；明显的纯娱乐排除，模糊主题留待确认。未知进度不当作 0，多 P 位置不等于整门课程完成率。提交时重新核对时间、重复与删除抑制，手动完成状态不会被来源进度覆盖。

网页“导入与记录”与 CLI 使用同一后端规则。命令需要本机工作台已启动；输入文件最多 2 MB，个人文件放在 Git 忽略的本机目录。

```powershell
node scripts/reading-import.mjs preview .runtime/history.local.json
node scripts/reading-import.mjs apply .runtime/history.local.json
node scripts/reading-import.mjs history
node scripts/reading-import.mjs undo <导入批次ID>
```

`preview` 不写入；`apply` 再校验后提交；`history` 查看批次；`undo` 撤销可安全撤回的新增条目并报告后续编辑冲突。命令只访问本机 API，不直接编辑数据文件。详细格式、覆盖范围和恢复规则见 [书架导入说明](docs/reading-import.md)。命令可执行不代表已每天定时运行。

## 数据与安装

- 服务只监听本机 127.0.0.1。
- 待办、书架条目、报告阅读状态、回收站、来源抑制、导入批次和来源配置：backend/data/personal-workbench.json（首次保存时创建）。
- 手动导入的文件副本：同目录 reading-attachments，须与个人 JSON 一起备份；不进入 Git。
- 语言、日夜主题、首页暂停偏好与番茄钟当前计时保存在当前浏览器的本地存储中，不随账户同步；清除站点数据会移除这些状态。
- 订阅链接只保存在本机配置中，公共 API 不返回链接。连接后仅向支持的 Google / iCloud 地址读取日历。
- 想法与时间线保存在 personal-workbench.json；融合快照、AI 对话、旧草稿与旧项目笔记保存在同目录 inspiration-garden.json，以同一想法 ID 关联；真实项目入口与立项恢复信息保存在 project-resume.json。三份数据应一起备份。
- 备份前停止服务，复制 backend/data 和 backend/.env.local。Obsidian 笔记留在原仓库。
- 环境：Node.js 24；Windows 用 Install.cmd / Start.cmd / Stop.cmd，Mac 用 Install.command / Start.command / Stop.command。需要重装时先停止服务；不再依赖 SQLite 原生编译。
- 重建桌面入口：Windows 运行 scripts/Install-DesktopShortcut.ps1，Mac 双击 Install-DesktopShortcut.command。
- 启动日志：.runtime/backend.stderr.log。

## 验证与说明

后端与前端分别使用 `npm test` 和 `npm run build` 验证。浏览器验收使用隔离数据，覆盖待办、日历读取、笔记双链、书架分类与阅读状态、移除恢复、导入预览及撤销冲突、视频封面、既有报告发现、语言 / 日夜切换、动画控制和键盘操作，并检查桌面与窄屏布局。

素材及完整提示词见 docs/garden-art-provenance.md、docs/garden-details-provenance.md、docs/garden-night-provenance.md，以及对应的提示词文件。个人配置、报告和私人阅读记录不进入源码仓库。

基于原 L叔工作台的 MIT 代码定制；原许可证与第三方素材声明保留在 LICENSE 和 THIRD_PARTY_NOTICES.md。

## Development security

All development must follow the [Development Security Standard](docs/development-security.md), [Security Policy](SECURITY.md) and [working agreement](AGENTS.md). Local storage is the default; any future private cloud must use explicit upload scope, verified authorization and revocable device pairing. Open-source users keep data in their own local or independent cloud deployment. Public multi-user hosting requires a separate owner decision and readiness review. These requirements do not imply that cloud synchronization or remote access is currently implemented.

## 版本记录

从已认可的小院版本建立初始提交。后续每个完成的功能或修复先验证，再写明改动和验证结果，提交并同步到指定 GitHub 仓库；工作约定见 [AGENTS.md](AGENTS.md)。个人数据、报告、凭证和运行时文件不进入提交。
