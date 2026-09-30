# 日常小院 · 个人工作台

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

供单用户在自己的 Windows 电脑上管理日程、待办、阅读材料与本机笔记。产品从第三方安装包精简而来，只保留已确认的需求；功能建议不能替代用户决定。

## Product Purpose

让用户快速看到今天要做的事、查看 Google / Apple Calendar 日程、翻阅 Obsidian 笔记，把阅读材料与日报收在书架，并从灵感逐步形成可执行项目。收支账本已按用户要求暂时移除。

## Capabilities and Constraints

当前包含七个导航入口，灵感另有专属时间线详情页：

| 路由 | 页面 | 当前范围 |
| --- | --- | --- |
| `/` | 我的小院 | 今日待办与日程概览、主要功能入口、日夜田园场景；25 / 5、50 / 10 与自定义时长的小番茄钟。 |
| `/todos` | 今日待办 | 手动添加、设定日期、完成 / 恢复和删除事项；只读 Google / Apple Calendar 或本地 ICS，180 天范围与月份筛选。 |
| `/reading` | 待读书架 | 未完成 / 已完成主入口、类型与主题筛选；链接、文件、书目快捷导入，本机 Qwen 分类；随手记、搜索、编辑、30 天回收站、历史 JSON 预览、批次记录与撤销；发现已有正式日报并打开 PDF。 |
| `/ideas`、`/ideas/:id` | 灵感库 | 气泡 / 列表共用一批想法，独立时间线、融合来源与可持续追问的本机 Qwen 对话；立项单独确认。支持编辑、移除、30 天恢复和永久删除，保留未提交草稿。 |
| `/projects` | 项目续航 | 读取真实 Codex 项目、最近一轮对话、只读 Git 状态与 GitHub 关联；确认立项创建专属目录、私有仓库与 Codex 工作。移除、恢复和永久删除只影响网站记录；旧项目笔记单独保留。 |
| `/knowledge` | 知识书屋 | 连接本机 Obsidian 仓库，按标题或路径搜索 Markdown 笔记、只读预览，在 Obsidian 中打开编辑。 |
| `/settings` | 小院设置 | Obsidian 仓库路径、日历来源、装饰动画开关。Windows 提供本机文件 / 文件夹弹窗；日报来源目录在书架中配置。 |

