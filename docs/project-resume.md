# 项目续航与灵感立项

项目页默认读取本机 Codex 项目注册表，按工作目录去重，展示真实工作现场。网站使用本机安装的 Codex CLI 的 app-server JSON-RPC；不修改 Codex 的内部数据库或桌面配置。当前安装版本提供 `project/list`、`project/create`、`thread/list`、`thread/start` 与 `turn/start`。这些实验接口可能随 Codex 更新变化；接口不可用时保留上次读取结果并显示连接错误。

## 继续工作

- 每个项目展示最近对话的标题与预览、分支、未提交文件数、最近提交，以及本地 upstream 记录中的领先和落后数量。这里只读取，不自动 fetch、提交或推送现有仓库；领先和落后不是实时远程查询。
- 若注册目录自身不是 Git 仓库，仅检查其直接子目录，只有唯一仓库时才使用它。其他目录显示尚未启用 Git 或无法读取，不伪造进度。
- GitHub 通过现有 Git Credential Manager 的正常凭证接口认证，验证账号为 `AlexShen-Oguri`。凭证只在内存中用于 GitHub 官方 API，不写入工作台文件、日志或网页响应。关联以已验证的仓库远程地址为准；没有 origin 时，可提示名称完全一致的候选仓库，并标为“同名仓库（推测）”。已有 origin 不会被同名候选覆盖。
- 最近一轮内容通过 `thread/turns/list` 的单轮摘要读取，区分用户要求与 Codex 回复，不读取工具日志。接口不支持时仅保留明确标注的开场预览。
- 点击「回到 Codex 接着做」打开已有对话；没有可读取的对话时提供本机 Codex 命令。网页不将一段旧的首条消息预览冒充最后一轮的完整摘要。
- 手动同步会重新读取。旧版目标与下一步笔记保存在「原有项目笔记」，不与真实项目混为一谈。

## 下一步行动

真实项目可以单独保存多条下一步行动。填写明确的行动标题、验收条件和可选计划日期，再从这个项目已经读取的最近对话中选择继续工作的入口；也可以暂不关联对话。网页只保存用户选择，不调用模型、不发送 Codex 消息，也不执行命令。

行动有进行中、受阻、暂停、已完成四种状态。暂停或受阻必须写明原因；完成必须记录实际结果。重新打开会保留此前的结果和完成时间，下一次完成需要填写新的结果。每次更新带 `revision`，陈旧页面不会覆盖别处的新修改。对话不再出现在最近列表时，已有对话快照仍保留；用户可以清除关联，或改选当前列表中的对话。

每条完成结果也可以单独确认删除，保留行动、其他完成结果和待办。删除当前结果后明确显示结果已移除，行动仍保持已完成；旧结果不会被冒充为本次结果。需要重新验收时，重新打开行动后记录新的结果。

「加入待办」将同一条行动关联到今日待办，使用行动的标题与计划日期。重复点击、服务重启或行动已完成都不会重复创建。关联后，两处的标题、日期、完成状态在同一次本机 JSON 写入中同步：从待办完成也需要填写结果，从待办取消完成会重新打开行动。不会通过勾选推测验收通过，也不会改变关联书架材料的阅读状态。

删除待办只解除待办关联，保留行动与完成记录，此后可以再次明确加入待办。删除行动需要确认，只删除该行动，已经加入的待办保留原始来源快照并成为独立事项。项目暂时移除时，待办继续与保留的本机行动同步，只隐藏返回项目的入口；恢复项目后直接重新关联，不覆盖期间的编辑。项目永久删除或回收站满 30 天到期时，清除它的网站行动及完成记录；关联待办仍保留来源快照并成为独立事项。到期清理在启动或下一次读取待办、行动时发生，不需要单独后台任务。所有路径都不修改 Codex 项目、对话、代码或 GitHub 仓库。

接口（统一前缀 `/api/personal`）：

- `GET /project-resume/:id/actions` 返回 `{items}`。
- `POST /project-resume/:id/actions` 接受 `title`、`acceptance`、可选 `threadId`、`dueDate`、`requestId`，返回行动。界面为一次创建生成并保留同一个 `requestId`，重试返回已创建行动，不重复插入；删除后的旧请求不能使行动复活。
- `PATCH /project-resume/:id/actions/:actionId` 接受当前 `revision` 和需要更改的 `title`、`acceptance`、`threadId`、`dueDate`、`status`、`reason`、`result`。清除对话用 `threadId:null`；完成时必填 `result`。既有完成证据不可直接覆写，重新打开后追加新结果。
- `DELETE /project-resume/:id/actions/:actionId` 接受 `{confirm:true,revision}`，只删除网站行动记录。
- `DELETE /project-resume/:id/actions/:actionId/completions/:completionId` 接受 `{confirm:true,revision}`，返回更新后的行动，只删除选中的结果记录。
- `POST /project-resume/:id/actions/:actionId/todo` 接受 `{}`，返回 `{todo,todoId,created}`；已有待办返回同一 ID。
- `PATCH /todos/:id` 对仍关联行动的待办另带 `actionRevision`；完成时带 `result`。来源中的 `linked` 表示本机行动存在，`available` 表示项目入口也可见；两者不同，避免暂时隐藏项目时丢失完成证据。

行动与关联待办存放在同一份 `personal-workbench.json` 的 `projectActions`、`todos` 字段中，单次原子写入避免两个存储间的部分更新。首次读取旧版文件只在内存中补默认值，保留旧项目笔记和 `projectTodoLinks`。

## 提交历史：本机、远程跟踪与 GitHub

