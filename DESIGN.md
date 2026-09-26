---
name: 日常小院
description: 原创像素田园个人工作台
colors:
  primary: "#47704e"
  primary-deep: "#304e37"
  ground: "#edf0d8"
  paper: "#fff8e5"
  ink: "#423b2b"
  muted: "#73694d"
  home-muted: "#675d43"
  line: "#b8ad7b"
  wood: "#a97543"
  navigation-wood: "#8c623d"
  notice-paper: "#eee5bb"
  danger: "#9c4535"
typography:
  headline:
    fontFamily: '"LShu Pixel", "Microsoft YaHei", sans-serif'
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1.2
  title:
    fontFamily: '"LShu Pixel", "Microsoft YaHei", sans-serif'
    fontSize: "23px"
    fontWeight: 400
    lineHeight: 1.45
  body:
    fontFamily: '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif'
    fontSize: "14px"
    lineHeight: 1.65
  label:
    fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif'
    fontSize: "12px"
    lineHeight: 1.7
rounded:
  control: "3px"
  surface: "4px"
  home-control: "2px"
spacing:
  xs: "4px"
  sm: "8px"
  compact: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  section: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "9px 15px"
    height: "44px"
  button-secondary:
    backgroundColor: "#f2dfac"
    textColor: "#584228"
    rounded: "{rounded.home-control}"
    padding: "10px 17px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "#5e4b30"
    rounded: "{rounded.control}"
    padding: "9px 15px"
  input:
    backgroundColor: "#fffdf2"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
  navigation:
    backgroundColor: "{colors.navigation-wood}"
    textColor: "{colors.paper}"
  paper:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "24px"
  badge:
    backgroundColor: "#f0edd5"
    textColor: "#65593d"
    padding: "2px 8px"
---

# Design System: 日常小院

## Overview

**Creative North Star: "田园工作桌"**

用户明确选择类似星露谷物语氛围的像素卡通风格。本次重设计使用原创田园风景、木色工具导航、草木绿选择态和奶油纸面；标题保留像素趣味，业务正文保持清晰。该主题服务于真实待办与资料管理，不引入虚构金币、等级或游戏任务。

**Key Characteristics:**

- 原创像素田园场景与克制的纸张层次。
- 横向工具导航与清晰中文业务标签。
- 像素标题配中文系统正文，状态文字真实可核对。

旧设计保存在 `docs/design-original.md`，不再指导当前界面。实际样式来源为 `frontend/src/styles/tokens.css`、`garden.css` 与 `garden-home.css`；`global.css` 只保留基础排版；个人功能样式来自 `personal.css`，材质与动画来自 `garden-details.css`。

## Colors

草绿色用于主要操作、当前导航与可用状态；木棕用于顶部工具条和次要按钮；奶油纸面与浅绿色地面区分内容和环境。棕墨色为主文字，首页便笺弱文字采用 home-muted 以确保小字对比度。错误使用 danger，并辅以明确文字。

兼容变量 ui-orange 映射为草绿，ui-yellow 映射为浅草色；不要根据旧变量名恢复橙黄色设计。木纹与纸纹来自低对比的本地原创 SVG，正文区域不铺高反差图案。

## Typography

本地 Fusion Pixel 字体的内部 CSS 名称仍为 LShu Pixel，授权见字体目录 OFL.txt。用于品牌、标题与导航，正文使用 Microsoft YaHei / PingFang SC 系统字族。

普通页面标题为 32px；首页问候在 25–36px 之间，移动端 25px。首页模块标题桌面 23px、移动端约 20–21px。正文通常为 13–14px，首页辅助文字至少 12px；窄屏壳层副标题、连接提示和页脚为 11px 元信息。数字统计使用表格数字特性。

## Layout

全局容器最大宽度 1344px，桌面内边距 32px，对应内容宽度最大 1280px。导航置顶，五个页面保持清晰入口（首页、待办、Obsidian、Chase、设置）；窄屏横向滚动导航而非挤压标签。

首页呈现田园横幅、园丁植物与问候，再展示手动待办、来源便笺和日历摘要。主工作区桌面为约 1.8:1 两列；720px 以下单列。700px 以下壳层内边距 16px。待办来源区域在1000px以下单列，Obsidian书屋在720px以下改为上下布局。

## Elevation & Depth

层次主要来自纸面色差、1–2px 棕色边框和浅色内描边。木导航顶底边表达板材；按钮底边和内阴影表达按压。纸面轻投影为 `0 4px 12px #61522c0b`。不使用悬浮玻璃或发光背景。

## Shapes

采用方正像素感；共享纸面最多 4px 小圆角，共享控件 3px、首页控件 2px。导航采用 GardenGlyph 原创两像素网格图标，业务控件使用 Pixelarticons。首页插画使用本地原创 PNG，采用 pixelated 渲染；不复制游戏人物、界面或截图。

## Components

- **Buttons:** 绿色主操作、麦色次操作、透明次要操作。共享按钮最小高度 44px，悬停改变背景，按下位移 1px，禁用保留可辨识文字。
- **Inputs:** 浅纸底、细棕框、3px 小圆角；焦点有 3px 绿色轮廓。复选框采用草绿选中态。
- **Navigation:** 木色横向工具条，浅绿当前页，由 NavLink 的真实路由决定；图标始终有文字标签。
- **Paper:** 共享模块为奶油纸面，标题区为稍深纸色；首页计划与便笺使用不同纸色和虚线分隔。
- **Badges:** 未连接与待确认均显示中性标签；真实失败单独使用错误文字与颜色。
- **Data states:** 读取中、未导入、未连接、失败、已有数据分别处理。没有数据时用占位与配置入口，不展示虚构统计或任务。
- **Motion:** 导航颜色过渡 150ms。原创园丁以22秒步进轻移，伴随微小步幅，植物静态、蝴蝶轻动；支持首页暂停、设置总开关、离屏和后台暂停。尊重 prefers-reduced-motion；不延迟显示内容。

## Do's and Don'ts

### Do:

- Do 使用已定义的草绿、木棕、奶油纸面与像素标题。
- Do 保留明确中文功能名、键盘焦点和真实状态说明。
- Do 将新页面适配桌面和窄屏，并验证可读性。

### Don't:

- Don't 恢复原版黑白橙黄、个人头像或装饰编号。
- Don't 在来源未配置时承诺已经连接或显示虚构账户数据。手动待办始终可用。
- Don't 将图片中的装饰当成可点击控件。

原创图片与完整提示词见 `docs/garden-art-provenance.md` 和 `docs/garden-details-provenance.md`。本次重构保留主体风格，移除原运营功能。
