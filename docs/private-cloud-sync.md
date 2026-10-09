# Private cloud sync: phase one

Local storage is default. Optional sync serves one owner's authorized devices. Supabase hosted Free validation and the current Windows device as initial source were selected; no private project address/account/key is embedded in source. Hosted creation, deployment and real-record upload have not been performed and still require concrete review/authorization. Express remains loopback-only.

## Current behavior

Settings offers scope selection, per-record preview/download, explicit approval, sync now, pause/resume, conflicts and device revocation. An unconfigured installation can preview local scope but cannot approve upload. Connected devices process approved scope every minute. Offline changes and durable outbox survive failures; an empty device is never a replacement snapshot.

The [field inventory](private-cloud-data.md) covers ordinary tasks, shelf notes/category/completion/suppression, ideas/timelines, learning, journal, legacy notes and independent shared project context. Native project actions/linked tasks are excluded until a portable identity exists. Attachment metadata is shared but **attachment bytes are not uploaded**; missing copies remain unavailable. Native chats/credentials/databases, Obsidian originals, source settings, device paths, browser state and model installation stay local.

Stable IDs, cloud versions, transactional compare-and-update and immutable operation IDs make retries idempotent. Operation history keeps hashes/versions rather than permanent body copies. Concurrent edits retain both versions for explicit resolution. Unexplained local-file loss blocks cloud deletion. Explicit durable deletion markers prevent stale-device resurrection. Existing 30-day recovery/expiry remains; website deletion never removes originals, native chats, code directories or repositories.

Server receipt times advance strictly for each canonical reading source under the existing write lock, even when the clock stalls or moves backwards. Clearing suppression permits a new shelf identity only when its receipt is strictly newer than the deletion; equal legacy timestamps retain the deletion. Authored timestamps and recovery deadlines remain unchanged.

For one source with different shelf IDs, download the private preview before choosing Keep cloud item and retire local duplicate. The cloud ID survives; local duplicate/current notes enter 30-day recovery, and only this explicit choice clears the relevant suppression. Consolidate notes manually. Ordinary removal keeps suppression. Automatic cross-ID merging is not implemented.

## Deployment review before resource creation

The migration is `supabase/migrations/20261004073110_private_sync.sql`. Owner configuration, devices, records and operations live in nonpublic `dailyhouse_private`. Tables have RLS; anonymous/ordinary authenticated roles lack direct table access. Public RPCs verify issued owner identity, live Auth session, device key/scope and revocation on every call. Only SHA256 device-key hashes are stored remotely. There is no public pairing endpoint; revoked clients cannot self-pair a replacement.

