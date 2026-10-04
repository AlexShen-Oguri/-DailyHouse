# macOS local setup

Windows and Mac use the same source, record formats and loopback address `http://127.0.0.1:3456`. Apple Silicon and Intel are supported without Homebrew, Docker, Xcode or native SQLite compilation.

## Installation and daily use

Run `Install.command` in the checkout. It prefers the project runtime, then an installed Node.js 24/npm pair; otherwise it downloads pinned official Node.js 24.18.0, verifies its fixed SHA256 and installs into Git-ignored `.runtime/node/`. Archives/checksums come from the [official release directory](https://nodejs.org/download/release/v24.18.0/). It writes only in the checkout, does not change system configuration, and installs/builds both locked packages. Initial downloads require network access.

Use `Start.command` to start/reuse the verified background service and open Google Chrome, or `Stop.command` to stop only this checkout's service. Closing the browser/terminal leaves it running. Missing Chrome shows the URL for manual opening while keeping the service available; default-browser settings are unchanged. Missing dependencies/builds trigger installation; after source updates, stop, install/build and start again.

Ordinary installation does not enable login startup. The optional daily checker below can start the service when collection is due.

## Optional daily collection and login/wake catch-up

After setup and verified Chrome extension connection, run `Enable-DailyCollection.command`. It installs a checkout-owned LaunchAgent in the current user's `~/Library/LaunchAgents/`, running at login and every 60 seconds. It catches only the latest overdue New York 10:00 schedule, including yesterday on a later morning before 10:00, without replaying a backlog or dates before enablement. Browser login/connection and Codex availability are still required; it cannot read before login or while powered off. See [daily collection](daily-collection.md).

The checker reuses a verified healthy service or safely starts it. Unrelated port owners are not stopped. It opens Chrome at most once for a due date, waits for disconnection without consuming an attempt and never auto-retries failure/cancellation. Before source upgrades, disable the checker, stop/build/restart and then enable it again.

`Disable-DailyCollection.command` unloads/removes only the verified LaunchAgent for this directory, retaining shelf, summaries, chats, projects and the running service. The independent Codex 10:00 task must also be paused to disable all automation. Generated plist/absolute paths are local, never committed or copied to another device. Checker state is `.runtime/daily-reading-schedule.json` (enable date) and `.runtime/daily-reading-browser.json` (latest due date/open attempt), without watch lists. The backend atomically owns daily admission.

```sh
.runtime/node/bin/node scripts/macos-daily-reading.mjs status
.runtime/node/bin/node scripts/reading-import.mjs daily-status
.runtime/node/bin/node --test scripts/macos-daily-reading.test.mjs scripts/macos-workbench.test.mjs scripts/reading-import.test.mjs
```

Checker installation/loading and actual collection result are distinct. Startup errors use `.runtime/daily-reading.stderr.log`. Verify extension/login in Chrome and use the shelf to retry; do not bypass admission with an automatic manual read.

## Pixel desktop entry

Run `Install-DesktopShortcut.command` to create the desktop app named “日常小院.app”. It uses the shared original cottage/planter icon: Mac ICNS exports use nearest-neighbor scaling from the same PNG as Windows. See [artwork provenance](artwork.md).

The app opens this checkout's `Start.command` through the standard terminal entry, then Chrome; it reuses the background service. The generated app contains a local checkout path, not source or personal records, and is not committed. Errors remain visible in Terminal; backend diagnostics are in `.runtime/backend.stderr.log`. The installer replaces only a verified shortcut for this same checkout and refuses unrelated same-name entries.

After moving the checkout, remove its old desktop shortcut and rebuild from the new location. Trashing the shortcut preserves source/data/service; use Stop to stop the service.

```sh
./Install-DesktopShortcut.command
```

## Terminal development

```sh
./Install.command --run-tests
./Start.command
./Stop.command
```

`./Start.command --no-browser` starts only the background service. For development, run these from the checkout in separate terminals:

```sh
export PATH="$PWD/.runtime/node/bin:$PATH"
cd backend
npm run dev
```

```sh
export PATH="$PWD/.runtime/node/bin:$PATH"
cd frontend
npm run dev
```

Development frontend: `http://127.0.0.1:5173`, proxying API to port 3456 by default. An existing system Node.js 24 needs no project-runtime PATH change.

## Windows data migration

GitHub transfers source only. Browser preferences, credentials, native Codex/Claude chats, source subscriptions and device paths do not migrate through Git. Optional [private sync](private-cloud-sync.md) provides record projections after separate deployment/upload approval; it is not currently a hosted transfer service.

For an offline replacement into an intentionally empty destination (not a merge of two active histories):

1. Disable the optional checker and pause any configured sync on both devices. Stop Windows with `Stop.cmd` and Mac with `Stop.command`. Make separate private backups of each full data directory and environment file before replacing anything.
2. Transfer authored `personal-workbench.json`, `inspiration-garden.json`, `work-journal.json`, `shared-projects.json` and managed `reading-attachments/` together when present. Preserve deletion/suppression records. Do not splice JSON files or overwrite an active destination's edits without reviewing the replacement scope. Missing files need not be manufactured.
3. Keep each device's `private-sync.json`, `sync-device.local.json`, `sync-credentials.local.json`, `device-project-links.json`, collection state/chat binding and environment credentials on that device. Do not copy these as the other device's identity or restore a foreign pending sync queue. Retain the source `project-resume.json` privately for legacy evidence; its native paths/chats are not portable associations.
4. Configure Mac paths/subscriptions explicitly through settings; copied Windows settings must be repaired before using sources. Merge only necessary private environment settings, keeping Mac executable paths and device credentials. Copy reports/Obsidian/code separately or use their existing independent sync. Re-read local Codex and link existing Mac directories; this does not restore Windows conversations or download code.
5. Start locally, check records/attachments/sources, and only then review a fresh sync preview if reconnecting. Source backups and external resources remain untouched. Do not auto-replay an old baseline into cloud.

Language, theme and pomodoro are browser-local and are not in server backups. All transfer/backups stay out of Git. For same-device restore instead of cross-device migration, see [sync recovery](private-cloud-sync.md#storage-backups-and-withdrawal).

## Optional sources

- Enter Mac absolute paths for Obsidian and report directories. Source-path OS dialogs currently support Windows; Mac can enter paths manually. Ordinary browser file uploads remain available.
- Apple Calendar reads a configured existing iCloud subscription or exported ICS. Starting DailyHouse does not grant native Calendar permissions or read EventKit. Exports are snapshots; subscriptions refresh on read.
- Ollama/Qwen is a separate optional Mac installation; Windows portable binaries are not transferable. Ordinary tasks, ideas and reading remain usable without it. See [local AI](local-ai.md).
- Codex project access needs local CLI/login; GitHub association needs its own valid login. Desktop launch may have a different PATH from Terminal. A working terminal command is not evidence that the backend can find it.

## Troubleshooting

- Logs: `.runtime/backend.stdout.log`, `.runtime/backend.stderr.log`; process state: `.runtime/backend.macos.json`. Stop verifies directory, full command and start time, never bare/stale PID ownership.
- An occupied port fails without stopping other listeners. `PORT` in local environment can select 1024–65535; Stop/Start after changing it. Browser collection uses its fixed extension service port, so verify that connection separately when changing ports.
- An interrupted operation may leave `.runtime/macos-operation.lock` or `.runtime/node-install.lock`. Confirm no related operation is running before removing the empty lock directory and retrying.
- If executable permissions were lost, run `chmod +x Install.command Start.command Stop.command Install-DesktopShortcut.command Enable-DailyCollection.command Disable-DailyCollection.command` in this checkout.
- Dependency-install failures preserve records; fix connectivity and rerun Install. Never delete the private data directory to reinstall.

### Codex works in Terminal but not in Projects

1. In a working terminal run `command -v codex` and verify the real executable absolute path; do not copy another computer's install path.
2. Set `WORKBENCH_CODEX_EXECUTABLE` to that path in private `backend/.env.local`, retaining other configuration. This one adapter setting is shared by project access and shelf collection.
3. Run Stop, then Start to reload configuration. In Projects explicitly refresh Codex/GitHub.
4. Verify actual Codex read status, projects/chat previews and available commit history. A GitHub association alone does not verify Codex.

The check reads current-device projects/chats only. Another device's unpushed commits cannot appear by refreshing. Local history remains locally available evidence.

```sh
export PATH="$PWD/.runtime/node/bin:$PATH"
node --test scripts/macos-workbench.test.mjs
curl --fail http://127.0.0.1:3456/api/health
```

Launcher tests use temporary directories/synthetic services to verify Unicode/spaced paths, service reuse, config preservation, safe stopping, occupied ports and mismatched identity. They do not access personal records or establish real cross-device sync.
