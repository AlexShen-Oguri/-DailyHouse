# DailyHouse

A local personal workbench for Windows and macOS, with an original pixel garden, Chinese/English interface, day/night themes, keyboard access and reduced motion. macOS supports Apple Silicon and Intel. Personal records stay local by default.

## Install, start and stop

| Platform | First installation and build | Start | Stop |
| --- | --- | --- | --- |
| Windows | Install Node.js 24, then run `Install.cmd` | `Start.cmd` or the desktop shortcut | `Stop.cmd` |
| macOS | Run `Install.command`; it installs a verified project-local Node.js 24 runtime if needed | `Start.command` or the desktop shortcut | `Stop.command` |

Open [the local workbench](http://127.0.0.1:3456/). Start reuses a verified running service; closing the browser or terminal leaves the backend running. Stop only stops the service owned by this checkout. After source updates, stop, install/build, then start again.

Create the desktop entry with `scripts/Install-DesktopShortcut.ps1` on Windows or `Install-DesktopShortcut.command` on Mac. Both use the shared pixel cottage icon. Moving the checkout requires rebuilding its shortcut; deleting the shortcut preserves the checkout, records and running service. The generated Mac app and its absolute path are local artifacts.

See [Mac setup and migration](docs/macos-local.md) for runtime verification, Chrome, optional login/wake collection and troubleshooting. GitHub synchronizes source code, not personal records or credentials.

## Features

| Area | Current behavior | Guide |
| --- | --- | --- |
| Home | Today's tasks and calendar, garden preferences, browser-local 25/5, 50/10 or custom pomodoro with a growing tomato plant | [Pomodoro](docs/home-pomodoro.md) |
| Today | Manual tasks with dates, completion and deletion; read-only Google/iCloud/local ICS calendar for the next 180 days | [Product contract](PRODUCT.md) |
| Reading shelf | Links, copied local documents and book entries; type/topic filters, notes, completion, removal and 30-day recovery; optional local Qwen classification | [Reading and imports](docs/reading-import.md) |
| Bilibili collection | Browser DOM evidence and one persistent project-owned Codex collection chat; direct selection into existing categories; latest five summaries | [Browser setup](docs/reading-collection.md), [daily 10:00 collection](docs/daily-collection.md) |
| Study plans | Dedicated chronological timelines, resource links and explicit next-step tasks; editing, scoped deletion and recovery | [Study plans](docs/learning-plans.md) |
| Idea garden | One canonical idea timeline, list/bubbles, manual fusion, local preview/copy of selected timeline exploration prompts, confirmed empty private GitHub repository creation | [Ideas](docs/ideas.md) |
| Projects | Verified local Codex projects, Git history, next-step actions and separately stored cross-device project context; native Codex/Claude Code continuation | [Project resumption](docs/project-resume.md), [tool connections](docs/development-tools.md) |
| Work journal | One entry per New York date, manual edits, confirmed removal and 30-day recovery; protected publishing from the existing diary chat | [Work journal](docs/work-journal.md) |
| Obsidian | Search and read Markdown in a configured local vault; open the original note in Obsidian | [Privacy](PRIVACY.md) |
| Settings | Source paths, calendar configuration, animation preferences and optional private sync scope/preview/conflicts/device revocation | [Private sync](docs/private-cloud-sync.md) |

Report production remains an independent external workflow. The shelf discovers existing final PDFs; Bilibili collection does not generate reports or collect other sources. A configured source is shown as connected only after verification.

Private sync has a local protocol, reviewed field projections and a Supabase deployment migration. Hosted resource creation, deployment validation and the first real upload remain pending separate review and authorization. No private service address or credentials are embedded in source. Attachments, native tool conversations and device paths are excluded from uploads; this is not end-to-end encryption. See the [field inventory](docs/private-cloud-data.md).

Finance and desktop scavenging are cancelled. Inspiration AI conversations and automatic workspace/conversation creation or handoff are retired. Cross-source inbox/control-center features, Obsidian writes and Issue/PR collection remain unapproved proposals; they are not current capabilities.

## Data and backups

The backend binds to `127.0.0.1`. Its default private directory is `backend/data/`; `WORKBENCH_DATA_DIR` can select another local directory.

| Storage | Purpose |
| --- | --- |
| `personal-workbench.json` | Tasks, shelf records, source settings, ideas, learning plans, project actions and recovery/suppression markers |
| `reading-attachments/` | Managed copies of manually imported documents |
| `inspiration-garden.json` | Idea metadata, fusion snapshots and preserved legacy drafts/chats/project notes |
| `project-resume.json` | Device-local project cache, legacy launch history and repository creation records |
| `work-journal.json` | Journal entries, recovery snapshots and deleted-date suppression |
| `shared-projects.json` | Authored cross-device project context |
| `device-project-links.json` | Current-device directories and native tool associations |

Sync queues, device credentials and migration checkpoints are also local; see [sync storage and recovery](docs/private-cloud-sync.md#storage-backups-and-withdrawal). Collection state normally lives in `.runtime/`, or in the configured data directory. Language, theme, animation preference and the current pomodoro are browser-local. Unsaved idea drafts are tab-local.

Stop the service before making a private backup of the full data directory and `backend/.env.local`. Back up external reports, Obsidian notes and project code separately. Cross-device migration must preserve each device's own credentials and paths. Never commit records, attachments, previews, screenshots, logs or runtime backups.

## Development

Follow [Contributing](CONTRIBUTING.md), [AGENTS.md](AGENTS.md), [SECURITY.md](SECURITY.md) and the [Development Security Standard](docs/development-security.md). Current behavior is documented in [PRODUCT.md](PRODUCT.md); appearance in [DESIGN.md](DESIGN.md); artwork and exact generation prompts in [artwork provenance](docs/artwork.md).

DailyHouse is customized from the MIT-licensed LShu workbench. Preserve [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). The original approved baseline and subsequent changes remain in Git history. Each completed change is verified, committed descriptively and pushed to `origin/main` without rewriting published history.
