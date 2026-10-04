# Work journal

One entry per `America/New_York` date combines Codex progress, user-provided life/work notes and reflections/next steps. Replies after midnight update the original date. Do not invent feelings, accomplishments or plans; missing life notes do not mean the user had no offline activity.

## Usage and publishing

Open Work journal from navigation/home. Dates sort newest first; full-text search and month filters lead to a readable/editable date page. Personal text is rendered as text, not executed HTML. The established bilingual day/night, keyboard and narrow-screen behavior applies.

The existing New York 23:30 Codex heartbeat remains in the confirmed diary chat. It summarizes accessible activity, publishes a draft and asks for life notes; later replies or an explicit choice to skip update the same date. Codex manages that task. DailyHouse does not start another summarization model or scheduler. The computer, Codex and local service must be available. Publishing is local; any later cloud sharing requires an independently approved journal sync scope.

Use verified Node.js 24 and the local API, never direct JSON database edits:

```sh
./.runtime/node/bin/node scripts/journal-sync.mjs read 2026-10-01
./.runtime/node/bin/node scripts/journal-sync.mjs publish --input .runtime/journal-pending.local.json
```

Windows may use its installed Node.js 24. `--port 3456` selects a loopback port; remote destinations and redirects are refused. Input is a JSON file under 256 KB in a Git-ignored private temporary directory. Remove it after use; do not include complete chat dumps or credentials.

Synthetic example:

```json
{"date":"2026-10-01","revision":0,"title":"Example journal","codex":"Reviewed an example project.","lifeState":"waiting","status":"draft"}
```

Read first: a new date has revision 0, an existing date returns content/`editedFields`, and a removed date returns `deleted:true` and must not be recreated automatically. Publish the actual revision and only changed sections. `lifeState` is `waiting`, `provided` or `skipped`; status is `draft` or `final`.

Same-date publishing creates/updates rather than duplicates. Identical content does not advance revision. Concurrent/manual-field conflicts return 409; reread, review and preserve manual edits. Do not bypass protection through the manual editing API. Network failure is not success: read the target before retrying to see whether it saved. The CLI confirms response date/revision before reporting success; the diary chat should show the actual result and date-page link.

## Deletion and storage

The detail's Delete this entry names the date/scope and requires confirmation. Only that DailyHouse entry is removed; chats, projects, shelf and other dates remain. Trash restores the same date/content for 30 days; later saves clean expired snapshots. Minimum deleted-date suppression prevents automatic recreation. After expiry, the user can explicitly create the date manually.

`work-journal.json` stores entries/trash/deleted dates in `WORKBENCH_DATA_DIR`, normally `backend/data/`, with atomic replacement and mode 0600. It is private and Git-ignored. Include it in backups/migration; deleted content may remain in separately retained backups. Corrupt data blocks loading instead of silently clearing it.

The API inherits loopback, Host/Origin, cross-site and request-size protections. It does not read Codex credentials, raw browser history or full chat attachments. The authorized external diary chat performs the summary; DailyHouse receives only journal content. See [privacy](../PRIVACY.md) and [sync operations](private-cloud-sync.md) for upload/recovery boundaries.
