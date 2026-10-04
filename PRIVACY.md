# Privacy and local data

DailyHouse is a single-user service bound to `127.0.0.1`. Personal records, settings, managed document copies and device state are stored in the private data directory, normally `backend/data/`. Local files are not uploaded through GitHub. Browser storage holds interface preferences, the current pomodoro and some unsaved drafts; it is not a backup.

## Sources and external requests

- Calendar reads a user-selected ICS export or an explicitly configured Google/iCloud subscription. Feed URLs stay local and are not returned by status APIs. Calendar access is read-only.
- Obsidian reads Markdown in a user-selected local vault. It does not write notes or execute their HTML.
- Report discovery reads filenames, sizes and modification times in configured directory roots. Opening a report serves the original PDF locally; the app does not upload, rewrite or delete it.
- Manual reading imports retain links, notes and managed copies. Opening an external link lets the browser visit that site. Cover lookup uses bounded public metadata/image requests with domain validation; it does not read login credentials or download video.
- Optional Qwen classification sends limited imported-item metadata and supported text excerpts to a loopback Ollama service. PDF/EPUB bodies and video transcripts are not extracted. Model/runtime installation requires downloads. There is no cloud fallback in the managed local-model service.
- Bilibili collection reads visible history cards through the Chrome/Edge extension. The selected candidates are sent to the one persistent Codex collection chat using the current device's existing login. This model step is external processing, not local Qwen inference. It does not upload the whole shelf, cookies, passwords or private history API responses. The website keeps only five local summaries; the external Codex chat retains its own history.
- Project/tool status uses bounded official CLI/app-server calls. GitHub lookup and confirmed empty private repository creation use the current device's credentials in memory. Native credential stores and full conversation databases are not copied or synchronized.
- Idea exploration prompts are built and previewed locally. Sending their selected content to an external AI is a separate manual copy/paste decision. Inspiration AI generation and automatic context handoff are retired.
- Journal publishing receives authorized summaries and life notes through the local API; it does not ingest raw chats, attachments or login files.

Source status is verified rather than inferred from configuration. Desktop scavenging, banking and retired upstream connectors are not active.

## Optional private synchronization

Local storage remains the default. The owner may review and approve specific record projections for an independently configured private Supabase backend. Hosted creation/deployment and the first real upload still require separate authorization. The approved scope includes private authored text, so preview its actual contents before uploading.

Attachments are described but their bytes/excerpts are excluded. Device paths, browser state, environment files, source subscriptions, model installation and native conversations/credentials stay on each device. Ordinary cloud encryption and access controls are not end-to-end encryption; the provider and authorized administrators can access cloud plaintext. Other installations never silently use the owner's backend. See [sync scope](docs/private-cloud-data.md) and [sync operations](docs/private-cloud-sync.md).

## Deletion and backups

Deletion manages DailyHouse records and verified managed copies only. It never removes original source files, external conversations, local project directories or GitHub repositories. Recoverable records retain their documented 30-day deadline. Persistent minimal suppression/deletion markers prevent automatic resurrection; pauses and device revocation do not erase already uploaded cloud records.

Private backups may retain deleted text and legacy chats until their own retention ends; automatic backup cleanup is not implemented. Stop the service before backing up the data directory and local environment configuration. Keep external notes/reports/code separately, and keep all records, credentials, previews, logs and backups out of Git. See [SECURITY.md](SECURITY.md) for development and release requirements.
