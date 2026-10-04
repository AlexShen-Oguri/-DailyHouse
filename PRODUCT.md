# DailyHouse product contract

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A single owner working on Windows and macOS. Local operation and storage are the default; optional private sync serves only that owner's explicitly authorized devices. Other installations use their own local or independent cloud storage.

## Product Purpose

Keep daily tasks, read-only schedules, reading materials, long-term study, ideas, project continuation and daily reflections accessible in one personal garden. Suggestions do not authorize new features.

## Capabilities and Constraints

The interface has nine navigation entries and separate idea, study-plan and journal detail pages. The app uses hash routing.

| Route | Surface | Current scope |
| --- | --- | --- |
| `/` | My garden | Daily overview, garden preferences and a browser-local pomodoro. |
| `/todos` | Today | Manual dated tasks; read-only calendar with a 180-day range and month selection. |
| `/reading` | Reading shelf | Unfinished/finished views, type/topic filtering, manual imports, optional local classification, existing report discovery and 30-day recovery. |
| `/learning`, `/learning/:id` | Study plans | Independent goals, chronological timelines, resource references and next-step tasks. |
| `/journal`, `/journal/:date` | Work journal | One record per New York date, search, edits, protected chat publishing and recovery. |
| `/ideas`, `/ideas/:id` | Idea garden | Canonical ideas/timelines, bubbles/list, manual fusion, selected-entry prompt preview/copy and reviewed empty private repository creation. |
| `/projects` | Projects | Verified local Codex workspaces, Git/GitHub evidence, explicit next-step actions, shared context and device-local continuation links; legacy project notes remain separate. |
| `/knowledge` | Obsidian | Search and read a configured local vault; no note writes. |
| `/settings` | Settings | Source configuration, decoration preference, current-device tool status and optional private sync. |

- React/Vite frontend and Node.js 24/Express backend; production serves the frontend and API from one loopback address. Retired upstream connectors, SQLite runtime and schedulers are not loaded.
- Chinese/English and day/night are independent browser preferences. User-authored content is not translated or rewritten when the interface language changes.
- Tasks are explicit user actions. Source content, timer sessions and Git facts do not establish learning progress or project completion. Project action completion requires a recorded result.
- Calendar supports configured Google/iCloud subscriptions or a local ICS export. It preserves time zones, all-day events and recurrence exceptions, reports limits honestly and never modifies source events. Subscription URLs stay local and are omitted from status responses.
- Obsidian requires a local vault with `.obsidian`; Markdown is rendered as text. Reports are discovered only in configured directory roots by final filename and nonempty PDF evidence. The app does not produce or modify reports.
- Bilibili reads browser-rendered evidence from the preceding 7×24 hours, uses the latest observation per source and requires known progress strictly below 25%. One persistent Codex collection chat selects useful candidates into existing categories. There is no review queue, acceptance override or batch undo. Only five collection summaries remain. Daily collection is New York 10:00 and collects only Bilibili; optional Mac catch-up admits only the latest overdue schedule.
- Manual imports copy supported files into managed attachment storage. Qwen classification runs after saving; uncertain output preserves the current category, manual edits take precedence and failures remain retryable. Linked pages and original files are not modified.
- Reading completion preserves notes/links and records a real completion time when available. Missing historical dates are not invented. Removal suppression prevents automatic reimport; explicit manual re-addition remains possible.
- Ideas have one canonical identity and timeline. Fusion preserves original ideas and source snapshots. The manual exploration prompt contains only the title, explicit initial direction and selected saved entries, stays in memory and is copied by the user. It does not invoke a model or create a chat. Repository creation requires a concrete confirmation and creates only an empty private GitHub repository.
- Study plans have separate identities and timelines. Editing keeps chronology; duplicate next-step additions reuse existing tasks without overwriting edits. Links allow only HTTP(S), without embedded credentials.
- Journal dates use `America/New_York`. Publishing reads revisions first, preserves manual field locks and deleted-date suppression, and receives summaries rather than raw chat dumps. The existing 23:30 diary heartbeat stays in its confirmed chat.
- Project status is evidence-based. Local Git, cached remote-tracking refs and explicit GitHub API queries have distinct provenance. Viewing does not clone, fetch, checkout, commit or push. Shared context and each device's paths/native associations are separate; a shared repository URL does not restore another device's native chat.
- Every created item, including nested records, needs discoverable scoped deletion. Confirm destructive removal, retain unrelated data and test deletion. Recoverable records retain their documented 30-day deadline; tasks and individual idea updates use immediate deletion. See the relevant feature guide for exact scope.
- Website deletion never removes external conversations, Codex/Claude projects, project directories, GitHub repositories or original files. Managed document copies may be cleaned only under verified ownership rules.
- Private sync starts with no selected upload scope. Preview, stale-snapshot checks, local migration backups, durable retries/conflicts, stable IDs, explicit deletion markers and revocable device grants protect approved projections. Hosted deployment and first real upload remain pending authorization. Attachments, credentials, device paths and native chats stay local.

Finance, desktop scavenging, inspiration AI conversations, automatic project handoff and the former learning-progress card are cancelled. The separately authorized study-plan manager and scoped manual idea prompt remain available. Cross-source inbox/control center, Obsidian writes, Issue/PR collection and public multi-user hosting require a new owner decision.

## Brand Commitments

Preserve the original pixel garden, wood/paper materials, plants, square controls and readable body text. Day uses cream and green; night uses navy, dark wood and warm lights. Support desktop/narrow layouts, keyboard access, honest empty/error states, optional animation and system reduced motion. No copied game assets, fictional currency or fabricated source status.

## Evidence on Hand

Routes and navigation: `frontend/src/App.tsx` and `frontend/src/components/AppShell.tsx`. Behavior: `frontend/src/personal/` and `backend/src/personal/`. Visual implementation: `frontend/src/components/` and `frontend/src/styles/`. Persistent storage and exact lifecycle rules are described by the feature guides linked in [README.md](README.md). Public documentation contains no personal records or machine-specific private paths.
