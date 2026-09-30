# Study plans

Mode: Operate. Targets: plan index, dedicated plan detail and learning task links.

## Direction contract

THESIS: Keep each course or long-term learning goal on its own timeline, and bring a concrete next step into today's tasks.

OWN-WORLD: Extend the incumbent pixel garden with its paper shelf, square controls, pixel headings, vertical timeline and day/night semantic colors. Reuse the inspiration timeline's reading rhythm while keeping course records separate from ideas.

STORY: Create a plan, open its dedicated page, record progress or questions, attach resources, and deliberately add a next step to today. Edit or remove any created plan, entry or link. Recover plans and entries for 30 days.

FIRST VIEWPORT: The index shows searchable plan summaries with course and status, a new-plan action and a recycle bin. The detail leads with the plan's name, goal and next step, then a timeline defaulting to oldest first. Each update carries its own content, resources and actions.

FORM: A code-led ordinary extension with structure pinned by the user's dedicated-page and chronological-timeline requests. No replacement visual world or approval comp.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Behavior

- Long-term course plans do not share identities, records or AI conversations with the inspiration library. No AI prompt generator.
- Text, links, status and target date are authored by the user. Completing one task does not claim that the course or learning goal is complete.
- Saving an update appends to the plan timeline. Editing keeps its original chronological place. The initial record is also deletable.
- Resource URLs allow only absolute HTTP/HTTPS without embedded credentials. The application saves references, does not fetch linked content, and opens resources with `noopener noreferrer`.
- Adding the same next step twice returns the existing task. Changing the action creates a new step identity. Existing task edits, due dates and completion state are never overwritten by adding again.
- Deletion confirmations explain the scope. Plans and entries have 30-day recovery; deleting a link removes only that saved reference after confirmation and save. Independent tasks, ideas and source pages are kept.
- Stale revisions cannot overwrite a newer plan. Failed saves keep the open form and draft, and explicit review is needed before using a newer revision.
- Chinese/English, day/night, keyboard access and narrow layouts use existing product preferences and controls.

## Built form

The index reuses the paper shelf with its wood-colored top edge, searchable summaries, text status and dashed row separators. Each summary opens a dedicated page; it does not expand a long timeline inside the list. The detail places the goal and actionable next step before the paper timeline. A fine vertical line and square nodes preserve the inspiration timeline's established rhythm while the study records remain independent.

Timeline headings use the incumbent pixel face at 23px, entry headings at 19px, and readable 14px body text with a maximum 72ch line length. Resources show a link name and host. Next-step actions sit beside their text when space allows and move below it on narrow screens. Plan fields and the resource-link editor become one column at 700px and below. Entry actions retain 44px height, visible keyboard focus and explicit text labels. Editors, removal confirmations and failed-save feedback stay inline, with the plan context visible.

## Finish record

The current UI finish review returned **SHIP at the full reviewed scope**, with no material fixes. Its scope includes the study-plan index, dedicated oldest-first timeline, resource and task interactions, inline editors and deletion confirmations, together with the homepage growth extension. This is an ordinary extension with no concept seed, comp or replacement design system.

The reviewer checked 14 valid captures matching the incumbent garden. Study-plan evidence under `.impeccable/review/` is `learning-desktop.png`, `learning-mobile.png`, `learning-mobile-day.png`, `learning-user-1280.png`, `learning-index-desktop.png`, `learning-editor-desktop.png`, `learning-editor-mobile.png` and `learning-delete-desktop.png`. The six home captures and the distinction from the prior timer correction-only verdict are recorded in [the home surface](home-pomodoro.md). The once-run `garden-learning-detector.json` returned `[]`; it is supporting evidence, not the review disposition.

Implementation verification supplied to the documentation pass: 414 backend tests, 136 frontend tests and both production builds passed. Browser CRUD verification used isolated fixtures. The learning interface adds no raster and reuses existing paper and garden materials; the home surface records the new tomato atlas and its provenance.

`DESIGN.md` and `.impeccable/design.json` remain byte-for-byte unchanged. The [home surface's drift note](home-pomodoro.md#preserved-system-and-existing-drift) records older navigation, breakpoint and narrative descriptions without broad repairs. The former cancelled learning workflow and learning-progress card remain cancelled; this course and long-term plan manager is a separately authorized interface. See [learning-plans.md](../learning-plans.md) for the data, deletion and recovery contract.
