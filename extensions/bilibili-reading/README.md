# DailyHouse · B站一键读取

此文件夹可在 Edge/Chrome 扩展管理页通过「加载解压缩的扩展」安装。需 Chromium 120+，保持本机小院 `http://127.0.0.1:3456` 运行。

安装后，从书架按「一键读取」。扩展约每 30 秒检查用户发起的任务，只读取 B 站历史页的可见信息。浏览器休眠时会延迟。不读取 Cookie，不使用私人历史 API，不自动开始新的采集，不访问其他网站。

完整安装、权限和生命周期说明见 [reading-collection.md](../../docs/reading-collection.md)。`identity.json` 和 manifest 中的 key 是公开的扩展标识公钥，不是账户凭据；私钥没有保存。更新代码后在扩展管理页重新加载。

## English

Load this folder as an unpacked extension in Edge or Chrome (Chromium 120+). Keep DailyHouse running at `http://127.0.0.1:3456` and sign in to Bilibili in the same browser.

Click **One-click read** on the shelf. The extension checks for user-requested jobs approximately every 30 seconds and reads rendered Bilibili history cards. It does not read cookies, browser history, private APIs, or other websites. Sleeping browsers can delay a job. Disable or remove the extension to disconnect it.
