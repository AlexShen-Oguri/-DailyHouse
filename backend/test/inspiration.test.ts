import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InspirationStore, INSPIRATION_TRASH_MS } from '../src/personal/inspiration-store';
import { InspirationError, type InspirationProvider, type InspirationDirection } from '../src/personal/inspiration-ai';
import { PersonalStore } from '../src/personal/store';

let root: string;
let file: string;
let canonical: PersonalStore;
const direction = (title: string): InspirationDirection => ({ title, goal: 'Create an interactive gift', mvp: ['One flower'], assumptions: ['One recipient'], risks: ['Interaction may be unclear'], acceptance: ['Recipient finishes unaided'], firstStep: 'Draw three screens' });
const directions = [direction('Game'), direction('Letter'), direction('Workshop')];
function provider(): InspirationProvider { return { status: () => ({ configured: true, provider: 'ollama', model: 'fixture', message: 'Ready' }), brainstorm: vi.fn(async () => ({ model: 'fixture', directions: structuredClone(directions) })) }; }
const projectInput = { title: 'Bouquet game', goal: 'Deliver a playable gift', mvp: ['One level'], acceptance: ['Can finish it'], nextStep: 'Draw the first screen' };
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'garden-inspiration-')); file = join(root, 'garden.json'); canonical = new PersonalStore(join(root, 'personal.json'), undefined, join(root, 'reports')); });
afterEach(() => { vi.useRealTimers(); rmSync(root, { recursive: true, force: true }); });

