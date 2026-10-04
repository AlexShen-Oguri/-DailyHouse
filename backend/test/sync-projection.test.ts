import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { PersonalStore } from '../src/personal/store';
import { InspirationStore } from '../src/personal/inspiration-store';
import { JournalStore } from '../src/personal/journal';
import { validateProjectedRecord, validateProjectedRecords, type ProjectedRecord } from '../src/personal/sync-projection';

let root: string;
const personal = (name = 'a') => new PersonalStore(join(root, `${name}-personal.json`), undefined, join(root, `${name}-reports`));
const journal = (name = 'a') => new JournalStore(join(root, `${name}-journal.json`));
const bytes = (name: string) => readFileSync(join(root, name), 'utf8');
const snapshot = (store: { syncExport(): ProjectedRecord[] }, kind: string, key?: string) => store.syncExport().find(item => item.kind === kind && (!key || item.id === key))!;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dailyhouse-sync-projection-')); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-04T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); rmSync(root, { recursive: true, force: true }); });

describe('application-owned private sync projection', () => {
  it('exports without rewriting even a missing local store and excludes device state', () => {
    const store = personal(); expect(store.syncExport()).toEqual([]); expect(existsSync(join(root, 'a-personal.json'))).toBe(false);
    store.addTodo({ title: 'Synthetic task' }); const before = bytes('a-personal.json');
    const result = store.syncExport(); expect(bytes('a-personal.json')).toBe(before);
    expect(JSON.stringify(result)).not.toMatch(/settings|vaultPath|calendarUrl|readingTechPath|lastReadVersion|projectActions/);
    expect(validateProjectedRecords(result)).toEqual(result);
  });

  it('round-trips notes, manual categories, finished status, timelines and links', () => {
    const a = personal(); const reading = a.addReading({ title: 'Synthetic course', url: 'https://example.com/course', type: 'course', category: 'science', notes: 'My own notes' });
    a.editReading(reading.id, { status: 'done', category: 'design', notes: 'Manual edited notes' });
    const idea = a.addIdea({ title: 'Synthetic idea', content: 'Original thought' }); a.addIdeaEntry(idea.id, { revision: idea.revision, kind: 'decision', content: 'Keep a narrow scope' });
    const plan = a.addLearning({ title: 'Synthetic plan', course: 'CS', goal: 'Learn a chapter', nextStep: 'Read section one' });
    a.addLearningEntry(plan.id, { revision: plan.revision, kind: 'resource', content: 'Reading', links: [{ title: 'A public example', url: 'https://example.com/paper' }], nextStep: 'Write notes' });
    a.addReadingTodo(reading.id); a.addLearningTodo(plan.id, { revision: a.learning(plan.id).revision });
    const b = personal('b'); b.syncApply(a.syncExport());
    expect(snapshot(b, 'reading', reading.id)).toEqual(snapshot(a, 'reading', reading.id));
    expect(snapshot(b, 'idea', idea.id)).toEqual(snapshot(a, 'idea', idea.id));
    expect(snapshot(b, 'learning', plan.id)).toEqual(snapshot(a, 'learning', plan.id));
    expect(b.reading().items[0]).toMatchObject({ notes: 'Manual edited notes', category: 'design', status: 'done', classification: { status: 'manual' } });
    expect(b.todos()).toHaveLength(2); new PersonalStore(join(root, 'b-personal.json'), undefined, join(root, 'b-reports'));
  });

  it('applies only explicit records and leaves unrelated local records/settings unchanged', () => {
    const a = personal(); const remote = a.addTodo({ title: 'Remote task' });
    const b = personal('b'); const own = b.addTodo({ title: 'Local task' }); const settings = b.settings();
    b.syncApply([snapshot(a, 'todo', remote.id)]); expect(b.todos().map(item => item.id)).toContain(own.id); expect(b.settings()).toEqual(settings);
    const before = bytes('b-personal.json'); b.syncApply([]); expect(bytes('b-personal.json')).toBe(before);
  });

  it('does not send or overwrite project-action todos before shared project identity exists', () => {
    const a = personal(); a.addTodo({ title: 'Normal task' });
    const saved = JSON.parse(bytes('a-personal.json')); const localId = randomUUID();
    saved.todos.push({ id: localId, title: 'Local project task', done: false, createdAt: new Date().toISOString(), dueDate: null, source: { kind: 'project_action', id: randomUUID(), projectId: 'local-tool-id', title: 'Local project', url: '#/projects' } });
    writeFileSync(join(root, 'a-personal.json'), JSON.stringify(saved)); const local = personal();
    expect(local.syncExport().some(item => item.id === localId)).toBe(false);
    const record = snapshot(local, 'todo'); record.id = localId; record.body!.id = localId;
    expect(() => local.syncApply([record])).toThrow('设备专属'); expect(local.todos()).toHaveLength(2);
  });

  it('is idempotent despite device-local revision differences and object key order', () => {
    const a = personal(); const idea = a.addIdea({ title: 'Stable idea', content: 'A thought' }); const plan = a.addLearning({ title: 'Stable plan' });
    a.editIdea(idea.id, { title: 'Same record', revision: idea.revision });
    const b = personal('b'); b.syncApply(a.syncExport()); expect(b.idea(idea.id).revision).not.toBe(a.idea(idea.id).revision);
    const before = bytes('b-personal.json'); const reordered = a.syncExport().map(item => ({ ...item, body: item.body ? Object.fromEntries(Object.entries(item.body).reverse()) : null }));
    b.syncApply(reordered); expect(bytes('b-personal.json')).toBe(before);
    expect(snapshot(b, 'learning', plan.id).body).not.toHaveProperty('revision'); expect(snapshot(b, 'idea').body).not.toHaveProperty('revision');
  });

  it('rejects same canonical source under another ID without losing either device edits', () => {
    const a = personal(); const value = a.addReading({ title: 'Existing notes', type: 'article', url: 'https://example.com/paper?utm_source=a', notes: 'Keep this' });
    const incoming = snapshot(a, 'reading'); incoming.id = randomUUID(); incoming.body!.id = incoming.id; incoming.body!.title = 'Other computer title'; incoming.body!.notes = 'Other computer notes';
    const before = bytes('a-personal.json'); expect(() => a.syncApply([incoming])).toThrow('相同来源'); expect(bytes('a-personal.json')).toBe(before); expect(a.reading().items[0].id).toBe(value.id);
  });

  it('rejects unknown and malformed nested fields before any partial write', () => {
    const a = personal(); a.addTodo({ title: 'Incoming task' }); const records = a.syncExport();
    const b = personal('b'); b.addTodo({ title: 'Unrelated local task' }); const before = bytes('b-personal.json');
    const bad = { ...records[0], id: randomUUID(), body: { ...records[0].body, id: randomUUID(), secret: 'synthetic-secret' } };
    expect(() => b.syncApply([...records, bad])).toThrow(); expect(bytes('b-personal.json')).toBe(before);
    expect(() => validateProjectedRecord({ kind: 'todo', id: randomUUID(), body: null, filePath: 'synthetic' })).toThrow();
    expect(() => validateProjectedRecord({ kind: 'unknown', id: '1', body: null })).toThrow();
    expect(() => validateProjectedRecord({ kind: 'journal', id: 'not-a-date', body: null })).toThrow();
    expect(() => validateProjectedRecords([records[0], records[0]])).toThrow();
  });

  it('propagates deletion, source suppression and an exact recovery deadline, then restores', () => {
    const a = personal(); const reading = a.addReading({ title: 'Remove later', type: 'article', url: 'https://example.com/remove' }); const idea = a.addIdea({ title: 'Idea', content: 'Keep its timeline' }); const plan = a.addLearning({ title: 'Plan' });
    const b = personal('b'); b.syncApply(a.syncExport()); a.deleteReading(reading.id); a.deleteIdea(idea.id, { revision: idea.revision }); a.deleteLearning(plan.id, { revision: plan.revision, confirmed: true });
    const deleted = a.syncExport(); b.syncApply(deleted);
    expect(b.reading().items).toHaveLength(0); expect(b.readingTrash().items[0].expiresAt).toBe(a.readingTrash().items[0].expiresAt);
    expect(b.ideas().items).toHaveLength(0); expect(b.learningPlans().items).toHaveLength(0);
    expect(snapshot(b, 'readingSuppression').body).toEqual(snapshot(a, 'readingSuppression').body);
    a.restoreReading({ ids: [reading.id] }); a.restoreIdea(idea.id, {}); a.restoreLearning(plan.id, { revision: plan.revision });
    const restore = a.syncExport(); expect(snapshot(a, 'readingSuppression').body).toBeNull(); b.syncApply(restore);
    expect(b.reading().items[0].id).toBe(reading.id); expect(b.idea(idea.id).id).toBe(idea.id); expect(b.learning(plan.id).id).toBe(plan.id);
  });

  it('keeps permanent deletion minimal after 30 days instead of exporting expired content', () => {
    const a = personal(); const idea = a.addIdea({ title: 'Private expired content', content: 'Private old thought' }); a.deleteIdea(idea.id, { revision: idea.revision });
    vi.advanceTimersByTime(31 * 86400000);
    const output = a.syncExport(); expect(snapshot(a, 'idea', idea.id).body).toBeNull(); expect(JSON.stringify(output)).not.toContain('Private old thought');
    const b = personal('b'); b.syncApply(output); expect(b.ideasTrash().items).toHaveLength(0); expect(snapshot(b, 'idea', idea.id).body).toBeNull();
  });

  it('rejects extending a recovery deadline and accepts legacy stable idea identities', () => {
    const a = personal(); const idea = a.addIdea({ title: 'Legacy content', content: 'Keep it' }); const incoming = snapshot(a, 'idea');
    incoming.id = 'legacy-1234567890abcdef12345678'; incoming.body!.id = incoming.id; const b = personal('b'); b.syncApply([incoming]); expect(b.idea(incoming.id).title).toBe('Legacy content');
    const bad = { ...incoming, deletedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 31 * 86400000).toISOString() }; expect(() => b.syncApply([bad])).toThrow();
  });

  it('sends only attachment metadata, retains local managed copies and never removes originals', async () => {
    const a = personal(); const original = join(root, 'original.txt'); writeFileSync(original, 'Synthetic local file');
    const upload = await a.readingAttachments.stage('original.txt', Readable.from(readFileSync(original))); const item = a.importQuickReading({ items: [{ uploadId: upload.uploadId, category: 'science' }] }).items[0];
    const projected = snapshot(a, 'reading', item.id); expect(projected.body!.attachmentMetadata).toMatchObject({ id: item.attachment!.id }); expect(projected.body).not.toHaveProperty('attachment'); expect(JSON.stringify(projected)).not.toMatch(/excerpt|downloadUrl|Synthetic local file/);
    const b = personal('b'); b.syncApply([projected]); expect(b.reading().items[0].attachment).toBeUndefined(); expect(() => b.readingAttachment(item.id)).toThrow();
    const copyPath = a.readingAttachment(item.id).path; projected.body!.notes = 'Remote note'; a.syncApply([projected]); expect(a.readingAttachment(item.id).path).toBe(copyPath);
    a.syncApply([{ kind: 'reading', id: item.id, body: null }]); expect(readFileSync(original, 'utf8')).toBe('Synthetic local file'); expect(existsSync(copyPath)).toBe(true);
    expect(snapshot(a, 'readingSuppression').id).toBe(item.sourceKey);
  });

  it('preserves device-local PDF version while applying shared report progress', () => {
    const a = personal(); a.addTodo({ title: 'Seed storage' }); const local = JSON.parse(bytes('a-personal.json')); local.readingReports['report:tech:2026-10-04'] = { status: 'unread', lastReadVersion: '100:1234' }; writeFileSync(join(root, 'a-personal.json'), JSON.stringify(local));
    const store = personal(); store.syncApply([{ kind: 'readingReport', id: 'report:tech:2026-10-04', body: { status: 'done', category: 'science', finishedAt: new Date().toISOString() } }]);
    expect(JSON.parse(bytes('a-personal.json')).readingReports['report:tech:2026-10-04'].lastReadVersion).toBe('100:1234'); expect(snapshot(store, 'readingReport').body).not.toHaveProperty('lastReadVersion');
  });

  it('sanitizes all nested fusion snapshots while retaining local AI records on apply', () => {
    const a = personal(); const gardenFile = join(root, 'a-garden.json'); const garden = new InspirationStore(gardenFile, a); const one = garden.add({ title: 'One', body: 'Idea one', tags: ['tag'] }); const two = garden.add({ title: 'Two', body: 'Idea two' });
    const merged = garden.merge({ ids: [one.id, two.id], title: 'Combined', body: 'A combination' });
    const saved = JSON.parse(bytes('a-garden.json')); const metadata = saved.metadata.find((item: any) => item.id === merged.id); metadata.drafts = [{ synthetic: 'local only draft' }]; metadata.sources[0].conversations = [{ synthetic: 'nested private context' }]; writeFileSync(gardenFile, JSON.stringify(saved)); const local = new InspirationStore(gardenFile, a);
    const output = local.syncExport(); expect(JSON.stringify(output)).not.toMatch(/conversations|drafts|nested private context/);
    const incoming = snapshot(local, 'ideaMeta', merged.id); incoming.body!.tags = ['new tag']; local.syncApply([incoming]); const result = JSON.parse(bytes('a-garden.json')).metadata.find((item: any) => item.id === merged.id);
    expect(result.drafts).toEqual(metadata.drafts); expect(result.sources[0].conversations).toEqual(metadata.sources[0].conversations);
    const b = personal('b'); b.syncApply(a.syncExport()); const remote = new InspirationStore(join(root, 'b-garden.json'), b); remote.syncApply(output); expect(snapshot(remote, 'ideaMeta', merged.id)).toEqual(snapshot(garden, 'ideaMeta', merged.id));
  });

  it('syncs legacy garden project summaries and deletion without external project side effects', () => {
    const a = personal(); const garden = new InspirationStore(join(root, 'a-garden.json'), a); const bubble = garden.add({ title: 'A garden idea', body: 'A thought' }); const project = garden.convert(bubble.id, { title: 'Example', goal: 'Small scope', mvp: ['A screen'], acceptance: ['Readable'], nextStep: 'Sketch' }).project;
    const b = personal('b'); b.syncApply(a.syncExport()); const remote = new InspirationStore(join(root, 'b-garden.json'), b); remote.syncApply(garden.syncExport()); expect(remote.projects().items[0].id).toBe(project.id);
    const directorySentinel = join(root, 'external-project-sentinel.txt'); writeFileSync(directorySentinel, 'Keep'); remote.syncApply([{ kind: 'gardenProject', id: project.id, body: null }]); expect(remote.projects().items).toHaveLength(0); expect(readFileSync(directorySentinel, 'utf8')).toBe('Keep');
    expect(snapshot(remote, 'gardenProject', project.id).body).toBeNull();
  });

  it('round-trips journal manual locks without device versions and retries without rewriting', () => {
    const a = journal(); const entry = a.create({ date: '2026-10-04', title: 'Synthetic journal', codex: 'Saved progress summary', life: 'A walk', lifeState: 'provided', reflection: 'A lesson' }); a.edit(entry.date, { revision: entry.revision, reflection: 'My manually edited reflection' });
    const b = journal('b'); b.syncApply(a.syncExport()); expect(b.get(entry.date).editedFields).toContain('reflection'); expect(b.get(entry.date).reflection).toBe('My manually edited reflection');
    expect(snapshot(b, 'journal').body).not.toHaveProperty('revision'); const before = bytes('b-journal.json'); b.syncApply(a.syncExport()); expect(bytes('b-journal.json')).toBe(before); new JournalStore(join(root, 'b-journal.json'));
  });

  it('rejects changed attachment identity without writing or touching the local copy', async () => {
    const store = personal(); const upload = await store.readingAttachments.stage('sample.txt', Readable.from('Synthetic original'));
    const item = store.importQuickReading({ items: [{ uploadId: upload.uploadId }] }).items[0]; const incoming = snapshot(store, 'reading', item.id);
    (incoming.body!.attachmentMetadata as Record<string, unknown>).id = `${'a'.repeat(64)}.txt`; incoming.body!.sourceKey = `file:${'a'.repeat(64)}`;
    const before = bytes('a-personal.json'); const path = store.readingAttachment(item.id).path;
    expect(() => store.syncApply([incoming])).toThrow('附件身份'); expect(bytes('a-personal.json')).toBe(before); expect(readFileSync(path, 'utf8')).toBe('Synthetic original');
  });

  it('rejects suppression-only mutations that would corrupt a recoverable journal', () => {
    const store = journal(); const entry = store.create({ date: '2026-10-04', reflection: 'Synthetic content' }); store.remove(entry.date, { revision: entry.revision, confirmed: true });
    const before = bytes('a-journal.json'); expect(() => store.syncApply([{ kind: 'journalSuppression', id: entry.date, body: null }])).toThrow(); expect(bytes('a-journal.json')).toBe(before); new JournalStore(join(root, 'a-journal.json'));
  });

  it('propagates journal deletion and suppression and restores the same date', () => {
    const a = journal(); const entry = a.create({ date: '2026-10-04', codex: 'A synthetic summary' }); const b = journal('b'); b.syncApply(a.syncExport()); a.remove(entry.date, { revision: entry.revision, confirmed: true }); b.syncApply(a.syncExport()); expect(() => b.publish({ date: entry.date, revision: 0, codex: 'Do not revive' })).toThrow();
    a.restore(entry.date, { revision: entry.revision }); const restored = a.syncExport(); expect(snapshot(a, 'journalSuppression').body).toBeNull(); b.syncApply(restored); expect(b.get(entry.date).codex).toBe('A synthetic summary'); new JournalStore(join(root, 'b-journal.json'));
  });

  it('persists an explicit todo deletion in the same owned file and replays it after restart', () => {
    const a = personal(); const todo = a.addTodo({ title: 'A deleted task' }); const b = personal('b'); b.syncApply(a.syncExport());
    const deletedAt = new Date().toISOString(); a.deleteTodo(todo.id);
    const tombstone = { kind: 'todo', id: todo.id, body: null, deletedAt };
    expect(JSON.parse(bytes('a-personal.json')).syncTombstones).toContainEqual(tombstone);
    expect(snapshot(personal(), 'todo', todo.id)).toEqual(tombstone);
    b.syncApply(personal().syncExport()); expect(b.todos()).toHaveLength(0);
    expect(snapshot(personal('b'), 'todo', todo.id)).toEqual(tombstone);
  });

  it('never manufactures deletion records from a lost or reset local source with a saved baseline', () => {
    const old = personal(); old.addTodo({ title: 'A task already saved remotely' });
    const baseline = old.syncExport(); const sidecar = join(root, 'private-sync.json'); writeFileSync(sidecar, JSON.stringify({ baseline }));
    const sidecarBefore = readFileSync(sidecar, 'utf8'); rmSync(join(root, 'a-personal.json'));
    const missing = personal(); expect(missing.syncExport()).toEqual([]); expect(existsSync(join(root, 'a-personal.json'))).toBe(false);
    missing.addTodo({ title: 'A new task on the empty device' }); const reset = JSON.parse(bytes('a-personal.json')); reset.todos = [];
    writeFileSync(join(root, 'a-personal.json'), JSON.stringify(reset)); const loaded = personal();
    expect(loaded.syncExport()).toEqual([]); loaded.updateSettings({ animationEnabled: false }); expect(loaded.syncExport()).toEqual([]);
    expect(readFileSync(sidecar, 'utf8')).toBe(sidecarBefore);
  });

  it('retains inbound null records on an empty device and retries without rewriting', () => {
    const removals: ProjectedRecord[] = [
      { kind: 'todo', id: randomUUID(), body: null, deletedAt: new Date().toISOString() },
      { kind: 'learning', id: randomUUID(), body: null, deletedAt: new Date().toISOString() },
      { kind: 'readingSuppression', id: 'https://example.com/restored-source', body: null },
    ];
    const store = personal(); store.syncApply(removals); const restarted = personal();
    expect(restarted.syncExport()).toEqual(expect.arrayContaining(removals)); const before = bytes('a-personal.json'); restarted.syncApply(removals); expect(bytes('a-personal.json')).toBe(before);
    const source = personal('b'); const live = source.addTodo({ title: 'Explicitly restored' }); const shared = snapshot(source, 'todo'); shared.id = removals[0].id; shared.body!.id = shared.id;
    restarted.syncApply([shared]); expect(snapshot(personal(), 'todo', shared.id).body!.title).toBe(live.title);
    expect(JSON.parse(bytes('a-personal.json')).syncTombstones.some((item: ProjectedRecord) => item.kind === 'todo' && item.id === shared.id)).toBe(false);
  });

  it('keeps the original deletion date at the 30-day boundary before and after local cleanup', () => {
    const store = personal(); const reading = store.addReading({ title: 'A course', url: 'https://example.com/expired', type: 'course' }); const idea = store.addIdea({ title: 'An idea', content: 'Private expired text' }); const plan = store.addLearning({ title: 'A plan' });
    const deletedAt = new Date().toISOString(); store.deleteReading(reading.id); store.deleteIdea(idea.id, { revision: idea.revision }); store.deleteLearning(plan.id, { revision: plan.revision, confirmed: true });
    vi.advanceTimersByTime(30 * 86400000);
    for (const [kind, id] of [['reading', reading.id], ['idea', idea.id], ['learning', plan.id]]) expect(snapshot(store, kind, id)).toEqual({ kind, id, body: null, deletedAt });
    store.updateSettings({ animationEnabled: false }); const restarted = personal();
    for (const [kind, id] of [['reading', reading.id], ['idea', idea.id], ['learning', plan.id]]) expect(snapshot(restarted, kind, id)).toEqual({ kind, id, body: null, deletedAt });
    expect(bytes('a-personal.json')).not.toContain('Private expired text'); expect(validateProjectedRecords(restarted.syncExport())).toEqual(restarted.syncExport());
  });

  it('rejects saved non-null deletion metadata without rewriting or reading external files', () => {
    const store = personal(); store.addTodo({ title: 'A task' }); const saved = JSON.parse(bytes('a-personal.json')); saved.syncTombstones = [snapshot(store, 'todo')];
    writeFileSync(join(root, 'a-personal.json'), JSON.stringify(saved)); const before = bytes('a-personal.json'); expect(() => personal()).toThrow(); expect(bytes('a-personal.json')).toBe(before);
    saved.syncTombstones = [{ kind: 'todo', id: randomUUID(), body: null, path: join(root, 'external.txt') }]; writeFileSync(join(root, 'external.txt'), 'Keep original'); writeFileSync(join(root, 'a-personal.json'), JSON.stringify(saved));
    expect(() => personal()).toThrow(); expect(readFileSync(join(root, 'external.txt'), 'utf8')).toBe('Keep original');
  });

  it('propagates garden metadata deletion and keeps inbound null metadata after restart', () => {
    const a = personal(); const garden = new InspirationStore(join(root, 'a-garden.json'), a); const idea = garden.add({ title: 'A removed idea', body: 'Its thought', tags: ['saved'] });
    const b = personal('b'); b.syncApply(a.syncExport()); const remote = new InspirationStore(join(root, 'b-garden.json'), b); remote.syncApply(garden.syncExport());
    garden.remove(idea.id, 'bubble', idea.revision); const deletedAt = garden.trash('bubble').items[0].deletedAt; garden.purge(idea.id, 'bubble', { deletedAt });
    const tombstone = snapshot(garden, 'ideaMeta', idea.id); expect(tombstone).toMatchObject({ kind: 'ideaMeta', id: idea.id, body: null });
    remote.syncApply([tombstone]); expect(snapshot(new InspirationStore(join(root, 'b-garden.json'), b), 'ideaMeta', idea.id)).toEqual(tombstone);
    const empty = new InspirationStore(join(root, 'empty-garden.json'), personal('empty')); empty.syncApply([tombstone]); expect(snapshot(new InspirationStore(join(root, 'empty-garden.json'), personal('empty')), 'ideaMeta', idea.id)).toEqual(tombstone);
  });

  it('keeps journal suppression removal on disk so restored content stays restored on another device', () => {
    const a = journal(); const entry = a.create({ date: '2026-10-04', reflection: 'A retained thought' }); const b = journal('b'); b.syncApply(a.syncExport());
    a.remove(entry.date, { revision: entry.revision, confirmed: true }); b.syncApply(a.syncExport()); a.restore(entry.date, { revision: entry.revision });
    const restarted = journal(); const removedSuppression = snapshot(restarted, 'journalSuppression', entry.date); expect(removedSuppression.body).toBeNull();
    b.syncApply(restarted.syncExport()); expect(journal('b').get(entry.date).reflection).toBe('A retained thought'); expect(snapshot(journal('b'), 'journalSuppression', entry.date)).toEqual(removedSuppression);
  });
});