Before creation, review organization, available project allowance, region, name and current charges. Free-plan limits/pause/backup capabilities must be checked against the [current pricing](https://supabase.com/pricing); no long-term free or paid PITR guarantee is implied. The owner remains responsible for administrator MFA, owner account control, disabled public/anonymous signup, device management, independent backups and limits. Do not expose local Express publicly.

After approved deployment, verify:

- Only the manually created owner Auth account is usable; public registration and anonymous sign-in are disabled.
- Administrator MFA is enabled, private schema is excluded from exposed Data API schemas and database advisors have been reviewed. Table grants and RLS are distinct controls; see [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api).
- Synthetic authorized/unauthorized identities exercise hosted RPC, session expiry, wrong owner/scope, revoked device and denial paths before real migration.
- The latest Windows/cloud previews are checked immediately before the first upload.

Local PGlite tests emulate roles/Auth and verify PostgreSQL permission/protocol behavior; they are not hosted Supabase acceptance. Deployment approval does not itself approve a private-data upload.

## Local configuration and device authorization

1. Start DailyHouse to create persistent device identity. Set only `DAILYHOUSE_SUPABASE_URL` and `DAILYHOUSE_SUPABASE_PUBLISHABLE_KEY` in ignored `backend/.env.local`; examples use placeholders. Do not use service-role or `sb_secret` keys.
2. In `backend`, run `npm run sync:prepare` using Node.js 24. It generates the device key locally and outputs device ID/name and SHA256 hash, never the raw key; no cloud request is made.
3. In the private SQL console, configure the owner UUID and insert this device's ID/name/hash and approved scopes into `dailyhouse_private.devices`. Default owner configuration denies access. Only an explicitly designated administrator device may revoke others. Never save real SQL values in Git.
4. On that device's interactive terminal run `npm run sync:login`; enter owner email and hidden password. Password is not persisted. After owner-session/device checks, only device-local token/key files are saved. Browser/frontend receives no token or account form.
5. Restart DailyHouse, select scope and inspect actual upload/download/conflict/exclusion records. Approval makes a local migration backup but does not immediately transmit; Sync now or the next timer sends. First real upload still needs explicit approval of that preview.
6. Each Mac/new device generates, authorizes and logs in independently. An empty device only downloads; existing local records get a merge preview. Cloning source transfers no account/device configuration.

Use these placeholders in the private SQL console only after deployment. Owner UUID comes from the manually created Auth account; device values come from prepare. Reduce scopes to the actual approved set; other devices are not administrators by default. Do not paste filled credentials/device setup SQL into source or chat.

```sql
insert into dailyhouse_private.owner (singleton, user_id, enabled)
values (true, '<OWNER_AUTH_UUID>'::uuid, true);

insert into dailyhouse_private.devices (id, name, key_hash, scopes, administrator)
values ('<DEVICE_UUID>'::uuid, '<DEVICE_NAME>',
  decode('<DEVICE_KEY_SHA256>', 'hex'),
  array['todos', 'reading', 'ideas', 'learning', 'journal', 'projects'], true);
```

Revocation does not auto-pair again. For a replacement identity on the same computer: pause, stop, back up the entire private directory, and move `private-sync.json`, `sync-device.local.json`, `sync-credentials.local.json` **and its identity-bound `device-project-links.json`** into private backup, preserving authored records. Restart generates a new identity; prepare, authorize, login and review a new migration. Recreate directory associations for the new device. Old queue/conflicts remain in backup for review and must not auto-replay. Do not reset a revoked flag to hide replacement.

Unix credential files reject group/other access; Windows mode 0600 alone is insufficient, so use a private account directory and verify NTFS ACLs. Use device disk encryption and protect backups. TLS/access controls/local credential protection are **not end-to-end encryption**: the provider and authorized administrators can access cloud plaintext.

## Storage, backups and withdrawal

Default `backend/data/`, or an explicit private `WORKBENCH_DATA_DIR`:

| File/directory | Contents | Shared? |
| --- | --- | --- |
| `private-sync.json` | Device identity, approved scope, baselines, outbox, conflicts, sync time | No |
| `shared-projects.json` | Authored goal/decisions/progress/next step/repository | Whitelisted projections only |
| `device-project-links.json` | This identity's local code/tool links and check time | No |
| `sync-device.local.json`, `sync-credentials.local.json` | Device key preparation and login | No |
| `migration-backups/<transaction-hash>/` | Original four authored stores plus sync state/existence/hash manifest before approval | No |
| `sync-backups/<transaction-hash>/` | Original stores and per-storage-group download/merge checkpoints | No |

Backups can retain local settings and legacy chats for recovery; they are never uploaded. Automatic backup cleanup is not implemented, so they consume space until privately managed. Do not commit them or put them in public storage.

Withdraw access by pausing and using an administrator device to revoke. Neither deletes already uploaded records. To remove shared content, confirm the relevant record deletion/permanent deletion, sync it and verify other devices. Recovery follows existing 30-day trash; permanent deletion requires separately retained backup/manual recovery rather than automatic resurrection. Provider/local backups can retain historic content.

For local restoration, pause all devices, stop this service and preserve current files independently. Verify backup existence/SHA256 and restore only selected fixed files. Review sync state alongside the recovery point; do not restore an old baseline online and let it sync automatically. Start without cloud configuration, verify local content and then generate a fresh migration preview, treating later cloud edits as conflicts. Interrupted applies have safe retry checkpoints; new local edits reject overwrite rather than automatic rollback.

## Tools, projects and limits

Idea AI/automatic handoff is retired; empty private GitHub repository creation remains. Existing Codex/Claude installation/login is verified separately. Shared project context does not inherit another device's code/native chat; reviewed continuation offers existing context/entry points without native restoration. [Tool connections](development-tools.md) and [project resumption](project-resume.md) define those boundaries.

Git views distinguish local history, cached remote-tracking refs and explicit GitHub API reads. Unknown fetch time remains unknown; shallow history/pages are labeled. No hidden clone/fetch/checkout/commit/push occurs.

Synthetic tests cover two-device changes/deletes, offline/replay/conflicts, fresh empty devices and unexplained source loss, authentication/session/scope/revocation denials, field exclusions, recovery/expiry, original-resource preservation and tool/Git provenance. The reference local ledger is a test implementation, not a public server.

Remaining work: hosted creation/deployment/advisors and synthetic online checks; real Windows-to-Mac migration; attachment bytes; automatic cross-ID merge; automatic local-backup cleanup; native cross-device session restoration and model-access validation. Local test success does not mean cloud service or private sharing is live.
