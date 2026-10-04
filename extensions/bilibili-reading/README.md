# DailyHouse Bilibili collection extension

Load this folder as an unpacked extension in Chrome or Edge (Chromium 120+). Keep DailyHouse running at `http://127.0.0.1:3456` and sign in to Bilibili in the same browser profile. Windows and macOS use the same extension; each device/profile needs its own installation and login.

On Mac, press `Command + Shift + G` in the folder picker, paste the local path shown under the shelf's Browser connection and select the folder containing `manifest.json`. Do not copy another computer's path. After source updates, reload the existing extension card; reinstalling is unnecessary.

Click **One-click read** on the shelf. The extension checks for requested jobs about every 30 seconds and reads rendered Bilibili history cards. Browser sleep can delay a job. It does not read cookies or general browser history, use private APIs, access unrelated sites or initiate collection by itself. Disable/remove it to disconnect; shelf entries and external conversations remain.

See [browser collection](../../docs/reading-collection.md) for setup, selection, visibility, permissions and lifecycle, and [daily collection](../../docs/daily-collection.md) for schedule admission. `identity.json` and the manifest key are public extension identity material, not account credentials; no private signing key is stored.
