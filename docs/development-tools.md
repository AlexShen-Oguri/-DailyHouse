# Codex 与 Claude Code：当前设备接入

工具接入用于当前设备状态与已有项目的继续入口。用户已取消灵感库的 AI 讨论、讨论预览和自动立项交接；仅保留经确认创建空的 GitHub 私有仓库。本机 Qwen 继续作为书架分类的可选能力。

## 安装、登录和真实状态

本机后端通过官方 CLI 的 `--version`、`--help` 和只读登录状态接口检查当前设备：Codex 使用 `codex login status`，Claude Code 使用 `claude auth status --json`。Codex 另外通过官方 app-server 的 `account/read`、`project/list`、`thread/list` 验证可读取的接口。不会读取、复制或同步工具的登录文件、内部数据库与原始对话文件。

状态包含当前设备、检测时间、版本、安装与登录情况，以及经验证的项目/对话接口。初次查看触发一次检测；之后显示带时间的缓存，使用“刷新”重新检查。安装缺失、未登录和探测失败分别显示，不能用固定绿点表示在线。检测使用有超时和输出上限的进程参数，不调用 shell，不执行用户输入；账号标识、原始诊断与令牌不会出现在状态响应中。

`authentication: detected` 仅表示工具自己的凭证检查通过，`modelAccess: unchecked` 表示没有请求模型来验证额度、订阅权限或推理可用性。小院不会为了检测状态发送真实灵感、消耗模型请求或启动登录。实际登录、订阅及审批由各工具管理；Codex 和 Claude Code 的账号不是可以互换的授权方式。参见 [Codex 身份验证](https://learn.chatgpt.com/docs/auth) 与 [Claude Code 身份验证](https://code.claude.com/docs/en/authentication)。

## 已有项目继续开发

项目库保留已有项目的本机目录、GitHub 关联、已保存的继续工作上下文，以及 Codex / Claude Code 原生入口。共享项目可在当前设备明确关联已有目录。继续入口不自动执行开发工具，不创建或恢复原生对话；原生工具的文件权限和审批仍由工具管理。

灵感库的创建操作只调用 GitHub，不需要开发工具或本机模型安装/登录，不创建目录或 Git 提交，不复制完整灵感或对话到项目，也不自动注册、替换或发送 Codex / Claude Code 对话。旧立项的上下文、目录、仓库与原生身份保留；旧流程不再恢复。详见 [仓库创建范围](project-resume.md)。

原生 Codex 项目与对话通过官方本机 app-server 读取，Claude 会话不被伪装成 Codex 项目。本阶段不枚举 Claude 内部数据库、不推测已有 Claude 会话、不复制它们。只有用户明确关联的当前设备原生会话 UUID 才能用于结构化 `claude --resume <UUID>` / `codex resume <UUID>` 参数；一份继续工作入口不证明会话存在或已经恢复。参见 [Claude Code 会话](https://code.claude.com/docs/en/sessions) 和 [Agent SDK 会话边界](https://code.claude.com/docs/en/agent-sdk/sessions)。

## 数据与删除边界

共享项目身份与当前设备的本机目录、开发工具和原生对话关联分开保存。另一台设备不能凭同一个 GitHub 地址恢复本机原生对话。共享上下文只能在用户确认后用于当前设备的继续工作；未推送的代码和本机未提交改动也不会自动出现在其他设备。

删除、恢复、永久移除小院项目与交接记录，仅作用于小院记录；项目回收站保持 30 天恢复期。它们不会删除 Codex / Claude Code 的对话、工具项目、本机目录、GitHub 仓库或原始资料。永久移除保留最小去重抑制，防止把保留的外部仓库误当成新立项再次创建。附件上传与真实数据首次迁移遵循私人云端单独的确认与白名单，本模块不上传工具账号或任何原始对话。

## 开发接口与验证

本机、同源、受现有 Host/Origin 与请求大小限制保护的接口：

| 接口 | 行为 |
| --- | --- |
| `GET /api/personal/development-tools` | 当前设备的带时间状态缓存；首次有界检查 |
| `POST /api/personal/development-tools/refresh` | 显式重新检测，不执行模型请求 |
| `POST /api/personal/development-tools/discussion-preview` | 已移除，返回 410，不生成或发送讨论内容 |
| 灵感仓库创建接口 | 只接受仓库名与明确确认；开发工具选项不再适用 |

合成测试覆盖安装缺失、未登录、探测失败、状态缓存刷新、无身份泄漏、讨论接口退役、仓库私有状态核验、失败重试/重启幂等，以及删除保留外部资源。项目库的原生继续入口与实际 Git 历史验证保留。测试不使用真实灵感、模型请求、登录或外部仓库创建。
