# Home pomodoro

Mode: Operate. Target: homepage sidebar.

## Direction contract

THESIS: Start a short focus session next to today's tasks, then deliberately take a break.

OWN-WORLD: Inherit the pixel garden's paper, foliage accents, square controls, pixel headings and day/night semantic colors. Reuse the existing sidebar surface; no new illustration or visual theme.

STORY: Choose 25/5, 50/10 or custom whole minutes, start, pause or continue, and reset the current round. Completion invites the next phase; it does not start it automatically.

FIRST VIEWPORT: A compact timer sits above the sidebar's garden links. Phase controls precede clear tabular countdown digits and start/pause/reset actions. Custom durations expand inline. All controls wrap on narrow screens.

FORM: A precisely specified component extension, built directly in the established homepage. No concept seed or comp is needed. The user explicitly requested both presets and custom durations.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Behavior

- Timer state is local to this browser; it does not create server records or focus history.
- A deadline keeps elapsed time accurate when the tab is throttled, the device sleeps or the user changes routes. Reload restores the same round.
- Focus and break are manual. Duration settings and phase changes reset the round and are unavailable while running.
- Custom focus and break accept whole minutes from 1 to 180. Invalid input remains editable.
- Reset restores the selected phase's full duration and clears the completion state. An optional short completion sound requires no notification permission.

## Finish record

- The component reuses the homepage sidebar, pixel typography, paper surfaces and shared controls. The root timer provider keeps the current round across route changes.
- Secondary timer copy uses the incumbent home-muted color in day mode and the garden-muted semantic color in night mode. The corrected text contrast is 5.14:1 in day mode and 7.09:1 in night mode.
- Finish review: pass; disposition: ship. Desktop Chinese/day and narrow-screen English/night captures preserve the established garden. The design detector returned no findings. No new image assets were added; the three inherited shipping rasters retain provenance.
- Existing DESIGN.md and .impeccable/design.json are preserved for this ordinary component extension. Pre-existing documentation drift is reported separately for a later requested refresh.
