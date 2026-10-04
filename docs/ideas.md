# Idea garden

Open Idea garden from navigation. The list summarizes each title, state, latest timeline excerpt, update count and time; each idea owns a dedicated detail page. Bubble/list views share the same canonical IDs and entries. Search matches titles and the latest excerpt.

## Capture and timeline

1. Create an idea with a title and initial thought; saving opens its detail page.
2. Append notes, progress, decisions or questions with their own dates/content. Older nodes are not replaced.
3. Timeline order defaults oldest first and can be reversed. Editing keeps creation time and displays a separate edited time.
4. Edit title/status, tags and pinning independently. Status distinguishes exploring, incubating and formed ideas.
5. Added updates can be deleted individually after scope confirmation; this is immediate and cannot be undone. The initial entry is editable; removing the whole idea moves its timeline to 30-day recovery. Cancellation changes nothing. Tasks, shelf records and original external files remain.

Inspiration AI conversations and automatic local workspace/Codex creation or context handoff are retired. The page and generation APIs are disabled and no longer probe the local model. Legacy records/resources remain preserved. Local Qwen is still optional for manual shelf classification.

## Selected-timeline exploration prompt

Open **Generate exploration prompt** below the detail timeline. Write an explicit initial direction, select one or more saved entries, then generate, preview and copy. Paste it manually into the AI tool you choose; DailyHouse does not call a model, send messages or create conversations.

The prompt asks the receiving AI to:

1. Restate the idea, audience and constraints, then wait for confirmation/correction.
2. Use the `grill-me` entry pointing to the `grilling` skill, ask in decision-dependency order, recommend answers and wait for choices until understanding is confirmed. If unavailable, say so and follow the included questioning process.
3. Verify current alternatives/products/open-source projects online, give official links and research dates, and compare features, cost, limits and unmet needs. If browsing is unavailable, state that limit. Search with generalized public terms, not the full private timeline.
4. Propose improvement/specialization paths, cost/risk and minimum validation experiments, including when existing options suffice. The user chooses the direction before further work.

Included context is only the current title, explicit initial direction and selected saved entries in full chronological text. Unselected entries, unsaved drafts, fusion snapshots, legacy chats, attachments and local paths are excluded. Expand long entries to inspect them; generation does not truncate. Limits are 50 selected entries, 60,000 characters of background JSON and 4,000 characters of initial direction; reduce selection if needed.

Input/preview stay only in the current detail page's memory and clear on refresh/navigation. They are not stored in the database, browser storage or cloud. Clear preview preserves selections/input/timeline. Changes to direction, title, selected text, selection or interface language disable copying the old preview until regenerated; changes to unselected entries do not. If clipboard access fails, select the preview and press Command+C/Ctrl+C. Review the scope before pasting to an external service.

## Manual fusion

Select 2–8 incubating ideas in the bubble view and choose Fuse selected. Name the combination and describe its relationship, then save/open it. Originals and timelines remain; the derived idea stores snapshots from the fusion time. Open a source or confirm unlinking one. Later edits to originals never rewrite snapshots. Fusion invokes no model and creates no project.

## Empty private GitHub repository

In the separate GitHub private repository section, enter a repository name and confirm the displayed account/scope. The operation creates only an empty private remote repository. It sends no idea/timeline/chat content and creates no local directory, Git commit, Codex project or conversation. Explicit retry reuses the operation identity and never overwrites an unrelated same-name repository. See [repository creation](project-resume.md#creating-an-empty-private-github-repository).

Legacy repositories remain openable without a Codex handoff/retry. A legacy failed record with no repository can retry only GitHub creation. Confirming removal of the website repository record permanently removes only that record, retaining external resources and minimal duplicate-prevention identity. Website recovery cannot undo creation of an external repository.

## Projects and compatibility

Projects shows verified local Codex workspaces and Git facts; prior goal/MVP/next-step notes remain separately available. Legacy note next steps create tasks only on explicit request, reuse the same step's task, do not resurrect deleted tasks automatically and never rewrite older tasks when the step changes. Task completion does not establish project completion. See [project resumption](project-resume.md).

- Canonical ideas/timelines live in `personal-workbench.json`. `inspiration-garden.json` stores same-ID tags/pins, fusion snapshots, preserved legacy drafts/chats/notes and project trash. It is not another editable idea store. Back up both atomically written files together.
- Unsaved edits are isolated by idea in tab session storage. Failed saves retain input; closing the tab may clear it. This is not a backup or cross-device sync. Storage failure shows a warning.
- Writes carry revisions. Stale tabs cannot silently overwrite newer saved content; refresh the saved record and review the retained draft.
- Old files without idea fields read as empty without startup writes. Legacy learning-workflow records retain content/dates during idea migration; existing canonical fields take precedence and removed records do not return. The old `#/workflow` bookmark redirects to `#/ideas`.
- Recovery uses the original removal date and 30-day deadline. Expired snapshots are cleaned on later saves; restoration retains ID/timeline and advances revision. Confirmed permanent deletion removes this idea and its own attached legacy content, while retaining minimal migration suppression. Snapshots already held by other ideas and independently handed-off legacy contexts are not cascade-deleted.
- Limits: title 200 characters, entry 20,000 characters, 5,000 ideas and 5,000 nodes per idea, validated by UI/server.

Any future record-creating feature needs visible scoped deletion, including nested records. Verify create/edit/delete/cancel/recovery and preservation of failed drafts together. The old generic AI prompt tool remains retired; only this specifically authorized manual timeline prompt is available.
