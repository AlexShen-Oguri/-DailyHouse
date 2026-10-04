# Private sync data scope and migration

DailyHouse supports one owner's authorized devices. Local storage remains default; open source does not publish personal records or connect other installations to the owner's backend. Sync projects explicit record fields rather than handing actively written JSON files to folder synchronization. Attachment bytes, account configuration and raw native conversations are excluded.

## Storage and phase-one field inventory

Default directory: `backend/data/`, or an explicit private `WORKBENCH_DATA_DIR`. Data, configurations, attachments, logs and backups stay out of Git. Authored text, source URLs and journal summaries are themselves private and require inspection in the upload preview.

| Local storage | Shared fields and identity | Device-local/excluded fields |
| --- | --- | --- |
| `personal-workbench.json`: `todos` | UUID, title, done, createdAt, dueDate; DailyHouse reading ID/title/type/url or learning ID/stepId/title/page route | Computed availability; `project_action` tasks excluded because native project identity is device-local |
| `readingItems`, `readingTrash` | id, title, type, HTTP(S) url, notes, status, category, finishedAt, sourceKey, addedAt, updatedAt, origin, reportSource/reportDate/coverageDate; original deletion/recovery deadlines | importBatchId, classifier queue/errors/output, coverUrl/coverCheckedAt, pdfUrl, attachment excerpt/local download URL; only manual-category protection is retained |
| `readingReports` | `report:tech:<date>` / `report:aesthetic:<date>` keys; status, hidden, category, finishedAt | Device-local PDF paths/files and size/mtime `lastReadVersion`; each device preserves its own version |
| `readingSuppressions`, `readingExpiredIds` | Canonical URL/Bilibili ID/`file:SHA256` source key and removal time; expired IDs/times | Original files, browser candidates and legacy batches; source suppression must survive snapshot expiry |
| `ideas`, `ideasTrash`, `ideasRemovedIds` | Canonical ID, title, status, timestamps; entry ID/kind/content/timestamps; trash and minimum deletion identity | Preserve stable `legacy-…` IDs without creating a parallel editable idea store |
| `learningPlans`, `learningTrash` | UUID, title/course/goal/nextStep/nextStepId/dueDate/status/timestamps; stable entries/link ID/title/url and deletion/expiry times; plan trash | Page drafts, temporary requests and runtime state; nested nodes keep their existing recovery deadlines |
| `inspiration-garden.json`: `metadata` | Same Idea ID, tags, pinned, fusion source ID/title/body/timestamps and recursive source snapshots | Local projectId; drafts/chats excluded recursively, including inside old source snapshots |
| Legacy `projects`, `projectTrash`, `expiredIds` | Existing DailyHouse project UUID, title/goal/mvp/acceptance/nextStep/nextStepId/sourceBubbleId/sourceSnapshot/status/todoId/timestamps; trash and minimum permanent-deletion markers | draftId and AI records inside snapshots; summaries are not native Codex/Claude conversations |
| `work-journal.json`: entries/trash/deletedDates | Stable New York date, title/codex/life/reflection/status/lifeState/timestamps/editedFields/writer; recovery and automatic-write suppression | Local concurrency revision; codex is an already-authored summary, not a raw tool-chat dump |
| `shared-projects.json` | Independent project ID, authored title/goal/decisions/progress/nextStep/repoUrl and lifecycle fields | Current-device links and native project/chat identities |
| `project-resume.json`, `device-project-links.json` | Not synchronized as files | Cache paths, native project/chat IDs, previews/latest turns/Git facts, hidden paths, legacy launch context/retry steps, replaced-thread IDs, credentials and device links |
| `reading-attachments/<SHA256>.<ext>` | Missing-copy description: id/name/size/mime/extension | File bytes, excerpts, local URLs, staged uploads/descriptors and deletion quarantine; originals are never removed by sync |
| Collection runtime files | Not synchronized | Five summaries, `dailyAttempt` and persistent collection-chat binding; custom data directories keep them locally too |
| Personal settings/external sources | Not synchronized | vaultPath, calendarFile/calendarUrl, report paths, browser login/connection, model installation and checkout/project paths; no whole-vault/calendar upload |
| Browser storage, `.runtime/local-ai/`, environment/credentials/logs | Not synchronized | Pomodoro, theme/language/motion/list preferences, unsaved drafts, installed models, caches and login; preserved upstream SQLite files are excluded |

