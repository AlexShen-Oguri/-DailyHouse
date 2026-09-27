---
name: 日常小院
description: 支持中英双语与日夜切换的原创像素田园个人工作台
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
  night-ground: "#101a2d"
  night-paper: "#1d2c35"
  night-ink: "#eee5ca"
  night-muted: "#bdc5b3"
  night-heading: "#e1d5ab"
  night-accent: "#accb9c"
  night-line: "#657974"
  night-navigation: "#3a2e29"
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

用户明确选择类似星露谷物语氛围的像素卡通风格。使用原创田园风景、木色工具导航、草木绿选择态和奶油纸面；夜间保留同一座小院的构图，以深蓝、暗木与暖窗灯转换环境。标题保留像素趣味，业务正文保持清晰。该主题服务于真实待办、阅读与资料管理，不引入虚构金币、等级或游戏任务。

**Key Characteristics:**

- 原创像素田园日夜场景与克制的纸张层次。
- 横向工具导航、中文 / English 标签和独立的主题切换。
- 像素标题配可读的系统正文，状态文字真实可核对。

旧设计保存在 `docs/design-original.md`，不再指导当前界面。实际样式来源为 `frontend/src/styles/tokens.css`、`garden.css` 与 `garden-home.css`；`global.css` 只保留基础排版；个人功能样式来自 `personal.css`，书架来自 `reading.css`，偏好控件来自 `preferences.css`，材质与动画来自 `garden-details.css`，夜间材质、场景和主题切换来自最后加载的 `night-garden.css`。

## Colors

草绿色用于主要操作、当前导航与可用状态；木棕用于顶部工具条和次要按钮；奶油纸面与浅绿色地面区分内容和环境。棕墨色为主文字，首页便笺弱文字采用 home-muted 以确保小字对比度。错误使用 danger，并辅以明确文字。

兼容变量 ui-orange 映射为草绿，ui-yellow 映射为浅草色；不要根据旧变量名恢复橙黄色设计。木纹与纸纹来自低对比的本地原创 SVG，正文区域不铺高反差图案。

夜间通过 `html[data-theme='night']` 覆盖语义变量：背景 night-ground、纸面 night-paper、正文 night-ink、弱文字 night-muted、标题 night-heading。导航采用深木色 night-navigation，链接采用 night-accent，主操作保留较深绿色底以保证浅色文字可读。书架使用 `--shelf-surface`、`--shelf-raised` 与 `--shelf-line` 跟随主题。夜间正文 / 纸面对比度为 11.40:1，弱文字为 8.06:1，主按钮悬停文字为 5.06:1。

## Typography

本地 Fusion Pixel 字体的内部 CSS 名称仍为 LShu Pixel，授权见字体目录 OFL.txt。用于品牌、标题与导航，正文使用 Microsoft YaHei / PingFang SC / system-ui 字族。中英模式共用字号层级；英文标题允许自然换行，不通过缩小整页来容纳文案。界面日期按当前语言格式化，用户内容保留原文。

普通页面标题为 32px，紧凑书架标题为 29px；首页问候在 25–36px 之间，移动端 25px。首页模块标题桌面 23px、移动端约 20–21px。正文通常为 13–14px，首页辅助文字至少 12px；窄屏壳层副标题、连接提示和页脚为 11px 元信息。数字统计使用表格数字特性。

## Layout

全局容器最大宽度 1344px，桌面内边距 32px，对应内容宽度最大 1280px。导航置顶，六个页面保持清晰入口（首页、待办、待读书架、Obsidian、Chase、设置）；窄屏横向滚动导航而非挤压标签。语言与日夜开关位于页顶，移动端可以独立换行。

首页呈现田园横幅、园丁植物与问候，再展示手动待办、来源便笺和日历摘要。主工作区桌面为约 1.8:1 两列；720px 以下单列。700px 以下壳层内边距 16px。待办的日历来源区域为通栏，Obsidian书屋在720px以下改为上下布局。桌面拾遗入口与区块已移除。

待读书架采用紧凑列表，取消顶部大幅日报来信。标题后先放「未完成」「已完成」两个带真实数量的主按钮，导入与记录、回收站为次入口；随后是一排全部、书籍、视频、课程 / 教程、GitHub、文章、科技早报、审美图鉴八个紧凑类型块。窄屏横向滚动类型块，不挤压成难辨标签。搜索、主题分类和进行状态位于列表前的次层；日报来源目录折叠在列表后。新增和编辑在页内展开，保持列表上下文；窄屏将行内状态控件移到正文下方。

有来源封面的视频在正文右侧呈现 16:9 缩略图，使用语义色细框与木色台阶投影；窄屏移至文字上方。封面保留原图颜色，不叠加影响识别的像素滤镜；图片失败时回到原有书签和文字行，标题与操作仍完整可用。图片懒加载，不新增装饰动画。

书架默认呈现未完成内容，完成记录在「已完成」主入口回看。行内主题徽标与可编辑分类使用编程、AI、设计、自然科学、人文社科、语言、效率 / 职业、生活技能、其他 / 待分类九类；媒介类型与主题不混用。完成日期只有真实可用时才显示，不提供尚未实现的日期筛选。