describe('inspiration garden lifecycle', () => {
  it('uses canonical idea IDs and timelines without persisting a second editable copy', async () => {
    const store = new InspirationStore(file, canonical, provider());
    const initial = canonical.addIdea({ title: 'From the timeline', content: 'Original fragment' });
    expect((await store.bubbles()).items[0].id).toBe(initial.id);
    const updated = canonical.addIdeaEntry(initial.id, { revision: initial.revision, kind: 'note', content: 'An additional fragment' });
    expect((await store.bubbles()).items[0].body).toBe('Original fragment\n\nAn additional fragment');
    store.edit(initial.id, { revision: updated.revision, tags: ['gift'] });
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.metadata[0]).not.toHaveProperty('body'); expect(saved.metadata[0]).not.toHaveProperty('title'); expect(saved).not.toHaveProperty('bubbles');
    const newer = canonical.idea(initial.id);
    expect(() => store.edit(initial.id, { tags: ['overwrite'] })).toThrow();
    expect(() => store.edit(initial.id, { revision: initial.revision, tags: ['stale'] })).toThrow();
    canonical.deleteIdea(initial.id, { revision: newer.revision });
    expect((await store.bubbles()).items).toEqual([]);
    store.restore({ ids: [initial.id] }, 'bubble');
    expect(canonical.idea(initial.id).entries.map(e => e.content)).toEqual(['Original fragment', 'An additional fragment']);
    expect((await store.bubbles()).items[0].tags).toEqual(['gift']);
  });
  it('merges into a new node, preserves source snapshots through edits/removal, and allows unlinking only existing parents', async () => {
    const store = new InspirationStore(file, canonical, provider());
    const game = store.add({ title: 'Game', body: 'A short game', tags: ['play', 'play'] });
    const flower = store.add({ title: 'Flowers', body: 'Electronic bouquet' });
    const merged = store.merge({ ids: [game.id, flower.id], title: 'Bouquet game', body: 'Play to send flowers' });
    expect((await store.bubbles()).items).toHaveLength(3);
    expect(merged.sources.map(s => s.title)).toEqual(['Game', 'Flowers']);
    store.edit(game.id, { revision: canonical.idea(game.id).revision, title: 'Changed game' }); store.remove(flower.id, 'bubble', canonical.idea(flower.id).revision);
    expect((await store.bubbles()).items.find(i => i.id === merged.id)?.sources).toEqual(merged.sources);
    expect(() => store.edit(merged.id, { revision: canonical.idea(merged.id).revision, sourceIds: [merged.id] })).toThrow();
    expect(store.edit(merged.id, { revision: canonical.idea(merged.id).revision, sourceIds: [game.id] }).sources).toHaveLength(1);
    store.restore({ ids: [flower.id] }, 'bubble');
    expect((await new InspirationStore(file, canonical, provider()).bubbles()).items.find(i => i.id === flower.id)?.body).toBe('Electronic bouquet');
    expect(game.tags).toEqual(['play']);
  });
  it('validates the complete merge before committing and never partially restores a batch', async () => {
    const store = new InspirationStore(file, canonical, provider());
    const a = store.add({ title: 'A' }), b = store.add({ title: 'B' });
    const before = readFileSync(file, 'utf8');
    expect(() => store.merge({ ids: [a.id, b.id], title: '' })).toThrow();
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(() => store.merge({ ids: [a.id, a.id], title: 'Duplicate' })).toThrow();
    store.remove(a.id, 'bubble', canonical.idea(a.id).revision);
    expect(() => store.restore({ ids: [a.id, 'missing'] }, 'bubble')).toThrow();
    expect((await store.bubbles()).items).toHaveLength(1);
  });
  it('expires removed snapshots after thirty days while preserving derived-source history', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));
    const store = new InspirationStore(file, canonical, provider()); const a = store.add({ title: 'Private draft', body: 'Expired body' }); store.remove(a.id, 'bubble', canonical.idea(a.id).revision);
    vi.setSystemTime(new Date(Date.now() + INSPIRATION_TRASH_MS));
    expect(store.trash('bubble').items).toHaveLength(0);
    expect(() => store.restore({ ids: [a.id] }, 'bubble')).toThrowError(expect.objectContaining({ status: 410 }));
    store.add({ title: 'Trigger persistence' });
    expect(readFileSync(join(root, 'personal.json'), 'utf8')).not.toContain('Expired body');
    expect(() => new InspirationStore(file, canonical, provider()).restore({ ids: [a.id] }, 'bubble')).toThrowError(expect.objectContaining({ status: 410 }));
  });
  it('confirms projects idempotently, keeps bidirectional links, and protects edited projects from undo', async () => {
    const store = new InspirationStore(file, canonical, provider()); const bubble = store.add({ title: 'Flower' });
    const first = store.convert(bubble.id, projectInput);
    expect(first.created).toBe(true);
    expect(store.convert(bubble.id, projectInput)).toEqual({ project: first.project, created: false });
    expect((await store.bubbles()).items[0].projectId).toBe(first.project.id);
    store.edit(bubble.id, { revision: canonical.idea(bubble.id).revision, title: 'A changed idea' });
    expect(store.projects().items[0].sourceSnapshot.title).toBe('Flower');
    store.editProject(first.project.id, { revision: store.projects().items.find(p => p.id === first.project.id)!.revision, goal: 'Changed project goal' });
    expect(() => store.undoConversion(bubble.id)).toThrowError(expect.objectContaining({ status: 409 }));
    store.remove(first.project.id, 'project');
    expect(() => store.convert(bubble.id, projectInput)).toThrowError(expect.objectContaining({ status: 409 }));
    store.restore({ ids: [first.project.id] }, 'project');
    expect(store.projects().items[0].goal).toBe('Changed project goal');
  });
  it('undoes untouched conversion without deleting the idea and restores associations atomically', async () => {
    const store = new InspirationStore(file, canonical, provider()); const bubble = store.add({ title: 'Flower' });
    const { project } = store.convert(bubble.id, projectInput);
    expect(store.undoConversion(bubble.id)).toEqual({ undone: true, projectId: project.id });
    expect((await store.bubbles()).items[0].projectId).toBeUndefined();
    store.restore({ ids: [project.id] }, 'project');
    expect((await store.bubbles()).items[0].projectId).toBe(project.id);
    store.undoConversion(bubble.id);
    const replacement = store.convert(bubble.id, projectInput);
    expect(() => store.restore({ ids: [project.id] }, 'project')).toThrowError(expect.objectContaining({ status: 409 }));
    expect(store.projects().items.map(p => p.id)).toEqual([replacement.project.id]);
  });
  it('deduplicates project tasks across retries/restart and never recreates a manually deleted task', () => {
    const store = new InspirationStore(file, canonical, provider()); const todos = canonical;
    const bubble = store.add({ title: 'Flower' }); const { project } = store.convert(bubble.id, projectInput);
    const first = store.addTodo(project.id, todos), second = store.addTodo(project.id, todos);
    expect(first.created).toBe(true); expect(second.created).toBe(false); expect(first.todoId).toBe(second.todoId); expect(todos.todos()).toHaveLength(1);
    expect(() => store.undoConversion(bubble.id)).toThrowError(expect.objectContaining({ status: 409 }));
    todos.deleteTodo(first.todoId);
    const restarted = new InspirationStore(file, canonical, provider());
    expect(restarted.addTodo(project.id, todos)).toMatchObject({ todoId: first.todoId, deleted: true, created: false });
    expect(todos.todos()).toHaveLength(0);
    restarted.editProject(project.id, { revision: restarted.projects().items[0].revision, nextStep: 'Build a prototype' });
    expect(restarted.addTodo(project.id, todos).created).toBe(true); expect(todos.todos()[0].title).toBe('Build a prototype');
  });
  it('recovers task linking after the todo save succeeds but the garden save fails', () => {
    const store = new InspirationStore(file, canonical, provider()); const todos = canonical;
    const { project } = store.convert(store.add({ title: 'Flower' }).id, projectInput);
    const actual = todos.addProjectTodo.bind(todos);
    const interrupted = { addProjectTodo(key: string, title: string) { actual(key, title); throw new Error('Crash after todo commit'); } };
    expect(() => store.addTodo(project.id, interrupted)).toThrow('Crash');
    expect(todos.todos()).toHaveLength(1);
    const result = new InspirationStore(file, canonical, provider()).addTodo(project.id, todos);
    expect(result.created).toBe(false); expect(todos.todos()).toHaveLength(1); expect(result.todoId).toBe(todos.todos()[0].id);
  });
  it('records completion, reopens projects, and keeps task content independent from project changes', () => {
    const store = new InspirationStore(file, canonical, provider()); const { project } = store.convert(store.add({ title: 'Flower' }).id, projectInput);
    expect(store.editProject(project.id, { revision: store.projects().items[0].revision, status: 'done' }).finishedAt).toBeTruthy();
    expect(store.editProject(project.id, { revision: store.projects().items[0].revision, status: 'active' }).finishedAt).toBeUndefined();
    expect(() => store.editProject(project.id, { sourceBubbleId: 'arbitrary' })).toThrow();
  });
  it('allows explicit new confirmation after a removed project has expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));
    const store = new InspirationStore(file, canonical, provider()), bubble = store.add({ title: 'Flower' });
    const original = store.convert(bubble.id, projectInput).project;
    store.remove(original.id, 'project');
    vi.setSystemTime(new Date(Date.now() + INSPIRATION_TRASH_MS));
    expect((await store.bubbles()).items[0].projectId).toBeUndefined();
    const replacement = store.convert(bubble.id, projectInput);
    expect(replacement.created).toBe(true); expect(replacement.project.id).not.toBe(original.id);
    expect(store.convert(bubble.id, projectInput).created).toBe(false);
    expect(() => store.restore({ ids: [original.id] }, 'project')).toThrowError(expect.objectContaining({ status: 410 }));
  });
});

