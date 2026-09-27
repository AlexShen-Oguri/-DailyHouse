# 统一灵感库

Mode: Operate. Routes: `/ideas`, `/ideas/:id`, `/projects`.

## Direction contract

THESIS: Capture an unfinished thought, then keep its development readable as a dated sequence. The list is an index; each idea owns a separate page. No AI prompt tools or combined detail dashboard.

OWN-WORLD: Inherit the approved pixel garden: cream paper and green accents by day, navy and warm ink by night, compact square controls and existing pixel headings. Use the shared shell and semantic theme colors.

STORY: Add a title and first thought, arrive on its dedicated page, append notes, questions, progress or decisions, and return later to continue. Every created idea and added update has a visible deletion path with clear scope.

FIRST VIEWPORT: The list places its heading and new-idea action above search, status filters and compact rows. The detail page starts with a back link, title, status and management actions, followed by a vertical timeline with dated nodes. An append shortcut leads to the editor; long text wraps within a readable measure.

FORM: User-specified list-to-detail structure, implemented directly within the established system. Timeline defaults oldest first, as explicitly confirmed by the user. No concept seed or new visual identity is needed.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Behavior

- Creation opens the new idea's dedicated page. Reload and direct links preserve that separation.
- Timeline entries retain creation times; editing shows a separate edited time. Ordering may be reversed without changing stored history.
- Added updates can be edited or permanently deleted after confirmation. The initial entry can be edited; removing it means moving the idea and its full timeline to the 30-day ideas trash. The list provides a recovery view.
- Title and status are editable. Saving failures preserve drafts; revision checks prevent a stale tab from silently overwriting newer changes.
- Chinese and English, day and night, keyboard focus, narrow layouts and reduced motion remain supported.

## Integrated extension

The list and bubble layout share canonical idea IDs and timeline text. Desktop bubbles are stationary; narrow screens use compact rows. Selecting two or more opens a named fusion form and creates a derived idea while preserving source snapshots. Detail pages keep source metadata and local AI exploration behind a disclosure, so capturing the next thought stays independent of inference. Project creation requires a separate editable confirmation. Project management includes next-step tasks, status changes, deletion and recovery.

## Finish record

Disposition: ship after the integrated verification. Synthetic data on an isolated local server exercised fusion, timeline updates, real local-model generation, project confirmation, duplicate-safe todo creation, project deletion/restoration and December calendar selection. Desktop Chinese/day and 390px English/night were visually inspected; narrow-screen document width matched its viewport. Base timeline/create/delete/restore were independently reviewed in the coordinated task. No new raster assets were introduced; shared garden materials retain their existing provenance. AI and project state changes remain covered by automated tests.
