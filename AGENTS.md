# DailyHouse working agreement

This directory is the source repository for the user's Windows personal workbench.
Remote: https://github.com/AlexShen-Oguri/-DailyHouse.git, branch main.

- The initial commit records the user-approved baseline. Preserve its history.
- For every completed change, run the checks appropriate to its behavior, then create a descriptive commit. Keep distinct features and follow-up fixes in separate commits; document relevant validation in commit bodies.
- Push completed commits to origin/main as part of the task. The user has explicitly authorized ongoing commit-and-sync work for this repository. Never force-push or rewrite published commits. Fetch and reconcile remote changes first when necessary.
- Do not commit personal data, account credentials, reports, local notes, browser state, screenshots, logs, generated build output, or .runtime backups. Keep them excluded by .gitignore.
- Preserve the pixel garden visual identity. Day and night modes, Chinese and English, keyboard access, reduced motion and responsive layouts are part of the product contract.
- Use backend and frontend npm test / npm run build for relevant source changes. Exercise changed user flows in a browser when appropriate, with fixture data isolated from the user's data.
- A source connection is connected only when verified; do not fabricate bank balances, sync success, reports or task progress.
- Do not implement proposed features until the user chooses them. Currently the reading shelf is authorized; project-resume and learning-progress modules remain proposals.
