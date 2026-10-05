# Development Security Standard

This standard applies to all DailyHouse development, releases and deployment changes. Contributors and coding agents must follow it together with [SECURITY.md](../SECURITY.md) and [AGENTS.md](../AGENTS.md). It records required behavior, not a claim that every proposed control already exists. Document unresolved gaps before shipping the affected capability.

## Deployment and ownership

- Local storage is the default. The current backend is a single-user, loopback-only service; its host and origin checks are not an internet authentication system. Do not expose it publicly or weaken those checks to enable remote access.
- Optional private cloud synchronization is limited to the owner's authorized devices. The local protocol and deployment migration exist; hosted creation/deployment and the first real upload still require separate approval and verified controls. Enforce the owner's account allowlist on the server, disable public registration, and protect the cloud administrator account with multi-factor authentication.
- Open-source users must be able to run locally or configure an independent backend under their own cloud account. Do not automatically connect their installation to the developer's personal database, storage or credentials. Using the same cloud provider does not require sharing the same application backend.
- A public service that hosts other people's data requires a separate owner decision and readiness review. Define account isolation, privacy and retention terms, support, operating costs, abuse limits, backups and incident response before opening registration. A login screen alone does not establish readiness.

## Data collection and synchronization

- Treat notes, tasks, reading records, attachments, calendar URLs, project paths and conversation content as private. State what each feature sends, where it sends it and why; make optional cloud synchronization an explicit choice.
- Start with the minimum necessary records and project summaries. Keep Codex/GitHub credentials, browser cookies and login state on their respective devices. Do not replicate local environment files, credential stores or raw diagnostic logs through synchronization.
- Full conversation content and attachments require a separately defined upload scope and explicit user authorization. Preserve legacy local handoff records and external resources; automatic inspiration handoff is retired, and historical authorization does not permit uploading conversations to a new cloud service.
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

<!-- private-release:start -->
## Repeatable public release workflow

This is a preparation standard. It defines future release gates; no release audit, filtering run or public synchronization is authorized merely by adding it. It is not evidence that DailyHouse has passed an audit. Release automation and its tools must be implemented and verified before use; do not advertise nonexistent `public:*` commands. Start a release only on an explicit owner request.

### Repository identity and isolation

The existing `AlexShen-Oguri/-DailyHouse` origin remains the development repository. Keep daily development on its `main` and preserve its history. Before first publication, verify its actual visibility and confirm the independent public destination with the owner; neither is established by this standard. Do not change repository visibility, recreate a repository or assume an existing development history is private.

Use one independently cloned public repository with its own Git storage and public commit ancestry. Create that public repository only once, if none exists and the owner explicitly authorizes creation. Reuse the same public identity, issues, stars, tags and releases for subsequent updates. Never merge, cherry-pick or push development ancestry into public, and never rewrite either published history to perform cleanup.

For the first public release, record an explicitly empty public baseline if no public commit exists. Prepare the initial candidate commit from sanitized files in independent Git storage and validate its fresh clone; do not invent a baseline commit or seed it with development history. Subsequent releases record the existing public `main` commit and append normal public commits.

For every release:

1. Preserve unrelated changes and commit the intended development version. Refresh the public baseline, then record the exact source commit and public commit (or the explicitly empty first-release baseline). Uncommitted or untracked development files are not release inputs.
2. Create a dedicated detached worktree from that fixed development commit. Use an owned temporary directory or an explicitly designated release directory; never reset a worktree containing new work. Development `main` may continue moving without changing this release snapshot.
3. Export the complete filtered filesystem state into an isolated candidate, record included/excluded files, public changes and file hashes, and reject symlinks, submodules, escaping paths and case collisions. This candidate includes no development `.git` objects or runtime records.
4. Run the selected gates below. A security or correctness fix belongs in development as a separate source change; then prepare a new candidate. Do not edit a sealed candidate to hide a finding. Publication-only cleanup stays in the candidate and is never merged wholesale into development `main`.
5. After the applicable gates pass, verify the candidate hash, clean public checkout and unchanged local/remote public baseline. Synchronize only the reviewed files, including approved deletions. Review the final public diff and whitespace, then create a normal public commit and push only when publication is authorized. A source synchronization does not authorize a tag, hosted deployment, binary release or personal-data upload.
6. Remove only the owned temporary worktree after checking it has no new commits or uncommitted work. Preserve or port any fixes first; do not force removal. Keep necessary redacted verification outputs in Git-ignored `.runtime/release/` or another explicitly ignored location. The next release starts a fresh fixed-version worktree; reuse the policy and public clone rather than a stale cleanup branch.

