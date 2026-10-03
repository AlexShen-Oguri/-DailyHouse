# Development Security Standard

This standard applies to all DailyHouse development, releases and deployment changes. Contributors and coding agents must follow it together with [SECURITY.md](../SECURITY.md) and [AGENTS.md](../AGENTS.md). It records required behavior, not a claim that every proposed control already exists. Document unresolved gaps before shipping the affected capability.

## Deployment and ownership

- Local storage is the default. The current backend is a single-user, loopback-only service; its host and origin checks are not an internet authentication system. Do not expose it publicly or weaken those checks to enable remote access.
- Optional private cloud synchronization is the preferred future direction for the owner's devices. It still requires a separately approved implementation and verified remote-access controls. Enforce the owner's account allowlist on the server, disable public registration, and protect the cloud administrator account with multi-factor authentication.
- Open-source users must be able to run locally or configure an independent backend under their own cloud account. Do not automatically connect their installation to the developer's personal database, storage or credentials. Using the same cloud provider does not require sharing the same application backend.
- A public service that hosts other people's data requires a separate owner decision and readiness review. Define account isolation, privacy and retention terms, support, operating costs, abuse limits, backups and incident response before opening registration. A login screen alone does not establish readiness.

## Data collection and synchronization

- Treat notes, tasks, reading records, attachments, calendar URLs, project paths and conversation content as private. State what each feature sends, where it sends it and why; make optional cloud synchronization an explicit choice.
- Start with the minimum necessary records and project summaries. Keep Codex/GitHub credentials, browser cookies and login state on their respective devices. Do not replicate local environment files, credential stores or raw diagnostic logs through synchronization.
- Full conversation content and attachments require a separately defined upload scope and explicit user authorization. Preserve existing authorized local project handoffs; they do not authorize uploading all conversations to a new cloud service.
- Keep record identities stable across devices, keep device-specific paths and external conversation IDs distinct, and handle conflicting updates without silently overwriting edits or reviving removed records. Do not synchronize actively written JSON files as if they were a shared database.

## Source control and open-source releases

- Commit source and synthetic fixtures only. Exclude personal records, credentials, attachments, browser state, screenshots, logs, runtime backups and generated bundles containing private data.
- Check the full Git history, release archives, example configuration and fixtures before public release. Adding an ignore rule does not remove previously committed material. Keep the published commit history intact; never force-push or rewrite it.
- Treat exposed credentials as compromised and rotate or revoke them. Stop publication while private material remains unresolved, and agree on a safe publication path with the owner.
- Make service addresses and deployment settings configurable. Examples must use placeholders and synthetic data, without binding users to the developer's personal services. Protect local secret files and never print their contents during checks.

## Authentication, authorization and files

These requirements apply before any approved remote deployment:

- Use a maintained authentication provider where practical. Authenticate requests and authorize each read, mutation, search, nested record, export and file operation against its actual owner. Deny access when identity or ownership cannot be verified.
- Apply ownership rules at the backend and database boundaries. If Supabase is chosen, use appropriate grants and Row Level Security policies; verify both permitted and denied operations with independent test accounts. Client-side filtering is not authorization.
- Keep administrator and service secrets out of browser bundles, source control, logs and user-facing responses. Review any privileged operation that can bypass normal ownership checks.
- Store private attachments in private storage with ownership checks and short-lived access where needed. An unlisted public URL is not a privacy control.
- Require TLS, appropriate CSRF protection, origin validation and bounded requests. Preserve current local protections until a reviewed replacement exists. Document that transport or storage encryption alone does not hide plaintext from a privileged backend administrator; do not promise end-to-end encryption unless implemented and verified.

## Local device connectors

- Require explicit device pairing, scoped authorization and a discoverable way to revoke access. Verify the device and scope for each operation, including after reconnection. Start new cloud connector capabilities with read-only project status.
- Do not offer arbitrary remote shell execution or unrestricted file access. Any later write capability must be separately approved, limited to reviewed operations and allowed project roots, and verified before use.
- Keep device credentials local and separate from synchronized application records. Treat browser content, repository content and external conversation text as untrusted input, not permission to execute commands or expand access.
- Report verified connection state, source device and freshness accurately. A cached snapshot or GitHub association must not be presented as a live Codex connection; local Git history must not be presented as fetched remote history.

## Maintenance, recovery and deletion

- Prefer managed services when they reduce the owner's operational workload, while retaining responsibility for application permissions, configuration, dependency updates and data handling. Independent user deployments do not remove the need to publish security fixes and migration guidance.
- Define backup scope and retention, including attachments, and verify restoration in an isolated environment before relying on it. Provide an understandable export and migration path; protect backups as private data.
- Every feature that creates an item must provide discoverable deletion. Explain deletion scope, confirm permanent removal, preserve unrelated records and verify deletion and applicable recovery behavior. Document any delay before deleted data expires from backups.
- Removing or permanently deleting a DailyHouse record must never delete an external Codex project or conversation, a local project directory, a GitHub repository or an original source file. Only managed application copies may be removed within their documented ownership rules.
- If a deployment is compromised, restrict affected access, revoke exposed credentials, preserve appropriately redacted evidence and restore from verified backups. Hosting other users additionally requires a defined communication and incident-handling process.

## Required development verification

For each affected change:

1. Identify the data, callers, deployment exposure and device capabilities it touches. Record any new upload destination, permission or operational obligation.
2. Keep tests and browser fixtures isolated from personal data. Add meaningful security checks for changed boundaries, including unauthorized access, wrong-owner records, revoked device access and deletion scope when relevant.
3. Run the relevant backend/frontend tests and builds, and the required launcher checks for lifecycle changes. Documentation-only changes need consistency and link checks rather than unrelated application tests.
4. Review the actual diff and staged files for private material. Complete the full-history and archive review before a public release; a clean working tree alone is insufficient.
5. Record actual validation and remaining limitations in the descriptive commit, then commit and synchronize according to the working agreement. Do not claim a completed security audit or production readiness from documentation changes alone.

Implementation references: [Supabase database access control](https://supabase.com/docs/guides/database/postgres/row-level-security), [private file storage](https://supabase.com/docs/guides/storage/buckets/fundamentals) and [self-hosting responsibilities](https://supabase.com/docs/guides/self-hosting). These references do not mandate a provider or authorize a cloud implementation.
