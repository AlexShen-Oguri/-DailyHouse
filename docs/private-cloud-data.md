# 私人云端：数据范围与迁移

日常小院以一个人的多设备使用为目标。本地运行和本地存储继续是默认；源码开源不意味着个人资料公开，也不意味着其他安装自动连接作者的私人服务。以下清单依据当前存储实现，不将正在写入的 JSON 文件交给文件夹同步软件。本阶段只提供明确的记录白名单，附件字节、账号配置和外部工具原始对话不在其中。

## 实际存储与第一阶段白名单

默认数据目录为 `backend/data/`，也可由本机的 `WORKBENCH_DATA_DIR` 指定。所有数据目录、实际配置、附件、日志和备份均不进入 Git。表中的字段表示小院拥有的记录；个人文字、来源链接和工作日记本身仍是私人数据，需要在迁移预览中确认上传。

| 本机存储 | 可同步字段与身份 | 设备专属或排除字段 |
| --- | --- | --- |
| `personal-workbench.json` / `todos` | UUID、title、done、createdAt、dueDate；书架 source 的小院 ID/title/type/url；学习 source 的小院 ID/stepId/title/页面路径 | 计算出的 available；`project_action` 来源的待办暂时排除，避免将本机 Codex 项目 ID 当成共享身份 |
| 同文件 / `readingItems`、`readingTrash` | id、title、type、HTTP(S) url、notes、status、category、finishedAt、sourceKey、addedAt、updatedAt、origin、reportSource/reportDate/coverageDate；回收站原删除时间和恢复截止时间 | importBatchId、分类排队/失败/模型输出、coverUrl/coverCheckedAt、pdfUrl、附件 excerpt 及本机下载地址；只保留“手动分类”标记，防止后台分类覆盖人工选择 |
| 同文件 / `readingReports` | `report:tech:日期` 或 `report:aesthetic:日期`；status、hidden、category、finishedAt | `lastReadVersion` 的大小/mtime 是本机 PDF 版本，保留当前设备自己的值；实际 PDF 和发现路径不上传 |
| 同文件 / `readingSuppressions`、`readingExpiredIds` | 规范化 URL、B 站视频 ID 或 `file:SHA256` 来源键及移除时间；已到期记录 ID/时间 | 原文件、浏览历史候选和旧导入批次均不上传；抑制标记不能随着回收站快照到期而丢失 |
| 同文件 / `ideas`、`ideasTrash`、`ideasRemovedIds` | 小院 ID、title、status、创建/更新时间、entries 的 id/kind/content/时间；回收站及最小删除标记 | 旧迁移记录使用 `legacy-…` 稳定 ID，原样保留；不重新建另一套灵感原文 |
| 同文件 / `learningPlans`、`learningTrash` | UUID、title/course/goal/nextStep/nextStepId/dueDate/status/时间；entries、links 的稳定 ID/title/url、节点删除/到期时间；计划回收站 | 页面草稿、临时请求和运行状态不上传；嵌套节点继续遵守既有 30 天恢复期 |
| `inspiration-garden.json` / `metadata` | 与 Idea 相同的 ID；tags、pinned、融合 source 的 id/title/body/更新时间及递归来源快照 | projectId 保持本机关联；drafts、conversations 不自动上传；来源快照内部的旧草稿和聊天也递归排除 |
| 同文件 / `projects`、`projectTrash`、`expiredIds` | 已存在的旧版小院项目 UUID、title/goal/mvp/acceptance/nextStep/nextStepId/sourceBubbleId/sourceSnapshot/status/todoId/时间；回收站及最小永久删除标记 | draftId、来源快照中的 AI 记录不上传；这些摘要不是 Codex 或 Claude Code 原生对话 |
| `work-journal.json` / `entries`、`trash`、`deletedDates` | `America/New_York` 日历日期是稳定键；title/codex/life/reflection/status/lifeState/时间/editedFields/writer；回收站和自动写入抑制日期 | codex 字段是小院已保存的工作总结，不抓取完整工具聊天；本机并发 revision 不同步 |
| `project-resume.json` | 默认不整文件同步。共享项目摘要与当前设备的继续工作关联需要分别保存 | cache 的 path/Codex project ID/thread ID/preview/latest/Git 状态、hidden 的路径、launches 的完整交接上下文与恢复步骤、replacedThreadIds、外部工具登录信息全部留在本机 |
| `reading-attachments/<SHA256>.<ext>` | 仅随书架条目同步 id/name/size/mime/extension 的缺失副本描述，不上传字节或摘录 | PDF/EPUB/MD/TXT 管理副本、暂存 `.upload`/上传描述、删除隔离文件均不上传；原始资料文件永远不由同步删除 |
| `.runtime/reading-collection.json`、`reading-codex-conversation.json` | 不同步 | 最近五次读取摘要、dailyAttempt 和用户已确认的统一收集对话关联留在当前设备；不因同步另建收集对话。使用自定义数据目录时这两文件跟随该目录 |
| `personal.settings` 与其他外部来源 | 不同步 | vaultPath、calendarFile/calendarUrl、readingTechPath/readingAestheticPath、浏览器连接、本机模型安装、工作台和仓库目录；Obsidian 笔记与日历为外部只读源，不上传整个目录 |
| 浏览器 localStorage/sessionStorage、`.runtime/local-ai/`、环境文件 | 不同步 | 番茄钟当前进度、主题/语言/动画和列表偏好、未保存草稿、模型文件、缓存、凭证、登录状态及日志；保留原有第三方 SQLite 数据，不将其纳入本次投影 |

