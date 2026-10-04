# Study plans

Study plans manage courses, self-study and long-term learning goals separately from the idea garden. The user authors goals, progress, resources and next steps; a timer or completed task does not establish course progress. This separately authorized manager does not restore the cancelled learning workflow or progress card and has no AI prompt generator.

## Usage

1. Create a plan with name, course/direction, goal, next step and optional target date.
2. Saving opens its dedicated page. The searchable/status-filtered index holds summaries, not expanded timelines. Detail defaults oldest first and can reverse display order.
3. Add progress, questions, milestones, named resource links and a next step. Editing preserves a node's chronological place.
4. Add a plan/node's next step to Today explicitly. Source links lead back to the plan and task. Repeating the same step returns the existing task without overwriting edited title, date or completion. A changed action has a new step identity.
5. Set ongoing, paused or complete status manually. Completing one task does not automatically finish the plan.

## Deletion and recovery

- Delete this plan is discoverable at the bottom. Confirmation moves the plan/timeline to 30-day recovery, preserving original IDs, text and links.
- Each node has edit/delete controls, including the generated initial node. Removed entries can be restored inside the plan and return to their original timeline position.
- Remove existing resource links individually while editing, confirm and save. Only the saved reference is removed; original pages/papers and other links remain.
- Plan/node removal preserves independent tasks, ideas and external materials. Unavailable source links explain the retained task; restoring the source makes links usable again.
- After 30 days, snapshots cannot be restored and later saves clean them. There is no permanent-empty-trash control in this version.

## Data and consistency

Plans, entries, links and trash use `personal-workbench.json` in the private data directory and its existing atomic writes. They may join optional private sync only through a separately reviewed scope; see [sync fields](private-cloud-data.md). Browser drafts and request state are excluded.

Each mutation carries the current revision; stale writes return 409. Failed saves retain open forms/drafts and require review of the latest version before continuing. Old data gets empty learning defaults in memory and writes them only on a later explicit save, preserving unrelated records. Corrupt snapshots prevent loading rather than silently replacing them with empty data.

Resources accept absolute HTTP(S) URLs without embedded credentials. DailyHouse saves references but does not automatically fetch, summarize or download them. External links use `noopener noreferrer`.

## Interface

Inline editors/confirmations retain the visible goal and timeline. Paper surfaces, a fine timeline line, square nodes and readable body text reuse the garden system. Long text wraps; resources show names/hosts. Actions and link fields stack on narrow screens. Chinese/English, day/night, visible focus and keyboard access follow [DESIGN.md](../DESIGN.md).
