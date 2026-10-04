---
name: DailyHouse
description: Original pixel garden personal workbench with Chinese/English and day/night themes
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

# Design System: DailyHouse

## Direction and source of truth

The creative direction is a countryside workbench: original pixel scenery, wood navigation, foliage accents and readable paper surfaces. Day and night retain the same garden composition. Pixel headings add character; body text remains easy to read. Decorative plants and characters do not represent currency, task progress or fabricated source state.

The tokens above describe the shared system. Actual layout and colors come from `frontend/src/styles/`: `tokens.css`, `garden.css`, `garden-home.css`, feature styles, `garden-details.css` and the final night overrides in `night-garden.css`. `global.css` supplies basic typography. The design sidecar in `.impeccable/design.json` describes the same visual identity. Feature behavior belongs in [PRODUCT.md](PRODUCT.md) and the linked usage guides.

## Color and typography

Use green for primary actions/selection, wood brown for navigation and secondary controls, cream paper for content and brown ink for text. Errors use brick red plus explicit text. Legacy `ui-orange` and `ui-yellow` aliases map to garden colors; their names do not justify returning to the old orange/yellow theme. Low-opacity authored wood/paper textures must not compete with text.

Night uses `html[data-theme='night']` and semantic variables for navy ground, dark paper, warm ink, muted text, moss accents and dark navigation. Shelf surfaces use `--shelf-surface`, `--shelf-raised` and `--shelf-line`. Keep primary controls readable in hover/disabled states; color alone never conveys status. The established night body/paper and muted/paper pairs have WCAG sRGB contrast ratios of 11.40:1 and 8.06:1; primary hover text is 5.06:1. Recheck any changed colors rather than inheriting these measurements for new pairs.

The local Fusion Pixel font retains the internal CSS family name `LShu Pixel`; licensing is in [OFL.txt](frontend/src/assets/fonts/OFL.txt). Use it for brand, headings and navigation. Body text uses Microsoft YaHei, PingFang SC and system fallbacks. Ordinary headings are around 32px, compact shelf headings 29px, home headings 23px and body text 13–14px. Narrow layouts may reduce module headings while preserving readability. English wraps naturally; never shrink the whole page to fit it. Dates follow interface language; authored content stays unchanged.

## Layout

The shell is at most 1344px wide with 32px desktop padding, yielding at most 1280px of content. Its nine navigation entries match the routes in [PRODUCT.md](PRODUCT.md); narrow navigation scrolls horizontally. Language and theme controls remain independent and can wrap. Shell padding becomes 16px at 700px. The homepage main/sidebar grid becomes one column at 760px, with further compact adjustments at 520px. Feature breakpoints follow their actual stylesheets rather than one universal cutoff.

The home combines a garden banner, keeper and greeting with today's tasks and a sidebar for the pomodoro and useful links. Study-plan and idea lists remain indexes; dedicated detail pages hold readable timelines. A fine vertical line, square nodes, dates and distinct edited timestamps preserve chronology. Inline editors and confirmations retain context and failed drafts. Resource and next-step controls move below text when narrow; learning forms become one column at 700px.

The shelf leads with Unfinished/Finished and real counts. One compact row selects All, Books, Videos, Courses/tutorials, GitHub, Articles, Tech reports or Design reports. Search, topic and in-progress filters are secondary. Topics are Programming/AI, Technology, Business/economics, Design, Natural sciences, Humanities/social sciences, Languages, Productivity/career, Life skills and Other. Topics and media types are different concepts. Long type rows scroll rather than squeeze labels.

Video covers preserve source colors in a 16:9 frame, placed beside text on wide screens and above on narrow screens. Failure falls back to complete text/actions. Images lazy-load and add no decorative animation. Quick import uses inline link/file/book forms and native file selection. Browser collection has one progress/status flow and recent summaries; there is no legacy candidate review or batch-undo surface.

Desktop idea bubbles stay stationary and become readable rows on narrow screens. Fusion and source snapshots remain manual. Timeline exploration opens a scoped preview/copy form without a model conversation. Repository creation has a separate concrete confirmation. Project views distinguish local Codex projects, shared context and legacy notes; Git provenance and observed connection time remain visible.

## Components and accessibility

- Primary buttons are green, secondary buttons wheat, auxiliary actions transparent. Shared controls have a 44px minimum height, 3px corner radius and a 1px pressed displacement. Home controls use 2px corners; paper surfaces use at most 4px.
- Inputs use pale paper, thin brown borders and a visible 3px green focus outline. Navigation and status icons always have text labels. Business controls use Pixelarticons; GardenGlyph uses original two-pixel shapes.
- Paper depth comes from color separation, 1–2px borders and light inset edges. Avoid bright full-page glows, high-contrast textures and glass effects. Night warmth stays in windows and restrained fireflies.
- The theme toggle has a stable translated label and `aria-pressed`. The persisted theme renders before transitions begin. Language and theme preferences save independently.
- Loading, empty, unconfigured, disconnected and failed are distinct states. Show verified source data and freshness; unavailable sources offer configuration, not invented counts.
- Destructive confirmations name the item and scope. Shelf selection resets on filter change; select-current-list and remove-entire-shelf express different scope. Recovery/permanent deletion preserve original files and external resources. Errors keep selections/drafts, and completion/cancellation returns keyboard focus.
- Keep keyboard operation, skip navigation, visible focus, translated labels, narrow layouts and reduced motion across every feature. Decorations are hidden from assistive technology; the landscape has one translated accessible description.

## Motion

The original keeper uses slow stepped movement; day butterflies and restrained night fireflies are decorative. GardenScene crossfades aligned day/night scenes over 1200ms; surface colors transition over 700ms. Enable toggle transitions only after the persisted initial theme is rendered. Pause nonessential movement when offscreen, in background tabs, through the garden/setting controls or under system reduced motion.

Shelf completion feedback runs only after saving succeeds: a stepped check, fade and row collapse over about 1.3 seconds, with a timer fallback. Reduced motion retains brief status feedback. The pomodoro plant grows with elapsed focus time, freezes while paused and keeps the harvest during breaks; sway follows the same motion preferences. See [pomodoro behavior](docs/home-pomodoro.md).

## Artwork and maintenance

All garden rasters, textures, launcher marks and exact generation prompts are recorded in [artwork provenance](docs/artwork.md). Render pixel artwork with `image-rendering: pixelated`; no copyrighted game screenshots or characters are used. Keep font/component licenses and existing artwork provenance when extending the interface.

Use this established system for new surfaces. Do not restore retired finance/scavenging, inspiration chat or automatic handoff surfaces, or imply that unapproved source automation is available. Durable design/behavior belongs here or in feature guides; temporary captures, verdicts and development transcripts stay out of the maintained documentation.
