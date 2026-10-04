# Daily Bilibili collection

Daily collection is scheduled for **10:00 America/New_York**, using local Chrome signed in to Bilibili. The existing Codex heartbeat stays in the owner-confirmed collection chat. Optional Mac login/wake catch-up shares the backend's same once-per-schedule admission. Manual and scheduled collection reuse the project-owned Codex “书架收集” chat and keep its binding across restarts.

The server calculates New York dates and 10:00 with daylight-saving rules, independently of the computer's display time zone. Today's task cannot start early. A next-morning login before 10:00 can catch the latest overdue date; several offline days still produce only one catch-up, reading the actual start time's preceding 7×24 hours. First enablement does not replay dates before enablement.

## Execution

1. Check `http://127.0.0.1:3456/api/health`. If needed, Mac uses `./Start.command --no-browser`; Windows uses `scripts/Start.ps1 -NoBrowser`. Reuse a healthy verified service, without restarting it, stopping unrelated processes or changing/committing source.
2. Verify Chrome login and the project extension's connection. Load `extensions/bilibili-reading` at `chrome://extensions` on first setup. Configuration is not proof of connection.
3. Run `scripts/reading-import.mjs daily-status` with verified Node.js 24 (`.runtime/node/bin/node` on Mac). Follow an existing run; otherwise use `scripts/reading-import.mjs daily`. Scheduled callers must use `daily`, not unrestricted manual `read`. Respect `before_time`, `waiting_browser`, `already_started` and `started`; only the last means a new attempt. Catch-up uses the same protected backend admission.
4. Poll `status` every 15–30 seconds until `completed`, `partial`, `needs_login`, `failed` or `cancelled`. If still active after ten minutes, report its actual state without starting a duplicate or claiming completion.
5. The server enforces time, known progress below 25%, latest-source evidence, duplicates and removal suppression, then adds one candidate-only turn to the persistent Codex chat. Failed resume does not create a replacement. No review queue, acceptance overrides or batch review remain; only five summaries are kept.

This task collects only Bilibili. It does not refresh calendars, generate reports, read bank accounts, create inspiration drafts or trigger other collection. Active scheduling is not evidence that a run succeeded.

## Mac catch-up and stopping automation

After local setup and Chrome connection, run `Enable-DailyCollection.command`. The optional checkout-owned LaunchAgent runs at login and checks every 60 seconds, usually admitting a due run within a minute after login/wake. It safely starts/reuses this checkout's service and opens the shelf in Chrome at most once per due schedule. It cannot collect while powered off or before the local user session is available.

Browser disconnection waits without consuming the attempt. Keep the opened history page visible; background interruption is reported as partial coverage. Codex login/model access must actually be available. Failed or cancelled attempts do not auto-retry; the shelf's One-click read provides an explicit retry.

There is at most one automatic start per schedule. A manual read after New York 10:00 also counts as that day's attempt. Active work is followed rather than restarted; completion, failure and cancellation all retain admission. Summary deletion/pruning cannot trigger another automatic run. Catching yesterday before today's 10:00 leaves today's allowance available.

Run `Disable-DailyCollection.command` to unload only the verified LaunchAgent belonging to this checkout. It preserves the service, shelf, summaries, external chats and projects. To disable all automation, also pause/delete the independent existing Codex 10:00 task in its task card. Disabling/removing the extension only disconnects browser collection and preserves records. Reenable with `Enable-DailyCollection.command`.

The LaunchAgent and absolute paths are local artifacts and are not installed by cloning source. Each device enables its own configuration. The checker uses verified project-local Node.js 24 and protected loopback APIs; it creates no extra conversations and has no other-source responsibilities. See [Mac setup](macos-local.md#optional-daily-collection-and-loginwake-catch-up).

## Reports and notifications

The independent 09:00 report production workflow remains separate. Final PDFs appear when the shelf opens/refreshes or checks every 60 seconds while visible, including files completed after 10:00. Reopening catches files written while the page was closed. Finished and removed states remain.

Stay quiet when there are no additions or new actionable failures. Report meaningful additions with a shelf link; explain required login recovery or persistent failure without repeating unchanged issues. Keep at most five local summaries and no detailed watch list. Never edit personal JSON directly or roll back records to recover collection.
