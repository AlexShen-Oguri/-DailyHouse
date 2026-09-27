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
- Do not implement proposed features until the user chooses them. The reading shelf and the student workflow described in docs/student-workflow.md are authorized, including local capture, organization, prompt generation, manual reading imports and linked next-action todos. Model API calls, external-history imports, project-directory/Git resume, generic recycling and background scheduling remain proposals in docs/daily-automation-proposal.md. The user cancelled the learning-progress card and desktop scavenging; do not reintroduce them.
