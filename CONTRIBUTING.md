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
cd .. && node --test scripts/reading-import.test.mjs scripts/macos-workbench.test.mjs
```

Do not commit local databases, credentials, logs, screenshots with real content or personal absolute paths. Tests and documentation must use synthetic identities and records.

## Product constraints

- Keep external writes disabled by default.
- Do not weaken the `127.0.0.1` binding.
- New connectors must be opt-in and degrade honestly when unavailable.
- UI changes should follow `DESIGN.md` and preserve keyboard/reduced-motion behavior.
- Schema changes require migration and regression tests.