筛选下方提供批量移除与全部移除；多选时显示复选框、当前列表全选和数量，切换筛选清空选择。页内确认列出范围与标题，说明进入 30 天回收站、原始文件保留和来源不会自动重入。回收站支持搜索、单项或批量恢复，显示移出时间与恢复期限，到期不可恢复且没有永久删除按钮。失败保留选择便于重试；取消、完成和恢复后返回可用的键盘焦点。移除按钮采用日夜均可读的砖红色，窄屏操作区自然换行。

「导入与记录」在同一书架内展开：选择本机 JSON 后先展示逐项理由、分类、实际覆盖范围和计数，不立即写入。待确认项可显式接受，候选可排除；选择变化时禁用提交，先重新预览。批次日志保留结果与待确认项，支持重新审阅和单独确认撤销；撤销结果分别说明撤回、后续编辑冲突及已不存在的数量。导入失败保留预览以便重试，不用成功样式掩盖部分或不完整历史。

手动完成成功保存后，书签里的像素勾选用 300ms 步进显现，停留至 600ms 后开始淡出，最后收拢行间空间，整体约 1.3 秒。不在请求成功前播放。关闭动态效果时仅保留短暂勾选和温和透明度反馈；后台计时兜底避免条目卡在动画状态。

## Elevation & Depth

层次主要来自纸面色差、1–2px 边框和浅色内描边。木导航顶底边表达板材；按钮底边和内阴影表达按压。日间纸面轻投影为 `0 4px 12px #61522c0b`。夜间使用冷暖相邻的深色纸面区分层次，暖光集中在横幅的窗灯与少量萤火虫，不以整页发光或悬浮玻璃取代清晰结构。

## Shapes

采用方正像素感；共享纸面最多 4px 小圆角，共享控件 3px、首页控件 2px。导航采用 GardenGlyph 原创两像素网格图标，业务控件使用 Pixelarticons。首页插画使用本地原创 PNG，采用 pixelated 渲染；不复制游戏人物、界面或截图。

## Components

- **Buttons:** 绿色主操作、麦色次操作、透明次要操作。共享按钮最小高度 44px，悬停改变背景，按下位移 1px，禁用保留可辨识文字。
- **Inputs:** 浅纸底、细棕框、3px 小圆角；焦点有 3px 绿色轮廓。复选框采用草绿选中态。
- **Navigation:** 木色横向工具条，浅绿当前页，由 NavLink 的真实路由决定；图标始终有文字标签。
- **Preferences:** 中文 / English 为显式选择控件；日夜切换为带 `aria-pressed` 的像素太阳 / 月亮拨钮。两项偏好独立保存，刷新后先呈现保存的主题，再启用过渡。
- **Paper:** 共享模块为奶油纸面，标题区为稍深纸色；首页计划与便笺使用不同纸色和虚线分隔。
- **Reading shelf:** 木色横边与像素图标保持书架识别度，内容以清晰列表呈现。主状态、类型入口、主题分类分层；九类主题徽标采用语义纸面与细框，不用颜色替代文字。来源报告可打开 PDF，原件不在工作台内修改。
- **Badges:** 未连接与待确认均显示中性标签；真实失败单独使用错误文字与颜色。
- **Data states:** 读取中、未导入、未连接、失败、已有数据分别处理。没有数据时用占位与配置入口，不展示虚构统计或任务。
- **Report status:** 每日纽约时间 09:00 表示既有流程开始制作；只对已发现的正式 PDF 显示数量和阅读入口，不用时间表制造「已完成」状态。科技日期是报道覆盖日，审美日期是刊期；已读文件变更显示更新提示。
- **Motion:** 原创园丁以 22 秒步进轻移，伴随微小步幅；植物静态，白天蝴蝶轻动，夜间少量萤火虫缓移。日夜场景交叉淡入 1200ms，表面颜色过渡 700ms，拨钮在控件范围内完成切换。支持首页暂停、设置总开关、离屏和后台暂停；系统减少动态效果时去除非必要位移，不延迟显示业务内容。

## Do's and Don'ts

### Do:

- Do 使用已定义的日夜语义色与像素标题。
- Do 保留明确中英功能名、键盘焦点和真实状态说明。
- Do 检查中文 / English、白昼 / 夜晚在桌面和窄屏中的可读性。

### Don't:

- Don't 恢复原版黑白橙黄、个人头像或装饰编号。
- Don't 在来源未配置时承诺已经连接或显示虚构账户数据。手动待办始终可用。
- Don't 将图片中的装饰当成可点击控件。
- Don't 把尚未实施的来源控制台、自动调度、Obsidian 写入、Git 项目续航或灵感气泡画成可用模块。书架阶段一已提供分类、导入预览、批次撤销及回收站；这些能力不代表跨来源自动化已经实现。独立学习工作流已撤销，学习进度小卡已取消。

原创图片与完整提示词见 `docs/garden-art-provenance.md`、`docs/garden-details-provenance.md` 和 `docs/garden-night-provenance.md`。新增界面沿用已认可的主体风格，文档不包含私人目录与实际阅读记录。
