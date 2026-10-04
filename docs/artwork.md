# Garden artwork provenance

The garden uses original pixel artwork and geometric textures. The requested farming-game atmosphere is an aesthetic reference; no game screenshots, characters or official game assets were copied. Generation used the built-in ImageGen tool. Exact prompts remain available for provenance; they are not current feature or development instructions.

## Raster assets

| Asset | Origin and purpose | Exact prompt |
| --- | --- | --- |
| `frontend/public/images/garden-landscape.png` | Generated on 2026-09-26 as the wide daytime home banner; original output `exec-fa7bc3b4-b19d-4587-9ca0-d00bd19ef458.png` | Complete daytime prompt below |
| `frontend/public/images/garden-landscape-night.png` | ImageGen edit of the inspected daytime source; 2172 × 724 PNG with the same cottage, pond, path, well, trees and mountains | [Night edit](prompts/garden-night-prompt.txt), also embedded in the PNG |
| `frontend/public/images/garden-keeper.png` | Original decorative keeper; native transparent 1131 × 1391 PNG, alpha 0–255; original output `exec-ff3353ed-936b-4342-a9f2-002512bc5804.png` | [Keeper](prompts/garden-keeper-prompt.txt), also embedded in the PNG |
| `frontend/public/images/tomato-growth-atlas.png` | Transparent 1254 × 1254 RGBA PNG with a 3×3 grid for seedlings, flowers and small red/large red/metallic gold fruit | [Tomato atlas](prompts/tomato-growth.txt), also embedded as `impeccable:prompt` |

The night edit preserves geometry for an aligned day/night crossfade. Generation used project artwork rather than personal notes, credentials or account data. Characters/plants are decorative; CSS and timer state control their display. No game data or invented work progress is associated with them.

## Authored assets and attribution

- `garden-woodgrain.svg`, `garden-papergrain.svg` and `garden-night-fiber.svg` under `frontend/public/images/` are original low-opacity geometric textures.
- `GardenLife.tsx` supplies authored two-pixel navigation shapes and planters; `ThemeToggle.tsx` supplies the original sun/moon switch. Decorative elements are hidden from assistive technology.
- `assets/garden-launcher.svg` is the original 64-unit cottage/planter mark. The PNG is a deterministic Sharp export; ICO contains 16/24/32/48/64/128/256px versions. The Mac ICNS uses nearest-neighbor exports of the same source. Both desktop installers use this shared identity.
- The garden favicon derives from the Pixelarticons tree icon. Retain its attribution and all font/component notices in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

Render garden sprites with pixelated edges. Motion, palette and accessibility guidance belongs in [DESIGN.md](../DESIGN.md); desktop lifecycle belongs in [Mac setup](macos-local.md). Generated desktop apps, screenshots and machine-specific image-generation paths are not source assets.

## Complete daytime generation prompt

Create an original wide panoramic pixel-art landscape background for a Chinese personal productivity web app themed as a cozy countryside garden, inspired by the warm mood of 16-bit farming RPGs. This is a project-bound image asset, NOT a UI mockup. Landscape composition wide 3:1 aspect ratio (1536x512 if possible). A tiny sunlit wooden studio cottage with teal green roof on the right third, a leafy broad apple tree at far right, small vegetable beds, cream winding pathway, little stone well on left, a pond edged with reeds at lower left, layered distant mountains and tranquil pale sage sky with blocky cream clouds. Warm late summer daylight. Limited beautiful muted palette: sage green, moss green, honey wood, buttery ivory, soft pond blue. Deliberate crisp square pixel clusters, classic expertly hand-pixeled game background art, coherent pixel size around 3-4 screen pixels, charming detailed plants but uncluttered overall, no smooth digital painting, no outlines in pure black. A few daisies and tiny butterfly. Enough open meadow across center. Original composition and assets; no identifiable copyrighted characters or game UI. No text, no letters, no logos, no UI controls, no border. Scene should fill the entire image edge to edge.