A worktree separates working directories, not Git history or secrets. Removing a file from a candidate does not remove it from previously published history. Unresolved exposure blocks publication; credential rotation/revocation and any history remediation require their own appropriate authorization.

### Files to publish and filter

The release exporter must use an explicit allowlist for maintained source, tests, production assets, launchers, configuration examples, current usage/security/recovery documentation, dependency lockfiles and licence/provenance inputs. DailyHouse's review boundary includes `backend`, `frontend`, the maintained scripts and launchers, `extensions/bilibili-reading`, and reviewed `supabase/migrations`. New roots or release tooling need an explicit policy decision before inclusion; a broad recursive copy or `.gitignore` alone is insufficient.

Apply exclusions before the allowlist:

- Exclude `AGENT.md` / `AGENTS.md` at every depth and in every filename case, along with agent-only Claude/Codex instructions, conversation/prompt dumps, handoffs, plans, acceptance reports and development diaries. A stale explicit allowlist must not override those exclusions.
- Exclude personal stores and copied attachments, `backend/data` contents, credentials and real owner/device configuration, browser/native-tool state, calendar subscriptions, original reports, private backups, machine paths and local environment files. Exclude `.runtime`, dependencies, caches, logs, generated shortcuts/LaunchAgents, build outputs and unrelated local research.
- Preserve only reviewed placeholder configuration examples and synthetic fixtures; `.env.example` is not safe merely because of its name. Keep the empty data-directory placeholder where installation needs it.
- Preserve original pixel-garden assets, fonts, third-party notices, artwork attribution and the exact generation prompts in `docs/artwork.md` and `docs/prompts`. They are maintained provenance inputs, not agent development instructions. Do not blanket-delete a directory because its name contains `prompts`, or remove product prompt templates required by an authorized feature.
- Strip private repository routing, machine-specific context, this marked workflow section and other explicitly marked private release instructions from public documentation. Remove links to excluded agent files without weakening ordinary public contributor/security guidance. Exclude private release tooling/configuration and its private-only commands from the public snapshot, while retaining tools and tests required to install, build and maintain the public product.

Every mode performs credential and private-data disclosure checks on the complete candidate, with a real secret scanner using its default rules and no repository suppression files. Review binary/image metadata and visible content separately; text scanners do not establish their privacy. Missing tools, incomplete output or scanner/network failure do not count as a pass. Filtering does not establish that application behavior is secure.

### Choose the release gate

| Mode | Eligible changes | Required gate |
| --- | --- | --- |
| Full release | First public release; broad changes; anything affecting a trust boundary; dependency/configuration changes; backend/domain logic, storage, imports, sync, launchers, extensions, permissions, migrations, CI or packaging; unexplained deletions | Complete filtering, automated checks and source-backed manual review |
| Small update | Subsequent, understood presentation/content changes with unchanged data flow and permissions: layouts, styles, translations, illustrations or public usage text | Complete snapshot filtering, disclosure checks and a reviewed public diff; no automatic full tests/build/audit claim |

Small mode is an exception to the normal application release-validation requirement, not an exemption from privacy checks. Presentation code that changes URLs, rich content, parsing, uploads, file handling or authority still requires full mode. Changes to source settings, calendar links, automation behavior, import/deletion/recovery, native-tool continuation, record projections, device/session scope, dependency locks or examples that alter deployment behavior require full mode even if their UI is small. Any unexplained difference or uncertain classification escalates to full mode.

Select mode from the complete filtered difference against the current public baseline, not a developer's task label or selected-file copy. A small UI task cannot publish accumulated backend or dependency changes through small mode. Confirm that the next public commit contains only the reviewed candidate.

### Full automated checks

Once a full release is requested, require complete reachable development/public branch and tag history; shallow or missing history blocks historical review. Scan both histories, candidate files, candidate public ancestry and distributed bundles/archives for exposed material. Use a fresh clone built only on public ancestry to prove the exact sanitized candidate installs and validates without private Git objects or ignored local inputs.

DailyHouse currently uses two npm packages and Node.js 24; do not copy Glass Notes' Tauri/Rust gates into this project. Future automation must capture exit codes and complete redacted logs for these existing commands, run from the clean candidate root:

```sh
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix backend audit --audit-level=high --json
npm --prefix frontend audit --audit-level=high --json
npm --prefix backend test
npm --prefix backend run build
npm --prefix frontend test
npm --prefix frontend run build
node --test scripts/reading-import.test.mjs scripts/journal-sync.test.mjs scripts/macos-workbench.test.mjs scripts/macos-daily-reading.test.mjs
```

