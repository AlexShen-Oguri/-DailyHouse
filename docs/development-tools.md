# Codex and Claude Code on the current device

Connections report current-device state and continuation options for existing projects. Inspiration AI discussions/previews and automatic project handoff are retired. Confirmed empty private GitHub repository creation is independent of model/tool availability; Qwen remains optional for manual shelf classification.

## Verified installation and login state

The backend probes official CLI version/help and bounded read-only login interfaces: `codex login status` and `claude auth status --json`. Codex's app-server additionally verifies readable `account/read`, `project/list` and `thread/list` capabilities. It never copies tool login files, internal databases or raw conversation files.

Status includes device, check time, version, installation/login state and verified project/chat interfaces. First access performs one bounded probe; later access returns a timestamped cache until explicit Refresh. Missing installation, missing login and failed probes are distinct. Calls use process argument arrays, timeout/output limits and no shell/user command execution. Account identities, raw diagnostics and tokens are excluded from responses.

`authentication: detected` only means the tool's credential probe passed. `modelAccess: unchecked` means no model/usage/subscription request was made. Status checking does not send private ideas, consume inference or start login. Each tool manages its own login and approvals; their credentials are not interchangeable. These commands describe the checked-in adapter, not a promise that every future CLI release supports the same interface.

## Existing-project continuation

Shared project identity/context is separate from current-device directories and native associations. An explicit link verifies an existing local directory; another device's path is never applied automatically. The continuation preview offers saved context and native entry points, does not execute development or create/resume/send a native chat. Native tool file permissions/approval still apply. See [project resumption](project-resume.md).

Codex projects/chats use the official local app-server. Claude internal databases are not enumerated and sessions are not guessed or presented as Codex projects. Only a user-linked current-device session UUID can supply structured `claude --resume <UUID>` / `codex resume <UUID>` arguments. An entry point alone does not prove that a session exists or has resumed.

Repository creation only calls GitHub with reviewed repository name/confirmation. It creates no directory/commit and copies no idea/chat context. Legacy launch context, directories, repositories and native identities remain preserved without restoring the old flow.

## Data and deletion

A shared GitHub URL does not restore another device's native conversation. Unpushed code and uncommitted edits remain on their device. Removing/restoring/permanently deleting DailyHouse records affects only website data, with the applicable 30-day recovery. It never deletes native chats/projects, code directories, GitHub repositories or original documents. Minimum suppression/idempotency identities remain to prevent duplicate creation.

Attachments and the first real migration follow the separate [private sync approval and whitelist](private-cloud-sync.md). This module uploads no tool accounts or raw chats.

## Local API

All routes retain same-origin, Host/Origin and request-size protections.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/personal/development-tools` | Timestamped cache; first bounded probe. |
| `POST /api/personal/development-tools/refresh` | Explicit fresh probe without model calls. |
| `POST /api/personal/development-tools/discussion-preview` | Retired; HTTP 410 without generating/sending content. |
| Idea repository creation | Repository name plus explicit confirmation only; tool options no longer apply. |

Relevant tests use synthetic tool states and cover missing/login/probe failures, cache refresh, identity redaction, retired interfaces, private repository validation, idempotent retry and external-resource preservation. They do not prove real model access or live cross-device session recovery.
