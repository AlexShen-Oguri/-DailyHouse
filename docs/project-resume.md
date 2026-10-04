# Project resumption and repository creation

Projects defaults to the current device's verified Codex project registry, deduplicated by working directory. The backend uses the locally installed CLI's app-server JSON-RPC, not internal database/config edits. Experimental capability availability is probed; unsupported interfaces retain the last snapshot with an explicit connection error. See [tool connections](development-tools.md).

## Existing local projects

- Show the latest chat title/preview, Git branch, changed-file count, recent commit and locally cached upstream ahead/behind counts. Reads never fetch, commit or push; upstream counts are not live remote queries.
- If the registered directory is not itself a Git repository, inspect only direct eligible children and use one only when exactly one repository exists. Otherwise show unavailable/not-a-repository without invented progress.
- GitHub authentication uses the device's Git Credential Manager interface and verifies the checked-in owner `AlexShen-Oguri`. Credentials are held in memory for official API calls, never stored in workbench files/logs/responses. Repository matches use verified remotes; an exact-name suggestion without origin is labeled inferred, never substituted for an existing origin.
- `thread/turns/list`, when supported, reads a single latest-turn summary distinguishing user request and Codex response, without tool logs. Otherwise display a labeled opening preview rather than claiming a full latest-turn summary.
- Return to Codex opens an existing chat; unavailable chat data offers a local CLI entry point. Refresh explicitly rereads sources. Prior goal/MVP/next-step notes remain in Legacy project notes.

## Shared context and current-device links

Authored goals, decisions, progress, next steps and repository links have independent shared project IDs in `shared-projects.json`. Create/edit/remove these explicitly; they do not start development. A device link verifies an existing local directory/tool and is stored separately in `device-project-links.json`. Another device's path/native chat is never inherited.

A reviewed continuation preview provides saved context and native entry points without running commands, creating/resuming chats or claiming restored native history. Codex and Claude Code use their own installation/login/approval. Unpushed commits and uncommitted work remain on their device. Shared context participates in private sync only after scope approval; local project cache and native links stay excluded.

## Next-step actions and completion evidence

Local Codex projects can own multiple explicit actions with title, acceptance condition, optional due date and a selected recent-chat link. Selection only saves a reference; it sends no message or model request. A missing former chat retains its saved association until explicitly cleared/replaced.

Actions are active, blocked, paused or completed. Blocked/paused require a reason; completion requires an actual result. Reopening preserves earlier evidence/time and the next completion records a new result. Each update carries revision, preventing stale overwrite. Individual results can be confirmed/deleted without removing the action, other results or tasks. Deleting the current result leaves the action completed with an explicit missing-result indication; old evidence is not presented as the new result.

Add to Today creates/reuses one task with action title/date, including across restart and completed actions. Linked title/date/completion update together in one atomic personal JSON write. Completing from Today also requires a result; unchecking reopens the action. Task completion does not infer acceptance success, project completion or shelf reading state.

Deleting the task unlinks it and preserves the action/evidence; it may later be added explicitly again. Confirmed action deletion preserves the task's source snapshot as an independent item. Temporarily hidden projects retain action/task consistency while hiding the return link; restore reconnects without losing interim edits. Permanent project deletion or 30-day expiry clears website actions/results but keeps tasks with source snapshots. Expiry cleanup runs at startup or the next task/action read, without a new scheduler. External Codex projects/chats, code and repositories remain untouched.

API prefix `/api/personal`:

| Endpoint | Input and result |
| --- | --- |
| `GET /project-resume/:id/actions` | `{items}`. |
| `POST /project-resume/:id/actions` | `title`, `acceptance`, optional `threadId`, `dueDate`, `requestId`; returns action. Retain one request ID across retry; a deleted action cannot be revived by an old request. |
| `PATCH /project-resume/:id/actions/:actionId` | Current `revision` and changed fields; `threadId:null` clears association. Complete with `result`; existing evidence is not directly overwritten. |
| `DELETE /project-resume/:id/actions/:actionId` | `{confirm:true,revision}`; website action only. |
| `DELETE /project-resume/:id/actions/:actionId/completions/:completionId` | `{confirm:true,revision}`; selected result only, returns action. |
| `POST /project-resume/:id/actions/:actionId/todo` | `{}`; returns `{todo,todoId,created}`, reusing the existing task. |
| `PATCH /todos/:id` | For a linked action also include `actionRevision`, and `result` on completion. Source `linked` means the action exists; `available` means the project entry is visible. |

