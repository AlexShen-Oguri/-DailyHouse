# Contributing

## Development setup

1. Install Node.js 24. On Mac, `./Install.command` can install a project-local runtime automatically.
2. Run `npm ci` in `backend` and `frontend`, or on Mac use `./Install.command` to install and build both.
3. Start the backend with `cd backend && npm run dev`.
4. In another terminal run `cd frontend && npm run dev`.

The development frontend uses port 3456 as its API proxy by default. For the project-local Mac runtime, first run `export PATH="$PWD/.runtime/node/bin:$PATH"` from the repository root in each terminal.

## Required checks

```bash
cd backend && npm test && npm run build
cd ../frontend && npm test && npm run build
cd .. && node --test scripts/reading-import.test.mjs scripts/journal-sync.test.mjs scripts/macos-workbench.test.mjs scripts/macos-daily-reading.test.mjs
```

Do not commit local databases, credentials, logs, screenshots with real content or personal absolute paths. Tests and documentation must use synthetic identities and records.

Documentation-only changes require relative-link, referenced-path and behavior consistency checks. Keep current usage, recovery, security and artwork provenance; do not add development transcripts, handoff reports or snapshot test counts to the permanent docs. Write maintained documentation in English. Keep exact UI labels, source filename patterns and original artwork prompts when they are needed to identify or reproduce behavior.

Follow [SECURITY.md](SECURITY.md), the [Development Security Standard](docs/development-security.md) and [AGENTS.md](AGENTS.md). Each completed change needs a descriptive commit with relevant validation in its body, followed by a push to `origin/main`; preserve the approved baseline and published history.

<!-- private-release:start -->
## Public release preparation

Use the [repeatable public release workflow](docs/development-security.md#repeatable-public-release-workflow): full releases require filtering, automated gates and source-backed review; small updates still require complete snapshot filtering and disclosure checks. Both prepare a fixed version in an independent worktree and synchronize reviewed files to the designated public repository without development ancestry. The standard is preparatory; release tooling and a public destination must be established before it can run. Documentation changes alone do not initiate an audit or publication.
<!-- private-release:end -->

## Product constraints

- Keep external writes disabled by default.
- Do not weaken the `127.0.0.1` binding.
- New connectors must be opt-in and degrade honestly when unavailable.
- UI changes should follow `DESIGN.md` and preserve keyboard/reduced-motion behavior.
- Schema changes require migration and regression tests.
- Every feature that creates records also needs discoverable, scoped deletion, including nested records. Verify recovery and external-resource preservation where applicable.
