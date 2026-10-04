# Reading shelf and imports

## Browser collection

Click **One-click read** on the shelf. Browser evidence from the preceding seven days is processed in the persistent project-owned Codex collection chat, named “书架收集”. Manual and scheduled runs add turns to the same chat across service restarts. Useful candidates go directly into existing categories; there is no candidate review queue or manual acceptance override. Only the latest five run summaries remain. See [browser collection](reading-collection.md).

The server enforces the rolling 7×24-hour window, known playback progress strictly below 25%, the latest observation per source, deduplication and removal suppression. Codex cannot bypass these checks. It selects educational/practical content and skips uncertain candidates without requiring user review.

```sh
node scripts/reading-import.mjs read
node scripts/reading-import.mjs status
node scripts/reading-import.mjs history
```

On Mac, use `.runtime/node/bin/node` if Node.js is not on PATH. `read` starts asynchronously, `status` reports browser/model progress and `history` returns five summaries at most. The CLI uses the local HTTP API and never edits personal JSON directly. Legacy `preview`, `apply` and `undo` commands are retired; old review/batch endpoints return HTTP 410. Scheduled runs use `daily`, described in [daily collection](daily-collection.md).

## Manual imports and managed files

Quick import accepts one or more links, book entries, local PDF/EPUB/Markdown/TXT copies and link lists. Edit titles, media types or categories before saving the batch. Imported documents are managed copies in `reading-attachments/`; original files are never moved or deleted. Back up copies with the personal JSON. Attachments and temporary upload descriptors stay out of Git.

After saving, optional local Qwen classification runs automatically. High-confidence results update the topic; uncertain output preserves the current category and does not create a review queue. Failure preserves content with retry/manual-classification controls. Explicit manual categories and later user changes always take precedence. The model sees bounded metadata and supported text excerpts, not video contents or PDF/EPUB bodies. See [local AI](local-ai.md).

Reading state, media type and topic are separate. Unfinished/Finished are the primary views; type/topic/search/in-progress filters refine the list. Existing notes and user edits are preserved when another source observation arrives. Known source covers can appear for videos/courses; image failure leaves usable text and actions.

## Existing reports

The independent report workflow starts at New York 09:00. DailyHouse discovers nonempty final PDFs in configured directory roots and deduplicates by report type/date:

- Tech: `YYYY-MM-DD_AI科技早报.pdf`.
- Design: `YYYY-MM-DD_每日审美图鉴.pdf`.

These exact source filename patterns remain Chinese. The shelf checks on opening, refresh, window focus and every 60 seconds while visible. Collection is not required for reports to appear. Missing files and drafts are not fabricated or imported; scheduled production time is not evidence of completion. Tech dates refer to news coverage, design dates to the issue. Updated files retain reading state and show a changed-version indicator. Opening serves the original PDF locally without modifying it.

## Completion, removal and recovery

- Completing an item saves first, then shows the check/fade feedback. The item, link, cover and notes remain in Finished and can be restarted. New completions record their date; missing historical dates are not invented. There is no completion-date filter.
- **Add to Today** creates an explicit task link; edit the category/notes or open the link/copy independently.
- Individual, selected or entire-shelf removal requires a scope confirmation and enters 30-day recovery. Select-all applies to the current list; entire-shelf removal includes filtered/finished records. Filters clear selection. Restore retains the original ID, state, notes, category, cover and known completion date; an existing re-added source is a conflict rather than an overwrite.
- Expired snapshots cannot be restored. Permanent deletion of a selected trash record is confirmed and affects only DailyHouse data and verified managed copies. Original files, external pages/projects and unrelated records remain.
- Removal keeps minimum source suppression so automatic collection/report discovery does not revive deleted items. Explicit manual re-addition is a new user choice; restoring is the way to recover the original ID/notes.
- Deleting a collection summary does not undo shelf additions, reset daily admission or remove the external Codex chat.

Legacy import batches, undo and review records are retired. Preserve current shelf data, manual categories and suppression; personal inputs, attachments, model context and logs must never enter Git.