Actions/tasks live together in `personal-workbench.json` as `projectActions`/`todos`. Old-file defaults are applied in memory while preserving legacy notes and `projectTodoLinks`. Actions keyed by native project identity are not yet shared across devices.

## Git history and provenance

Local history reads commits reachable from locally available branches, cached remote-tracking refs, tags and HEAD; users can select a branch/tag. Show full message, author/email, authored/committed dates, full hash, parents and snapshot ref labels. A GitHub commit link appears only while current origin matches its verified association; the link alone does not prove a push.

`GET /api/personal/project-resume/:id/history` accepts an existing visible project ID plus `ref`, `limit` or continuation `cursor`, never a path/arbitrary Git arguments. Default page size is 30, maximum 50. Opening freezes ref-tip hashes; new commits do not enter that pagination until refresh. Snapshots are in memory and expire after 30 idle minutes, restart or project removal.

Completeness covers only locally present/reachable history. Shallow clones are labeled; reads do not fetch missing partial-clone objects, inspect reflogs or find unreachable deleted-branch commits. A changed shallow boundary requires refresh. Commands are capped at 30 seconds/2 MB; oversized pages fail honestly and can use a smaller limit. Reads do not modify index, branches or work files.

Provenance is `local_git` for local branches and `remote_tracking` for `refs/remotes/...`; all-ref range is `locally_available_refs`. `snapshotAt`/Git `readAt` are local observations, not remote update times. `remoteTrackingUpdatedAt:null` means last fetch time is unknown; commit/file times cannot substitute. Missing upstream leaves ahead/behind unknown rather than a false zero.

An explicit GitHub query calls `POST /api/personal/project-resume/:id/github-history` with optional `page:1..100`, `limit:1..50` (defaults 1/30). It requires a visible project and origin-verified `match:remote`, then rereads current origin. Name guesses, changed origin, removed projects and unsupported API reject. The same in-memory GCM credential verifies owner and accesses official GitHub List commits on the fixed API domain. Result `source:github_api` includes `fetchedAt`, repository, commits and `nextPage` for the default branch.

GitHub pages always report `complete:false`; bounded pagination is not a frozen/full remote snapshot. Other-device unpushed work is absent. Upstream pagination URLs are not blindly followed; requests are reconstructed from fixed domains and verified repository identity. Viewing never clones/fetches/checks out/commits/pushes and does not automatically save API content into shared summaries.

## Creating an empty private GitHub repository

Idea details offer only an explicitly confirmed empty private repository. Review the repository name, fixed owner `AlexShen-Oguri` and scope. The API uses `private:true`, `auto_init:false` and a content-free operation marker. Success requires matching name/owner and verified private status.

No local workspace, Git initialization/commit/push, idea/chat upload or native Codex project/chat is created, resumed or messaged. No model/tool installation is required. Repeated requests reuse the same record/operation ID. Explicit retry verifies any same-name repository belongs to this operation and remains private; unrelated repositories are never overwritten. An uncertain create response is resolved by verification before another create. Restart does not auto-retry.

`POST /api/personal/inspiration/:id/launch` accepts `{repoName,confirm:true}`; legacy `name` compatibility does not expand scope. `POST /api/personal/project-launches/:id/retry` accepts only `{}`; replacement-chat options are rejected. New records use `kind:repository` with no inspiration context or external Codex identity.

Legacy launch records/resources remain. Existing repositories show links without old handoff continuation; legacy failures without a repository can retry GitHub-only creation. Confirmed removal of a website repository record leaves the repository/directory/native chat and minimum idempotency marker. Active creation cannot be removed mid-operation.

## Removal, recovery and storage

Project removal hides only DailyHouse's entry with 30-day recovery; restore restores the entry. Confirmed permanent deletion cleans website data and retains minimal hidden/deletion identity, never external resources. It does not call Codex deletion, GitHub repository deletion or recursive code-directory deletion. Shared-context removal likewise preserves device code/native tools.

`project-resume.json` is device-local and Git-ignored, holding verified paths/previews, legacy launch history and repository creation records. Back it up with `personal-workbench.json`, `inspiration-garden.json` and shared/device-link files. Do not transfer its paths/chat associations as if they belonged to another computer. See [private sync operations](private-cloud-sync.md) and [Mac migration](macos-local.md).
