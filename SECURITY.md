# Security policy

## Supported version

Security fixes currently target the latest `0.1.x` release.

## Local-only boundary

The backend binds to `127.0.0.1`. Do not expose it through a public reverse proxy or change it to `0.0.0.0`: v0.1 has no remote user authentication or production remote-access controls. Existing host and origin checks protect the local boundary but do not replace a reviewed remote security model.

## Reporting a vulnerability

Please open a private GitHub security advisory in the repository that publishes this package. Do not include real tokens, chat messages, calendar titles, financial records or absolute local paths in a public issue. A useful report includes the affected version, reproducible steps using synthetic data, impact and a suggested mitigation.

## Credential handling

- Keep local application secrets in `backend/.env.local` with mode `0600`; keep external Codex/GitHub credentials in their own device-local credential stores. Do not copy them into synchronized application data.
- Never commit `.env.local`, `backend/data`, logs or generated archives containing runtime data.
- Rotate any credential that was pasted into an issue, log or commit.
- Review the full Git history, example configuration, fixtures and release archives for private material before public release. Ignore rules and a clean working tree are insufficient; follow the release checks in the [Development Security Standard](docs/development-security.md).

## Development security requirements

All contributions must follow the [Development Security Standard](docs/development-security.md). Local storage remains the default. An optional private cloud is a future design direction, not an implemented or approved public deployment. Open-source installations must not silently connect to the developer's personal backend; other users keep their data locally or in their own independent cloud deployment.

Any approved remote implementation must enforce authenticated ownership checks for records and private files, keep privileged secrets on the server, minimize explicitly authorized uploads, and require scoped, revocable device pairing. Public multi-user hosting requires a separate owner decision and operational readiness review. Cloud administrator access is not end-to-end encryption.

Deletion must stay within DailyHouse's managed records and copies. It must never remove external Codex projects or conversations, local project directories, GitHub repositories or original source files. Security validation must cover changed trust boundaries using synthetic data; this policy is not evidence that a security audit has passed.

## Remote access

Adding remote access requires authentication, authorization, TLS, CSRF protection, origin validation, audit logs and a new threat model. It is out of scope for v0.1.