Review every advisory severity and supply-chain/install-script change. Unresolved high/critical advisories block; lower-severity findings also need a documented reachability/remediation decision. Preserve raw reports. Tool/network/test/build failures block. No missing dependency exception is inherited from Glass Notes: its `braces` / `node-forge` backport recognition is project-specific. A DailyHouse source backport needs explicit owner approval, upstream/licence provenance, pinned complete source hashes and versions, verified installed copies/calling scope, exploit regression plus normal-behavior tests, and rejection of unknown or changed findings before it can satisfy the gate. Do not rename a dependency, silently ignore findings or force an unreviewed downgrade.

Use synthetic records, a new isolated data directory, fixture connectors and supported test configuration. Never start release validation against the owner's default data, native conversations, credentials or existing service; never enable collection/login startup or make real external writes as a side effect. Validate Windows and macOS launcher/install/upgrade/stop ownership when those paths change, including Unicode/spaced paths, occupied ports, data preservation and checkout-owned shortcut/LaunchAgent removal. State unavailable host checks and unresolved relevant failures; one platform's local build does not prove another platform's installation.

Any new stack, command, test fixture or release output must be added to the maintained gate policy. Do not claim a lint, hosted cloud, physical-device or platform-installation check that was not run. Local PGlite tests do not prove hosted Supabase acceptance. Keep existing resource-creation, deployment and first real-upload approvals separate; source publication does not relax them.

### Full source-backed review

After automated checks pass, review the actual fixed candidate and record concise evidence, reviewer identity, source/public commits, candidate hashes and blockers for each applicable area in ignored release outputs. Pending, failed or unknown is not passed; not-applicable needs a concrete scope explanation. Reuse earlier evidence only for verified unchanged inputs and state its limits.

| Area | DailyHouse-specific review |
| --- | --- |
| Public diff and inventory | Confirm all changes/exclusions, maintained fixtures and dynamic references; establish evidence before deleting supposedly dead code or dependencies. |
| Credentials and history | Inspect redacted scans, placeholders and historical branches/tags; distinguish deletion from remediation and request necessary credential rotation safely. |
| Privacy and media | Personal records, journals, calendars, original/copied documents, native chats, local project paths, screenshots and image metadata; preserve public attribution and safe artwork provenance. |
| Local API and untrusted input | Loopback binding, Host/Origin checks, request/schema/size bounds, file/URL/calendar/import parsing, traversal, HTML rendering and command execution boundaries. |
| Storage, backup and deletion | Migrations, interrupted writes/restores, managed-file ownership, 30-day recovery, permanent deletion, suppression and preservation of originals/external resources. |
| Private sync and permissions | Explicit field projections/upload approval, owner identity and session checks, least grants/RLS, RPC/search-path/privilege boundaries, device scopes/revocation, conflict/idempotent retry and no stale-device resurrection. Preserve unconfigured/local defaults and independent user deployments. |
| Tools, extension and automation | Verified read-only native-tool access, no implicit conversation/command dispatch, browser-origin/pairing boundaries, revoked access, bounded collection admission and no upload of cookies/credential stores. |
| Dependencies and install inputs | Both manifests/locks, actual advisories and consumers, official/checksummed runtime downloads, lifecycle scripts and absence of personal data in exported bundles. |
| CI, release and launchers | Pinned actions/minimal permissions if introduced, untrusted event handling, verification before uploads, Windows/macOS lifecycle isolation and no unrelated process/file deletion. |
| Docs, licences and product scope | Implemented behavior versus proposals, privacy/deployment limits, original licence/artwork/font records, exact required prompts and current installer/recovery instructions. |
| Interface acceptance | Chinese/English, day/night identity, phone/desktop widths, keyboard access, reduced motion and affected create/edit/delete/recovery flows with isolated fixture data. |
| Platform/deployment acceptance | Relevant Windows/macOS install/upgrade and hosted synthetic checks when separately authorized; explain scope-based non-applicability for source-only updates. Never present unperformed installation or private sharing as live. |

Unresolved credential/privacy exposure, plausible exploitable findings or relevant correctness/data-loss failures block the candidate. Describe uncertainty and actual coverage; passing commands or partial static review is not a complete security certification. Do not turn an unverified assumption into a suppression or claim production readiness.

### Verification of future release tooling

Before relying on an exporter or publisher, verify empty-baseline first releases and reuse of the same public repository on subsequent updates, root/nested/case-variant agent exclusion even under a stale allowlist, retained artwork prompts/licences/synthetic fixtures, fixed-commit export, required-input failures, disclosure redaction, unsafe paths/symlinks, approved deletions, mode escalation, candidate tampering, dirty or advanced public baselines, independent public ancestry, audit/tool failures and refusal to sync without complete manual evidence. Cleanup must refuse a worktree containing new work. Test fixtures establish orchestration behavior; real scanners and clean-install/build/source reviews remain separate release gates.
<!-- private-release:end -->
