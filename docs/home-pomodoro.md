# Home pomodoro

The homepage sidebar has 25/5 and 50/10 focus/break presets plus custom whole-minute durations from 1 to 180. Choose a phase, start, pause/resume or reset. Completion invites a deliberate phase change; it never starts another round automatically. Duration/phase changes reset the round and are unavailable while running. Invalid custom inputs remain editable.

A deadline keeps elapsed time accurate across route changes, reload, background throttling and device sleep. Browser-local persistence restores the current round. Reset restores the selected phase's full duration and clears completion. No server item or focus history is created.

## Completion sound

With 「结束时声音提醒」 / "Completion sound" enabled, focus and break completion play three pairs of rising notes over about five seconds. The reminder stops automatically. Muting, resetting, changing the round or starting the next phase stops any current sound, and overlapping previews are replaced. Use 「试听提示音」 / "Preview sound" to hear the same reminder without changing the timer.

Sound is generated locally with Web Audio and uses the device's current volume; no audio file, network request or notification permission is needed. Start/resume, enable sound or preview it to unlock browser audio. An expired round restored after reload keeps the visual completion message without replaying an old alarm. Muted or unavailable browser audio leaves the timer and visual message usable.

## Tomato growth

Elapsed focus time selects seedling, leaves, flowers, ripening and ripe fruit. Pause freezes growth; a new focus round returns to seedling. Breaks keep the previous harvest, including after reload. Focus duration selects fruit size/material:

| Focus duration | Fruit |
| --- | --- |
| 1–30 minutes | Small red tomatoes |
| 31–60 minutes | Large red tomatoes |
| 61–180 minutes | Large metallic gold tomatoes |

Gold uses built-in sharp pale highlights and bronze shadows, not a flat yellow recolor. Break duration does not change the harvest. Gentle plant sway runs only during focus and respects the global animation preference and reduced motion; stages remain visible with decoration disabled.

The plant/countdown share a compact row in the existing paper noticeboard. Controls wrap on narrow screens without shrinking labels. Pixel headings, tabular digits, semantic day/night colors, 44px actions and keyboard focus follow [DESIGN.md](../DESIGN.md). The transparent 3×3 tomato atlas and exact prompt are preserved in [artwork provenance](artwork.md).

Language, theme and timer state are independent local browser preferences. Clearing site data removes them; they are not included in server backups or private sync. The adjacent study-plan link opens the separately authorized [study manager](learning-plans.md), and timer completion does not infer learning progress.
