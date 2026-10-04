# Codex 与 Claude Code：当前设备接入

日常小院只适配 Codex 和 Claude Code。灵感讨论的工具选择，与确认立项时的开发工具选择互相独立。讨论不会创建目录、GitHub 仓库、原生对话或开发任务；本地 Qwen 是可选能力，不是安装或使用小院的前提。

## 安装、登录和真实状态

本机后端通过官方 CLI 的 `--version`、`--help` 和只读登录状态接口检查当前设备：Codex 使用 `codex login status`，Claude Code 使用 `claude auth status --json`。Codex 另外通过官方 app-server 的 `account/read`、`project/list`、`thread/list` 验证可读取的接口。不会读取、复制或同步工具的登录文件、内部数据库与原始对话文件。

状态包含当前设备、检测时间、版本、安装与登录情况，以及经验证的项目/对话接口。初次查看触发一次检测；之后显示带时间的缓存，使用“刷新”重新检查。安装缺失、未登录和探测失败分别显示，不能用固定绿点表示在线。检测使用有超时和输出上限的进程参数，不调用 shell，不执行用户输入；账号标识、原始诊断与令牌不会出现在状态响应中。

`authentication: detected` 仅表示工具自己的凭证检查通过，`modelAccess: unchecked` 表示没有请求模型来验证额度、订阅权限或推理可用性。小院不会为了检测状态发送真实灵感、消耗模型请求或启动登录。实际登录、订阅及审批由各工具管理；Codex 和 Claude Code 的账号不是可以互换的授权方式。参见 [Codex 身份验证](https://learn.chatgpt.com/docs/auth) 与 [Claude Code 身份验证](https://code.claude.com/docs/en/authentication)。

## 灵感讨论：只交接明确选择的内容

选择 Codex 或 Claude Code 后，明确勾选是否包含标题、哪些时间线更新，再填写问题。小院生成可检查的文本，确认后复制到现有工具使用。没有勾选的更新、完整聊天、融合来源、项目目录与附件不会默认加入。预览带灵感版本，编辑后必须重新检查；最多 50 条更新、64 KB 文本，超过限制会要求减少选择。

这是一份选中内容的交接预览，没有自动发送，也没有授予原生工具文件读取或命令执行权限。它不新建小院记录或外部对话。粘贴后的原生对话遵循该工具本身的权限和审批，小院不能将它显示为已隔离的自动讨论服务。

选择手动交接有明确的验证依据：本次检查的 Codex CLI 0.160.0 / app-server schema 没有可验证的“禁用所有内置工具、MCP、技能、钩子”的统一开关；只读沙箱仍可读取文件或运行允许的命令，不能据此保证只看选中文本。Claude Code 2.1.104 的 `--tools ""` 可以禁用内置工具，但 MCP、设置来源、规则与管理策略是不同的边界，不能仅凭它保证完整隔离。因此本阶段两者都显示 `discussion: manual_only`，不运行自动讨论回合。参见 [Codex app-server](https://learn.chatgpt.com/docs/app-server)、[Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)、[Claude Code CLI 参数](https://code.claude.com/docs/en/cli-reference)、[Claude Code 钩子](https://code.claude.com/docs/en/hooks) 和 [Claude Code 记忆与规则](https://code.claude.com/docs/en/memory)。版本与检测结果只证明当次当前设备的能力；更新后仍应重新验证。

## 确认立项与继续开发

立项确认明确包括本机工作目录、私有 GitHub 仓库，以及所选开发工具。准备文件或创建仓库之前，再次检查 GitHub 和所选工具的本机登录与必要接口。未通过时停止，保留之前已完成的步骤，不创建替代工具任务。

- **Codex**：保留已授权的项目注册、原生对话及一次开发交接。新对话使用原生审批；重试保留同一个立项 ID、仓库、项目和对话。结果不明的发送不会自动重发，空对话替换仍需明确确认。书架使用的统一收集对话不受影响。
- **Claude Code**：准备同样的受小院管理的工作目录和私有仓库，将完整立项上下文写入该项目的 `.dailyhouse/inspiration.md` 与 `.dailyhouse/inspiration.json`，随后停在 `awaiting_manual_handoff`。界面显示结构化的当前目录、`claude` 入口和上下文位置；后端不启动 unattended CLI，不创建或恢复 Claude 对话。用户在当前目录打开官方工具，核对范围后开始，保留 Claude 自身审批。重试和重启不会再建仓库。

`.dailyhouse/` 通过新项目的 `.gitignore` 排除。初始化提交只加入 `README.md`、`.gitignore`、`AGENTS.md`，完整私人上下文留在本机。后续原生工具也应遵守项目指引，不能将私人上下文加入 Git。日常小院现有本机项目索引与交接记录位于私有数据目录中的 `project-resume.json`；实际目录由现有本地配置决定，记录不得进入 Git 或普通云同步。

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
| `POST /api/personal/development-tools/discussion-preview` | 校验 `tool`、`ideaId`、`revision`、`includeTitle`、`entryIds`、`question`，仅返回选中文本，`sent: false` |
| 现有立项接口的 `developmentTool` | `codex` 或 `claude`；旧客户端省略时保留 Codex 行为 |

合成测试覆盖安装缺失、未登录、探测失败、状态缓存刷新、无身份泄漏、仅选中上下文、过期版本与非法字段、Claude 未启动/未伪造恢复、认证失败前停止创建、重试/重启幂等，以及删除保留外部项目和原始文件。测试不使用真实灵感、模型请求、登录或外部仓库创建。程序化严格隔离的灵感讨论、Claude 原生会话枚举、跨设备原生对话恢复均未实现。