- 前端为 React / Vite，后端为 Node.js 24；单用户、本地优先，仅监听 `127.0.0.1`。
- 待办、手动书架条目、报告阅读状态、书架回收站、来源抑制、导入批次、想法时间线与设置保存在 `backend/data/personal-workbench.json`；原第三方 SQLite 数据与个人数据分离，不将原包数据冒充为当前个人数据。
- 中文 / English 和白昼 / 夜晚是独立的界面偏好，保存在当前浏览器本地存储中。切换界面语言不翻译或重写个人内容。
- 主页番茄钟仅保存当前浏览器的计时状态，支持开始、暂停、继续、重置和可关闭提示音。专注 / 休息为手动切换；两组预设与 1–180 整数分钟自定义均可用。切换路由、刷新或后台恢复按同一截止时间计算，不自动开始下一轮，也不保存专注历史。
- 手动书架支持添加、编辑、移出和待开始 / 进行中 / 已完成状态；识别常见域名可提供类型与标题建议，用户可以修改。B站视频、课程与教程支持来源封面；仅向固定公共元数据地址尝试读取封面，带缓存、超时和图片域名校验，不读取登录凭证或下载视频。失败保留原有文字卡片，封面更新不改变阅读状态、笔记和用户更新时间。
- 书架区分阅读状态、媒介类型和主题分类。未完成 / 已完成为主入口；类型入口包含全部、书籍、视频、课程 / 教程、GitHub、文章、科技早报与审美图鉴。主题为编程 / AI、科技、商业 / 经济、设计、自然科学、人文社科、语言、效率 / 职业、生活技能、其他 / 待分类，手动分类可修改；旧编程与 AI 兼容合并，保留原笔记与导入撤销能力。
- 书架默认显示未完成内容。手动完成在保存成功后先显示像素勾选，再淡出并收拢；内容、链接与笔记保留在“已完成”入口，可重新开始。新完成动作记录 `finishedAt`，已有旧完成记录缺少可靠时间时不伪造历史日期；界面显示已知日期，但尚无完成日期筛选。关闭动画或系统减少动态效果时保留简短的状态反馈。
- 支持逐项、多选和全部移除。全选仅包含当前列表，改变筛选清空选择；全部移除包含筛选外及已完成内容。确认区显示移除数量与范围，并以确认时列出的 ID 快照一次性保存；失效选择整批拒绝。移出条目进入书架回收站，保留原 ID、状态、分类、笔记、封面及已知完成日期，30 天内可单项或批量恢复。到期不可恢复，后续操作清理完整快照但保留最小来源抑制信息；也可对单条回收站记录确认永久删除，只清理网站记录及其管理的附件副本，原始文件保留。恢复与已重新手动收藏的同源内容冲突时拒绝覆盖。旧版本无快照的永久移除不能伪装成可恢复。移除日报只隐藏入口，保留原 PDF，同一日报不自动重入，新日期日报正常收录。
- 书架 JSON 导入只处理实际读取的浏览器历史；候选限定最近 7 × 24 小时、播放比例已知且严格低于 25% 的教育或实用内容。分类使用可见标题规则与理由，不代表模型已观看视频。明确纯娱乐排除，主题模糊留待确认；未知进度不当作零，多 P 当前分集位置不代表整门课程完成率。用户可明确接受待确认项或排除候选，不能绕过时间、进度、明确娱乐、重复和已移除抑制规则。
- “导入与记录”接受最多 2 MB 的本机 JSON，提供逐项预览、分类理由、覆盖范围、新增 / 重复 / 抑制 / 排除 / 待确认计数。更改选择后须重新预览才可确认；未确认项保留在批次日志，可稍后重新审阅。提交时按当前数据重新验证，同源已完成内容不会被重新排入待读，用户的笔记与分类不会被重复导入覆盖。
- 导入批次可撤销该批新建且后来未被用户修改的条目，撤回内容进入书架回收站；后续编辑、完成或恢复保留并报告冲突，补封面不算用户修改。CLI `scripts/reading-import.mjs` 已提供 `preview`、`apply`、`history`、`undo`，只通过本机 API 写入，不直接编辑个人 JSON；详细契约见 `docs/reading-import.md`。每日任务通过浏览器辅助采集后复用此导入链，详见 docs/daily-collection.md。
- 每日 AI 科技早报与每日审美图鉴由既有流程每天纽约时间 09:00 开始制作。工作台只发现指定目录根层中匹配正式文件名的非空 PDF，不生成、修改或删除日报，也不建立报告生成调度器。09:00 是制作开始时间，不代表文件已经完成。
- 书架在打开、手动刷新、窗口重新聚焦及页面可见时每分钟重新检查报告。报告日期按文件名读取：科技为报道覆盖日，审美为刊期；已读文件变化后显示更新标记。
- 日历优先推荐 Windows 使用 Google Calendar、Mac 使用 Apple Calendar；支持用户提供的本机 `.ics`、Google iCal 和已有 iCloud 订阅。文件是导出快照；订阅按读取或刷新更新。显示今天起 180 天内日程与覆盖范围，不写入源日历。私密订阅地址只保存在本机，不由状态 API 返回。
- 桌面拾遗已移除：首页入口、待办区域、设置字段与扫描 API 均不再提供；原有待办记录保留。
- Obsidian 必须是包含 `.obsidian` 目录的本机仓库；笔记保留在原目录。来源只有在配置并成功读取后才显示可用，连接说明与空数据必须区分。
- 已移除内容表现、热点雷达、文件整理，以及小红书相关能力和其他冗余连接器。运行时不加载原包的 AI 客户端、抓取任务或后台调度器。
- 已启用每天纽约时间 09:45 的 Codex「每日小院采集」：发现正式日报、刷新当前日历、通过已登录浏览器读取最近一周 B站历史并经过现有预览 / 去重 / 分类规则导入。机器与 Codex 须运行；平台登录、页面覆盖不足如实标记。具体条件见 `docs/daily-collection.md`。真实 Codex / Git 项目续航已实现；跨来源控制台、Obsidian 写入、Issue / PR 采集与进一步自动化仍待选择。
- 灵感只有一套 canonical Idea / 时间线，扩展 metadata 引用同一 ID。融合创建派生想法并保存来源快照，不改写原始想法。本机 Qwen 在「接着想下去」中持续讨论，不限定三个方案或强制 MVP 模板；立项独立确认，详情见 [项目续航](docs/project-resume.md)。取消、超时或无效回复不保存半轮对话；旧方向草稿仍可查看和删除。不恢复 AI 提示词生成工具；学习进度小卡取消。

## Brand Commitments

用户选择「像素卡通风格，主题类似于星露谷物语」，并认可当前田园主体。采用原创小院形象、木纹、植物、像素图标和轻量装饰动画。白天为奶油纸面与草木绿，夜晚为深蓝、暗木与暖窗灯；两种主题都保持清晰的阅读对比度。动画可以关闭并尊重系统减少动态效果的偏好。中英界面保留一致布局与键盘操作，不使用原作者个人头像和品牌。

## Evidence on Hand

功能依据是 `frontend/src/App.tsx`、`frontend/src/personal/` 与 `backend/src/personal/`；主题与场景依据是 `frontend/src/components/` 和 `frontend/src/styles/`。公开文档仅描述功能与约束，不收录个人资料目录、实际账户状态或私人阅读记录。

## Current extension: think together, then launch

Open-ended Qwen conversations accompany each idea independently of project creation. Fusion preserves the original ideas and their snapshots and offers a conversation about the combined possibilities. Conversations and individual turns have explicit permanent-delete controls; drafts survive errors and cancellation. Saved notes remain on the canonical idea timeline.

Project resumption now reads actual Codex workspaces and their available conversation context, Git state and matching GitHub repositories. Earlier memo-style project records are preserved separately. Launching an idea is an explicit action that creates a local workspace, private repository and Codex handoff with the saved idea context. The frontend shows real progress and recoverable failures instead of claiming completion before the external work succeeds.

Reading, idea and project recycle bins offer item-specific permanent deletion with confirmation. Removal from DailyHouse does not delete an external Codex project, repository or source file.