共享记录不携带顶层本机 `revision`；服务器使用自己的版本与操作 ID。本机收到实际内容变更后递增本机 revision，使已经打开的编辑页继续检测并发编辑。重放完全相同的记录不会再写入或改变版本。日记的 `editedFields` 是人工修改保护，属于共享语义，不能省略。

## 可恢复的应用边界

`syncExport()` 只读当前已加载的小院快照，返回独立记录，不写本机文件，不扫描桌面或外部工具数据库。`syncApply(records)` 只处理显式传入的记录；未出现的记录、空数组和新设备空存储均不代表删除。所有入站字段、嵌套节点、链接、身份及恢复期限先验证，再对每份存储原子写入。未知字段和格式错误会拒绝整份该存储的变更。

live 和回收站共用同一种记录身份。`body` 与 `deletedAt/expiresAt` 表示原有 30 天回收快照；`body: null` 表示明确的永久移除标记。到期导出只保留最小标记，不把过期内容重新上传。30 天是内容恢复期限，不是删除标记的失效期。协议层必须验证删除与恢复操作的云端版本，不能拿旧设备快照自动复活记录。

现有待办删除是立即删除；灵感单条更新是立即删除；学习节点及可恢复的父记录沿用各自已有回收站语义。同步不能统一改成另一套恢复期限。删除小院记录不调用外部工具、GitHub 删除、shell 或原始文件删除。应用投影也不会在接收同步时触发附件清理。后续正常的本机管理流程仍可按已授权的管理副本所有权清理孤立副本。

有本机附件的相同书架 ID 保留当前副本。新设备收到附件描述时不会生成假的本机下载地址；文件仍未同步、无法在该设备打开。这是第一阶段的明确限制，后续私有附件上传需独立白名单、授权、哈希校验、分段重试与已完成标记，不能把部分上传伪装成可用资料。

同一 canonical source 在两台设备已有不同 UUID 时，应用层返回冲突，不用其中一台覆盖另一台的笔记、分类或完成状态。预览列出双方内容；用户可明确保留云端条目并将本机重复项及当前笔记留在 30 天回收站，再手动整理需要的笔记。此选择会清除该来源抑制；普通书架移除仍保留抑制，不会自动重新下载同一来源。没有自动跨 ID 笔记合并。抑制标记也会阻止旧设备用另一个 ID 自动复活来源；只有明确恢复原条目，或手动重新添加并同步清除抑制标记后，才能继续。标题相同不是重复判据。本阶段不自动合并不同原生项目 ID，也不自动上传项目行动与其关联待办。

## 首次迁移预览、备份与撤回

首次上传前需要在当前设备生成并核对一份预览：来源设备名和时间、选定记录种类/数量、每类增加/已有/冲突/删除数量、具体记录标题与内容、附件描述清单及本阶段上传附件字节为零、目标私人服务、排除范围、另一台设备的合并方式。预览固定读取快照与哈希；确认时本机或云端已经变化则拒绝旧预览，要求重新检查。确认后该范围内后续编辑参与持续同步；冲突仍等待用户决定。

批准迁移前自动备份 `personal-workbench.json`、`inspiration-garden.json`、`work-journal.json`、`shared-projects.json` 与 `private-sync.json`，记录文件是否存在及 SHA-256，不制造缺失文件。附件、外部工具记录、凭证和设备路径文件不会自动复制或上传。可自行另外保管附件及本机关联备份。备份保存在被 Git 忽略的私人目录，并已在隔离数据目录验证；目前不会自动清理。不要把旧备份在线重放到云端。实际托管服务的备份能力和保存期尚待部署核实。

第一台设备只在确认后提交白名单。第二台设备先读取云端，再与自己的现有记录核对；没有本机数据时只拉取，不提交空快照。已有本机修改通过持久操作队列和云端版本进行同步；同一条记录的不同编辑保留为冲突，恢复/删除不能静默消除另一份编辑。请求失败时重放同一操作 ID，不能重建 UUID 或再创建外部项目。

未发送前可暂停同步并保留本地原文；已经上传后的撤回应明确说明会影响其他已授权设备，并通过经确认的云端删除标记处理。恢复备份是读取本地私人副本，不等于撤销另一台设备的后续编辑；恢复后必须重新核对云端版本。跨四份小院存储的应用由同步引擎的恢复日志协调，投影层本身只保证单文件原子写入。明确删除在各存储中持久保存最小标记；文件丢失或重置后未知的缺失不会被自动当作云端删除。

## 验证与实际限制

`backend/test/sync-projection.test.ts` 使用隔离合成数据，验证只读导出、字段与递归聊天排除、记录往返、部分应用、稳定 ID 与本机版本、来源冲突、全验证后写入、删除/恢复/到期抑制、附件缺失及原始文件保留、日记人工锁。此层不等于已经部署私人云端、身份验证或端到端加密；远程认证、设备撤销、TLS、持久操作队列与跨文件恢复由同步引擎和明确选择的服务负责。真实资料首次上传仍需要可检查的迁移批准。
