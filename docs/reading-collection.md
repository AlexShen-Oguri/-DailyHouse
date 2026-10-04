# One-click Bilibili collection

The shelf's **One-click read** obtains seven days of rendered Bilibili history and reuses the one persistent Codex collection chat, named “书架收集”, in this DailyHouse project. Manual and daily runs share it across service restarts. Codex selects useful content directly into existing categories; there is no user review/acceptance queue.

## Setup and daily use

1. Keep DailyHouse and Codex available. Load `extensions/bilibili-reading` as an unpacked extension in Chrome or Edge (Chromium 120+), and sign in to Bilibili in that same browser profile. Mac daily collection uses Chrome. Each device/profile needs its own extension installation and login.
2. On Mac, enter `chrome://extensions`, enable Developer mode and choose **Load unpacked**. In the folder picker, press `Command + Shift + G`, paste the local path shown under the shelf's Browser connection and select the folder directly containing `manifest.json`. Do not copy another device's path. See the [official unpacked-extension instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-an-unpacked-extension).
3. With the local service running and the extension enabled, allow about 30 seconds for connection and verify the shelf actually says connected. Refresh stale status if needed. The project Codex connection and shelf browser connection are independent.
4. Click One-click read. The extension opens a dedicated history page and brings its window forward once. Keep that page visible. It reads titles, links, playback position, viewing time and covers from the DOM; no cookies, passwords or private history API are read.
5. Once the page says Codex is organizing, browser reading has ended. The shared chat adds one turn using the configured default model. Each turn considers only this run's candidates, resets indices to zero and ignores older candidates/results.
6. New items enter Unfinished. Empty results, partial coverage, login failures and unavailable Codex are reported accurately. Use a manual retry when appropriate.

The extension version is in `manifest.json`; its fixed public ID is `nfgkhikgfkidmpngfifhfgpfifnnbnfc`. After extension source updates, use Reload on its existing card at `chrome://extensions`; server-only updates do not require extension reload. Neither uninstalling nor disabling it deletes shelf data, conversations or project directories. There is no Safari collection connector. Installation alone does not prove a successful real-history read.

The backend matches Codex to the DailyHouse checkout root, consistently from `backend/src` and `backend/dist`. Collection and project resumption share `WORKBENCH_CODEX_EXECUTABLE`; see [Mac Codex troubleshooting](macos-local.md#codex-works-in-terminal-but-not-in-projects) when desktop PATH differs.

## Selection and safety

- Window: the preceding 7×24 hours at actual collection start.
- Progress: known and strictly below 25%; unknown progress is skipped. Multi-part position describes only the observed part, not total course completion.
- Latest observation wins for a canonical source; an older low-progress observation cannot replace a newer one.
- Codex judges educational/professional/design/practical value and returns candidate indices with existing categories. Uncertain content is skipped.
- Existing items, notes, manual categories, finished state and removed-source suppression are preserved.
- The server validates all model output and rechecks eligibility. Invalid output, model failure, cancellation, disconnection or timeout writes no partial model result.

The collection turn disables shell, browser, plugin and other tools and does not read project files. Titles are untrusted source data. Only this run's bounded candidate input is sent; the same read-only/tool restrictions are reapplied on resume. Existing Codex login/configuration supply model access.

## Persistent chat, summaries and deletion

Recent reads contains at most five summaries: time, result, additions, coverage and a link to the shared chat. Older summaries are pruned when a sixth run begins. Candidate lists and per-item exclusion reasons are not kept. No candidates means completion without an empty model turn.

On first use, the backend prefers the latest previously recorded collection chat and verifies its project/directory before adopting it. It creates a chat only when no previous one exists. A busy, mismatched, archived or failed-to-resume chat keeps its association and reports an error; the backend never silently substitutes another chat. Restore an archived chat in Codex. Permanent deletion of the bound chat requires an explicitly reviewed new binding. Other historic chats are retained without copying/merging their turns.

Other Codex connections can hold the chat's write lock even without an active reply. For `codex_busy`, finish that work, then archive and restore the same chat in Codex before retrying. The original history remains. DailyHouse shows the error and original chat link, does not treat it as a login failure and does not interrupt another connection. This reflects the [Codex writer lock](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/writer_lock.rs).

Delete an individual summary with confirmation; shelf entries, the bound chat and daily admission marker remain. Shelf removal/recovery is described in [reading imports](reading-import.md). The retired workflow's migration clears old batches, read state and category-review metadata while preserving shelf contents; it must not recreate an old review queue.

## API and persistence

| Local endpoint | Behavior |
| --- | --- |
| `POST /api/personal/reading/collection {}` | Start a manual run or return the active run. |
| `GET /api/personal/reading/collection/daily` | Query today's New York 10:00 admission without starting. |
| `POST /api/personal/reading/collection/daily {}` | Start only when due, unattempted and browser-connected. |
| `GET /api/personal/reading/collection` | Current state and five recent summaries. |
| `GET /api/personal/reading/reads` | Recent summaries. |
| `POST /api/personal/reading/collection/:id/cancel {}` | Cancel this browser/model run. |
| `DELETE /api/personal/reading/reads/:id {"confirm":true}` | Delete one summary only. |

Daily admission accepts `?catchUp=true` for querying or `{"catchUp":true}` for starting the latest overdue schedule. The server computes the date; callers cannot select it or bypass connection, once-per-date or active-run checks. See [daily collection](daily-collection.md).

Browser evidence submission returns immediately; Codex runs in the background. Cancel affects only this model turn and rejects late results. Short-lived collection credentials are not persisted. Default local state is Git-ignored `.runtime/reading-collection.json` (v2), with five summaries and a separate `dailyAttempt` date/job ID. Deleting/pruning summaries does not clear daily admission. The binding is `reading-codex-conversation.json` (v1), with local directory/project/chat IDs only, atomically written with mode 0600. With `WORKBENCH_DATA_DIR`, both files use that private directory. Neither is synchronized across devices.

Processing resumes the bound chat with `thread/resume` and verifies this chat/turn's live `item/completed` and `turn/completed` notifications. `thread/read` verifies metadata/project ownership without loading history; cached turn state is not completion evidence. Persist selections only after a successful live completion and valid complete JSON. See the [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server).

Failure summaries retain safe error types for login, quota, connection, timeout and configuration. Raw upstream diagnostics/candidates stay out of persisted summaries. A failure does not create a substitute chat. Window visibility/focus follows the [Chrome windows API](https://developer.chrome.com/docs/extensions/reference/api/windows#method-update).
