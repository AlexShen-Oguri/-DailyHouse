# Home pomodoro

Mode: Operate. Target: homepage sidebar.

## Direction contract

THESIS: Start a short focus session next to today's tasks, then deliberately take a break.

OWN-WORLD: Inherit the pixel garden's paper, foliage accents, square controls, pixel headings and day/night semantic colors. Reuse the existing sidebar surface. An original transparent pixel tomato atlas adds growth beside the countdown, within the incumbent garden world.

STORY: Choose 25/5, 50/10 or custom whole minutes, start, pause or continue, and reset the current round. Completion invites the next phase; it does not start it automatically.

FIRST VIEWPORT: A compact timer sits above the sidebar's garden links. Phase controls precede a tomato plant and clear tabular countdown digits, followed by start/pause/reset actions. Custom durations expand inline. All controls wrap on narrow screens.

FORM: A precisely specified component extension, built directly in the established homepage. No concept seed or comp is needed. The user explicitly requested both presets and custom durations.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Behavior

- Timer state is local to this browser; it does not create server records or focus history.
- A deadline keeps elapsed time accurate when the tab is throttled, the device sleeps or the user changes routes. Reload restores the same round.
- Focus and break are manual. Duration settings and phase changes reset the round and are unavailable while running.
- Custom focus and break accept whole minutes from 1 to 180. Invalid input remains editable.
- Reset restores the selected phase's full duration and clears the completion state. An optional short completion sound requires no notification permission.
- Elapsed focus time selects five growth stages: seedling, leaves, flowers, ripening and ripe fruit. Pause freezes the growth stage; a new focus round returns to a seedling. Breaks keep the last harvest visible, including after reload.
- The selected focus duration determines the fruit: 1–30 minutes small red, 31–60 large red, 61–180 metallic gold. The gold sprite uses sharp pale highlights and bronze shadows. Break duration does not change the harvest.
- Gentle plant sway runs only during focus and respects the settings animation switch and system reduced motion. Stage changes remain visible when decorative movement is disabled.
- The built-in ImageGen tool produced `frontend/public/images/tomato-growth-atlas.png`. Its exact prompt is embedded in the PNG and saved at `docs/prompts/tomato-growth.txt`.

## Built form

The plant and countdown share a compact two-column row inside the existing noticeboard. The sprite occupies 130px beside 46px pixel countdown digits; at 360px and below these become 104px and 36px. The atlas is rendered with `image-rendering: pixelated`. Preset, phase, sound and custom-minute controls keep the incumbent paper, fine borders and 44px control height. Actions and custom fields wrap without shrinking their labels.

Finance's former placeholder and navigation entry are retired. The sidebar now links to the separately authorized study-plan manager, alongside the reading shelf and Obsidian library.

## Finish record

The component reuses the homepage sidebar, pixel typography, paper surfaces and shared controls. The root timer provider keeps the current round across route changes.

### Prior timer review

The earlier timer review requested one secondary-text contrast correction. Its verdict pass resolved that listed fix and returned ship at correction scope. Secondary timer copy uses home-muted in day mode and garden-muted in night mode; the recorded contrast was 5.14:1 and 7.09:1 respectively. That timer-only pass added no raster; three incumbent shipping rasters retained provenance.

### Tomato growth and study-plan extension

The current UI finish review returned **SHIP at the full reviewed scope**: tomato growth, the retired finance placeholder, study-plan index and dedicated timeline, resource and next-step interactions, inline editors and deletion confirmations. It found no material fixes. This is a fresh ordinary-extension review; it does not expand the earlier correction-only verdict.

All 14 current captures were valid and matched the incumbent garden identity. Under `.impeccable/review/`, home evidence is `desktop.png`, `mobile.png`, `user-1280.png`, `tomato-small.png`, `tomato-large.png` and `tomato-seedling.png`; the eight study-plan captures are recorded in [the study-plan surface](learning-plans.md). The evidence covers Chinese/day, English/night, desktop, narrow layouts and the user's 1280 capture. The once-run detector in `garden-learning-detector.json` returned `[]`.

Implementation verification supplied to the documentation pass: 414 backend tests and 136 frontend tests passed; both production builds passed; browser CRUD checks used isolated fixture data.

The new shipping atlas, `frontend/public/images/tomato-growth-atlas.png`, is a 1254 × 1254, 8-bit RGBA PNG with transparency and a 3 × 3 grid. The built-in ImageGen tool produced it; the exact generation prompt is embedded under `impeccable:prompt` and retained in [tomato-growth.txt](../prompts/tomato-growth.txt). The shipping-raster scan reported four rasters and zero missing provenance records.

### Preserved system and existing drift

`DESIGN.md` and `.impeccable/design.json` remain byte-for-byte unchanged because this build extends the incumbent system. Existing drift is recorded here for a future requested refresh: root DESIGN still names Chase in its navigation example; its homepage single-column prose says 720px while `garden-home.css` and the sidecar record 760px; the sidecar narrative predates the fuller bilingual and day/night guidance. These older descriptions are not new rules for this extension. The cancelled learning workflow and learning-progress card remain cancelled; the dedicated long-term study-plan manager was separately authorized.