Top-level local revision is not shared. The cloud uses its own versions/operation IDs; incoming content changes advance local revision so existing edit pages still detect conflicts. Identical replay does not rewrite/advance records. Journal `editedFields` is shared manual-edit protection and must be retained.

## Applying records and deletion

`syncExport()` reads loaded DailyHouse snapshots and returns independent records without writing/scanning desktop or tool databases. `syncApply(records)` only handles supplied records; absence, an empty array or a fresh empty device never means deletion. Validate all identities, fields, nested nodes, URLs and recovery deadlines before atomic replacement of each storage group. Unknown/malformed fields reject that group's change.

Live/trash share identity. Body plus `deletedAt/expiresAt` retains the original recoverable snapshot; `body:null` is an explicit permanent-deletion marker. Export of expired content retains only minimum markers. Thirty days limits content recovery, not marker lifetime. Cloud versions gate delete/restore; stale devices cannot resurrect removed records.

Keep each feature's existing lifecycle: tasks/individual idea updates delete immediately; learning nodes and recoverable parents keep their documented deadlines. Sync invokes no shell, native deletion, GitHub deletion or original-file removal. Applying projections does not trigger attachment cleanup; normal local management may later clean verified owned/orphaned copies.

Matching shelf IDs keep this device's existing attachment. A new device receiving metadata gets no invented download address; the missing file cannot be read there. Later private file upload needs a separate approved whitelist, integrity/retry/completion protocol; partial bytes are not available content.

## Canonical-source conflicts

The same source with different UUIDs on two devices is a conflict, not automatic note/category/state replacement. The preview retains both versions. An explicit Keep cloud item and retire local duplicate choice puts the local duplicate/current notes in 30-day recovery and clears this source's suppression only for that reviewed resolution. Users then consolidate notes manually. Normal removal keeps suppression and blocks automatic download/revival.

Old-device alternative IDs are also blocked by source suppression. Explicit restore or manual re-addition plus a synchronized suppression removal is required. Title equality is not identity. There is no automatic cross-ID text merge, native project-ID merge or upload of native project actions/tasks.

## First migration, backups and withdrawal

Before first upload, preview source device/time, selected record types/counts, additions/existing/conflicts/deletions, actual titles/text, attachment metadata with zero uploaded bytes, target service, exclusions and merge behavior. Preview freezes snapshot/hash; local/cloud changes reject stale confirmation. Later edits in the approved scope participate in continuous sync, while conflicts wait for a decision.

Approval first backs up `personal-workbench.json`, `inspiration-garden.json`, `work-journal.json`, `shared-projects.json` and `private-sync.json`, recording existence and SHA256 without manufacturing absent files. It does not copy/upload attachments, native tool records, credentials or device-path files. Keep those separately if needed. Private ignored migration backups do not auto-expire; do not replay them online into cloud. Provider backup retention must be checked at deployment.

The initial Windows device submits only after reviewed approval. New devices read cloud before comparing local records; empty devices download rather than submit a replacement snapshot. Durable queues/versions retain concurrent edits and gate restore/delete. Retry replays the same operation ID without new UUIDs or external project creation.

Pause before sending to retain local originals. After upload, withdrawing shared content requires a confirmed deletion marker affecting other authorized devices. Restoring a local backup does not undo another device's later edits; review cloud versions first. The engine's recovery journal coordinates multiple stores; projection alone guarantees only per-file atomic writes. Missing/reset source files are not inferred cloud deletions.

## Verification and limits

Synthetic projection tests cover read-only export, recursive chat exclusion, round trips/partial apply, stable IDs/local revisions, canonical conflicts, validation-before-write, deletion/recovery/expiry suppression, missing attachments, original-file preservation and journal manual locks. Engine/schema tests additionally cover durable replay/checkpoints and authorization/revocation.

These are local tests, not proof of hosted deployment, live multi-device migration or end-to-end encryption. Hosted creation, real Auth/RPC checks and the first private upload still need separate review. See [private sync operations](private-cloud-sync.md) for deployment, device setup and recovery.
