# Night garden artwork and motion

The night mode preserves the established pixel garden, changing its lighting and materials to midnight navy, muted teal, dark wood and warm lamp light.

## Paired image

- Day source: `frontend/public/images/garden-landscape.png`, previously generated original artwork; see `garden-art-provenance.md`.
- Night asset: `frontend/public/images/garden-landscape-night.png` (2172 × 724 PNG).
- Method: built-in ImageGen **edit**, after inspecting the day source. The existing cottage, pond, path, well, trees and mountains retain their composition.
- Exact prompt: `garden-night-prompt.txt`, also embedded in the shipping PNG.
- No user files, account data, notes or personal records were supplied to image generation.

## Native interface assets

`garden-night-fiber.svg` is an authored geometric paper-fiber texture with very low-opacity pixels. `ThemeToggle.tsx` contains the original pixel sun/moon shapes. Neither uses external stock or game assets.

## Motion contract

`GardenScene` blends the aligned day/night images over 1200 ms. Surface colors transition over 700 ms. `ThemeToggle` enables transitions after its first two animation frames so the initial persisted theme is shown directly. The switch moves a small warm pixel disc, changing sun rays to a crescent. Five tiny decorative fireflies run only when the night scene is visible and the document is active. CSS also pauses them when GardenLife reports paused motion. Reduced motion and the global animation-off preference suppress nonessential movement.

The landscape has one translated accessible description; both image elements and fireflies are decorative. The theme switch uses a translated, stable “Night mode” accessible label plus `aria-pressed`.

## Palette checks

The main body text is `#eee5ca` on `#1d2c35` (11.40:1); muted text is `#bdc5b3` on the same surface (8.06:1). Fields use `#142430` with placeholder `#aab8ad` (7.68:1), navigation uses `#e6d8b7` on `#3a2e29` (9.28:1), and errors use `#ffbca3` on `#452b29` (7.96:1). Primary button text is `#fff0cf` on `#3b604c` (6.28:1), with a hover background of `#476f56` (5.06:1). Ratios use the WCAG sRGB relative-luminance formula. Root-task browser QA covers the integrated day/night and language combinations.
