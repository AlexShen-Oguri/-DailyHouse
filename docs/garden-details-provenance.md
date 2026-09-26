# 小院细节与桌面入口

这次调整延续已选定的奶油纸面、草绿色与木棕色像素田园主题。

- `frontend/public/images/garden-keeper.png`：使用内置 ImageGen 工具生成的原创园丁，原始文件位于 `C:\Users\AlexS\.codex\generated_images\01a0dfa2-90db-7a50-a555-d03190647071\exec-ff3353ed-936b-4342-a9f2-002512bc5804.png`。原生透明 PNG，1131 × 1391，alpha 范围 0–255。完整原始提示词在 `garden-keeper-prompt.txt`，同时写入 PNG 元数据。该角色仅作为装饰，动画由 CSS 完成，没有游戏数据或虚构工作状态。
- `frontend/public/images/garden-woodgrain.svg`：原创几何木纹，低透明度浅色与深色细线，背景基色不变。
- `frontend/public/images/garden-papergrain.svg`：原创稀疏纸纤维点纹，不覆盖或替代正文。
- `frontend/src/components/GardenLife.tsx`：自绘两像素网格导航图标与盆栽图形；装饰对辅助技术隐藏。动态支持手动暂停、系统减少动态效果、离屏暂停、后台页面暂停。
- `assets/garden-launcher.svg`：原创 64 单位像素小屋与盆栽图标。PNG 是通过 Sharp 对 SVG 的确定性导出；ICO 是同一图标的 16、24、32、48、64、128、256 像素格式导出。
- `scripts/Install-DesktopShortcut.ps1`：在 Windows 桌面放置 `启动日常小院.cmd` 与使用上述图标的 `日常小院.lnk`。快捷方式以最小化窗口调用 CMD，工作台后台进程继续由现有启动脚本隐藏运行。不会覆盖同名未知文件。

Windows 为 `.cmd` 文件使用文件类型图标；独立应用图标由旁边的 `.lnk` 快捷方式提供。两者启动相同工作台。
