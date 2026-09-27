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
- Every new feature that lets the user create an item must also provide a discoverable deletion option for that item. Explain the deletion scope, confirm destructive removal, preserve unrelated records, and verify deletion as part of the feature. This applies to nested records such as timeline updates as well as their parent items.
- Do not implement proposed features until the user chooses them. Reading-shelf phase one, daily 09:45 New York conditional collection, Google/Apple read-only calendars, and a unified inspiration library are authorized. The inspiration library shares one canonical Idea identity and timeline across list, bubbles, fusion and local AI drafts; confirmed ideas can become projects and their next step can enter existing todos. See docs/reading-import.md, docs/daily-collection.md, docs/ideas.md and docs/local-ai.md. Do not create parallel fragment/idea stores or restore an AI prompt-generation tool. The user explicitly authorized coordination with the other workflow task to combine these features and local model download/runtime installation. A cross-source inbox/control center, Obsidian writes and Git-based project resume remain proposals. The user cancelled the learning-progress card and desktop scavenging; do not reintroduce them.