项目卡片的历史入口按需读取真实 Git 提交，默认范围是本机可用引用：本机分支、缓存的远程跟踪分支、标签与当前 HEAD 可达的提交；也可以单独选择分支或标签。显示完整提交说明、作者、邮箱、作者日期、提交日期、完整哈希、父提交和打开历史时的分支标签。只有当前 origin 与已验证的 GitHub 关联仍一致时，才显示对应的 GitHub 提交链接；这个链接本身不证明该提交已经推送。

`GET /api/personal/project-resume/:id/history` 只接受现有可见项目 ID，以及 `ref`、`limit` 或续页 `cursor`，不接受文件路径或任意 Git 参数。默认每页 30 条，最多 50 条，可持续加载直至没有下一页。首次打开会冻结分支尖端的哈希；后续新提交不会插入正在翻页的结果，刷新历史即可开启新快照。快照保存在内存中，闲置 30 分钟、服务重启或移除项目后需要重新打开。

完整性限于**本机已存在且可达的历史**；浅克隆会明确标识，不自动 fetch、不下载部分克隆缺失的对象，也不读取 reflog 或已删除分支的不可达提交。若翻页期间浅克隆边界改变，要求刷新以避免漏项。每条 Git 命令最多运行 30 秒、输出最多 2 MB，过大的页面会明确报错，可调小每页数量重试。历史读取不会修改分支、索引或工作文件。

数据来源分开显示：本机分支是 `local_git`；选择 `refs/remotes/...` 后是 `remote_tracking`，它仍是本机缓存，而非实时 GitHub 查询。所有引用的页面使用 `range:locally_available_refs`。`snapshotAt` 是打开本机历史快照的时间；项目 Git 状态的 `readAt` 是读取本机状态的时间，不冒充远程更新时间。现阶段没有可信的最后 fetch 记录，`remoteTrackingUpdatedAt:null` 表示未知，不用提交时间或 `.git` 文件时间推算。没有 upstream 时领先/落后数量也未知，不显示虚假的零。

只有明确点击 GitHub 查询入口才执行 `POST /api/personal/project-resume/:id/github-history`，body 为可选数值 `page:1..100`、`limit:1..50`，默认 1/30。后端只接受已有可见项目 ID，要求缓存关联由 origin 验证（`match:remote`），随后重新只读核对当前 origin；名称推测、origin 改变、项目移除或接口不可用都会拒绝读取。请求采用当前设备 GCM 的内存凭证，先验证账号，再以同一凭证调用 GitHub 官方 [List commits](https://docs.github.com/en/rest/commits/commits#list-commits) GET 接口。来源为 `github_api`，返回 `fetchedAt`、repoUrl、提交列表及 nextPage；查询的是仓库默认分支的当前 API 页面，不包含其他设备未推送的提交，也不读取那台设备的未提交修改或本机分支。

GitHub 分页结果始终 `complete:false`：单页和有界分页都不宣称整个仓库的完整历史，翻页也不是一个冻结的远程快照。上游分页 URL 不直接跟随；所有请求始终由固定 GitHub 域名和已验证仓库生成。不将实际远程查询伪装成本机 `git fetch`，也不在查看信息时执行 clone/fetch/checkout/commit/push。数据只在此页面请求中返回，不自动保存到共享项目摘要。

## 创建 GitHub 私有仓库

灵感详情只保留创建空的 GitHub 私有仓库功能。用户填写仓库名，核对当前固定个人账号 `AlexShen-Oguri` 与创建范围，并明确确认后才执行。服务使用本机 GitHub 登录访问官方 API，创建参数固定为 `private: true`、`auto_init: false`，仅发送仓库名与不含个人内容的操作标识。只有返回的名称、归属和私有状态全部核验通过才报告成功。

创建不依赖 Codex 或本机模型，不新建工作目录、不初始化 Git 或推送提交、不上传完整灵感或聊天记录，也不创建、恢复或发送 Codex 对话。项目库对已有项目的读取、继续入口和提交历史保持原有行为。

重复点击复用同一条记录。失败由用户手动重试，复用同一操作标识；已有同名远程仓库只有属于本次操作且仍为私有时才能复用，其他仓库不覆盖。GitHub 已接收创建但响应不明时，重试先核验同名仓库，避免重复创建。

沿用 `POST /api/personal/inspiration/:id/launch`，请求为 `{repoName,confirm:true}`；兼容旧页面可携带 `name`，但不扩大创建范围。`POST /project-launches/:id/retry` 仅接受空对象，旧替代 Codex 对话选项已拒绝。新记录标记 `kind: repository`，不存入灵感上下文或外部 Codex 身份。

旧立项记录及其本机目录、仓库、Codex 项目、对话与历史上下文均保留，不自动恢复旧流程。已有仓库只显示链接；无仓库的旧失败记录可以执行仅 GitHub 的重试。服务重启不自动重试。移除网站记录保留防重复标识。

## 移除、恢复、永久删除

移除只隐藏 DailyHouse 的项目入口，进入 30 天回收站；恢复只恢复这个入口。永久删除也只清除本网站的记录，并保留最小隐藏标识以防同步重新加入。任何路径都不调用 Codex 项目删除、GitHub 仓库删除或递归删除本机项目文件。

仓库记录可以经明确确认单独清除网站副本；正在创建的记录不能在中途删除。已经创建的外部资源保留，网站仅保留必要的最小标识以防重复创建。

本机状态存放于被 Git 忽略的 `backend/data/project-resume.json`，包含已有项目路径、对话预览、旧立项历史和仓库创建记录。备份时与 `personal-workbench.json`、`inspiration-garden.json` 一起保存。