describe('controlled brainstorm drafts', () => {
  it('sends only selected idea/source snapshots, stores editable separate drafts, and never creates projects implicitly', async () => {
    const ai = provider(), store = new InspirationStore(file, canonical, ai);
    const a = store.add({ title: 'A', body: 'Chosen parent' }), b = store.add({ title: 'B', body: 'Unselected parent secret' }); store.add({ title: 'Private unrelated', body: 'Never send' });
    const merged = store.merge({ ids: [a.id, b.id], title: 'Combination', body: 'My authored relation' });
    const draft = await store.brainstorm(merged.id, { purpose: 'directions', context: 'One weekend', includeSourceIds: [a.id], language: 'en' });
    expect(ai.brainstorm).toHaveBeenCalledWith({ title: 'Combination', body: 'My authored relation', sources: [{ title: 'A', body: 'Chosen parent' }], purpose: 'directions', context: 'One weekend', language: 'en' }, undefined);
    expect(store.projects().items).toEqual([]);
    const revised = draft.directions.map(d => ({ ...d, goal: 'My revised goal' }));
    expect(store.editDraft(merged.id, draft.id, { expectedUpdatedAt: draft.updatedAt, directions: revised }).directions[0].goal).toBe('My revised goal');
    expect((await store.bubbles()).items.find(b => b.id === merged.id)?.body).toBe('My authored relation');
    store.removeDraft(merged.id, draft.id);
    expect((await store.bubbles()).items.find(b => b.id === merged.id)?.drafts).toEqual([]);
  });
  it('allows retry after provider failure and never overwrites changed or removed ideas', async () => {
    const ai = provider(), store = new InspirationStore(file, canonical, ai), bubble = store.add({ title: 'Flower' });
    vi.mocked(ai.brainstorm).mockRejectedValueOnce(new InspirationError('失败', 'Failed', 503));
    await expect(store.brainstorm(bubble.id, { purpose: 'mvp' })).rejects.toMatchObject({ status: 503 });
    expect((await store.bubbles()).items[0].drafts).toEqual([]);
    let finish!: (v: { model: string; directions: InspirationDirection[] }) => void;
    vi.mocked(ai.brainstorm).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = store.brainstorm(bubble.id, { purpose: 'mvp' });
    await expect(store.brainstorm(bubble.id, { purpose: 'mvp' })).rejects.toMatchObject({ status: 409 });
    canonical.addIdeaEntry(bubble.id, { kind: 'note', content: 'New content', revision: canonical.idea(bubble.id).revision }); finish({ model: 'fixture', directions });
    await expect(pending).rejects.toMatchObject({ status: 409 });
    expect((await store.bubbles()).items[0].drafts).toEqual([]);
    await store.brainstorm(bubble.id, { purpose: 'mvp' });
    expect((await store.bubbles()).items[0].drafts).toHaveLength(1);
  });
  it('honors cancellation even when a provider returns a result after abort', async () => {
    const ai = provider(), store = new InspirationStore(file, canonical, ai), bubble = store.add({ title: 'Flower' }), controller = new AbortController();
    vi.mocked(ai.brainstorm).mockImplementationOnce(async () => { controller.abort(); return { model: 'fixture', directions }; });
    await expect(store.brainstorm(bubble.id, { purpose: 'directions' }, controller.signal)).rejects.toMatchObject({ status: 499 });
    expect((await store.bubbles()).items[0].drafts).toEqual([]);
  });
  it('checks the reviewed canonical revision and sends an editable excerpt without changing the timeline', async () => {
    const ai = provider(), store = new InspirationStore(file, canonical, ai), bubble = store.add({ title: 'Flower', body: 'Original long idea' });
    await expect(store.brainstorm(bubble.id, { purpose: 'directions', expectedRevision: 99 })).rejects.toMatchObject({ status: 409 });
    expect(ai.brainstorm).not.toHaveBeenCalled();
    await store.brainstorm(bubble.id, { purpose: 'directions', expectedRevision: bubble.revision, ideaExcerpt: 'Only this selected excerpt' });
    expect(vi.mocked(ai.brainstorm).mock.calls[0][0].body).toBe('Only this selected excerpt');
    expect(canonical.idea(bubble.id).entries[0].content).toBe('Original long idea');
  });
});
