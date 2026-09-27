import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { createPersonalApp } from '../src/personal/app';
import { PersonalStore } from '../src/personal/store';
import { PersonalError, type Idea } from '../src/personal/types';
import { IDEAS_TRASH_MS } from '../src/personal/ideas';

let root: string;
let file: string;
let server: Server | undefined;
const instant = new Date('2026-09-28T12:00:00.000Z');
const makeStore = () => new PersonalStore(file, undefined, join(root, 'reports'));
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'garden-ideas-'));
  file = join(root, 'personal.json');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(instant);
});
afterEach(async () => {
  vi.useRealTimers();
  if (server) {
    const closing = new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closing;
    server = undefined;
  }
  rmSync(root, { recursive: true, force: true });
});

describe('idea timelines', () => {
  it('creates a dedicated idea, appends several updates in stable order, and reloads them', () => {
    const store = makeStore();
    const first = store.addIdea({ title: '  Walking game  ', content: '  Start with one little character.  ' });
    expect(first).toMatchObject({ title: 'Walking game', status: 'growing', revision: 1, createdAt: instant.toISOString() });
    expect(first.entries).toHaveLength(1);
    expect(first.entries[0]).toMatchObject({ kind: 'initial', content: 'Start with one little character.' });
    const note = store.addIdeaEntry(first.id, { revision: first.revision, kind: 'note', content: 'Use a small island.' });
    const progress = store.addIdeaEntry(first.id, { revision: note.revision, kind: 'progress', content: 'Movement prototype works.' });
    vi.setSystemTime(new Date(instant.valueOf() - 60000));
    const decision = store.addIdeaEntry(first.id, { revision: progress.revision, kind: 'decision', content: 'Keep the first version single player.' });
    expect(decision.revision).toBe(4);
    expect(decision.entries.map(entry => entry.kind)).toEqual(['initial', 'note', 'progress', 'decision']);
    expect(decision.entries.map(entry => entry.createdAt)).toEqual([...decision.entries.map(entry => entry.createdAt)].sort());
    expect(makeStore().idea(first.id)).toEqual(decision);
    expect(store.ideas().items).toEqual([{ id: decision.id, title: decision.title, status: decision.status, createdAt: decision.createdAt, updatedAt: decision.updatedAt, revision: 4, preview: 'Keep the first version single player.', entryCount: 4 }]);
  });

  it('edits initial and later entries in place, retains creation dates, and deletes updates and the idea', () => {
    const store = makeStore();
    const first = store.addIdea({ title: 'Initial title', content: 'Original description' });
    let idea = store.addIdeaEntry(first.id, { revision: 1, kind: 'question', content: 'Is this feasible?' });
    const entry = idea.entries[1];
    idea = store.editIdeaEntry(idea.id, entry.id, { revision: idea.revision, kind: 'decision', content: 'Yes, build a small prototype.' });
    expect(idea.entries[1]).toMatchObject({ id: entry.id, kind: 'decision', createdAt: entry.createdAt });
    expect(idea.entries[1].updatedAt).not.toBe(entry.updatedAt);
    idea = store.editIdeaEntry(idea.id, first.entries[0].id, { revision: idea.revision, content: 'Revised starting point' });
    expect(idea.entries[0]).toMatchObject({ kind: 'initial', createdAt: first.entries[0].createdAt, content: 'Revised starting point' });
    idea = store.editIdea(idea.id, { revision: idea.revision, title: 'Better title', status: 'parked' });
    expect(idea).toMatchObject({ title: 'Better title', status: 'parked', createdAt: first.createdAt });
    idea = store.deleteIdeaEntry(idea.id, entry.id, { revision: idea.revision });
    expect(idea.entries).toHaveLength(1);
    expect(makeStore().idea(idea.id)).toEqual(idea);
    store.deleteIdea(idea.id, { revision: idea.revision });
    expect(makeStore().ideas().items).toEqual([]);
    expect(makeStore().ideasTrash().items[0]).toMatchObject({ id: idea.id, entryCount: 1 });
    expect(() => store.idea(idea.id)).toThrow('不存在');
  });

  it('restores a whole timeline with its original IDs and dates but a fresh revision', () => {
    const store = makeStore();
    const first = store.addIdea({ title: 'Keep this history', content: 'Starting point' });
    const idea = store.addIdeaEntry(first.id, { revision: 1, kind: 'progress', content: 'First result' });
    store.deleteIdea(idea.id, { revision: idea.revision });
    const reloaded = makeStore();
    expect(reloaded.ideas().items).toEqual([]);
    expect(reloaded.ideasTrash().items).toEqual([{ ...store.ideasTrash().items[0], deletedAt: instant.toISOString(), expiresAt: new Date(instant.valueOf() + IDEAS_TRASH_MS).toISOString() }]);
    const before = readFileSync(file, 'utf8');
    reloaded.ideasTrash();
    expect(readFileSync(file, 'utf8')).toBe(before);
    vi.setSystemTime(new Date(instant.valueOf() + 3600000));
    const restored = reloaded.restoreIdea(idea.id, {});
    expect(restored).toMatchObject({ id: idea.id, title: idea.title, createdAt: idea.createdAt, revision: idea.revision + 1, entries: idea.entries });
    expect(Date.parse(restored.updatedAt)).toBeGreaterThan(Date.parse(idea.updatedAt));
    expect(makeStore().idea(idea.id)).toEqual(restored);
    expect(makeStore().ideasTrash().items).toEqual([]);
    expect(() => reloaded.editIdea(idea.id, { revision: idea.revision, title: 'Old tab' })).toThrow('其他页面更新');
    expect(() => reloaded.restoreIdea(idea.id, {})).toThrow('无法重复恢复');
    reloaded.deleteIdea(idea.id, { revision: restored.revision });
    expect(makeStore().ideasTrash().items).toHaveLength(1);
  });

  it('hides expired snapshots without writing and removes them on the next explicit mutation', () => {
    const store = makeStore();
    const idea = store.addIdea({ title: 'Expired', content: 'Old history' });
    store.deleteIdea(idea.id, { revision: 1 });
    const before = readFileSync(file, 'utf8');
    vi.setSystemTime(new Date(instant.valueOf() + IDEAS_TRASH_MS));
    const reloaded = makeStore();
    expect(reloaded.ideasTrash().items).toEqual([]);
    try { reloaded.restoreIdea(idea.id, {}); throw new Error('Expected expiry'); } catch (error) { expect((error as PersonalError).status).toBe(410); }
    expect(readFileSync(file, 'utf8')).toBe(before);
    const todo = reloaded.addTodo({ title: 'Explicit unrelated mutation' });
    expect(JSON.parse(readFileSync(file, 'utf8')).ideasTrash).toEqual([]);
    expect(makeStore().todos()).toEqual([todo]);
    expect(makeStore().ideas().items).toEqual([]);
    expect(() => makeStore().restoreIdea(idea.id, {})).toThrow('不存在或已过期');
  });

  it('preserves extension references through deletion and restore and validates restore bodies', () => {
    const store = makeStore();
    const idea = store.addIdea({ title: 'Shared idea', content: 'Shared timeline' });
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    saved.inspirationMetadata = { [idea.id]: { project: 'Keep this reference' } };
    writeFileSync(file, JSON.stringify(saved));
    const reloaded = makeStore();
    reloaded.deleteIdea(idea.id, { revision: 1 });
    const before = readFileSync(file, 'utf8');
    for (const body of [null, [], { revision: 1 }, { title: 'Injected' }]) expect(() => reloaded.restoreIdea(idea.id, body)).toThrow();
    expect(readFileSync(file, 'utf8')).toBe(before);
    reloaded.restoreIdea(idea.id, {});
    expect(JSON.parse(readFileSync(file, 'utf8')).inspirationMetadata).toEqual(saved.inspirationMetadata);
  });

  it('refuses restoration into a full library and fails closed for invalid saved trash', () => {
    const store = makeStore();
    const idea = store.addIdea({ title: 'Recovery', content: 'Complete history' });
    store.deleteIdea(idea.id, { revision: 1 });
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    saved.ideas = Array.from({ length: 5000 }, (_, index) => ({ ...idea, id: `existing-${index}` }));
    writeFileSync(file, JSON.stringify(saved));
    const before = readFileSync(file, 'utf8');
    expect(() => makeStore().restoreIdea(idea.id, {})).toThrow('5000');
    expect(readFileSync(file, 'utf8')).toBe(before);
    saved.ideas = [];
    saved.ideasTrash[0].expiresAt = 'invalid';
    writeFileSync(file, JSON.stringify(saved));
    expect(() => makeStore()).toThrow('idea trash is invalid');
  });

  it('retries internal fixed-ID creation idempotently without overwriting later user edits', () => {
    const store = makeStore();
    const id = 'c9f2eec0-a4d1-453c-a5d2-04f3943a95b7';
    const original = store.addIdeaWithId(id, { title: 'Extension seed', content: 'Original seed' });
    const retry = store.addIdeaWithId(id.toUpperCase(), { title: 'Retry title', content: 'Retry content' });
    expect(retry).toEqual(original);
    const edited = store.editIdea(id, { revision: 1, title: 'User renamed this' });
    const before = readFileSync(file, 'utf8');
    const later = makeStore().addIdeaWithId(id, { title: 'Old request', content: 'Stale source content' });
    expect(later).toEqual(edited);
    later.entries[0].content = 'Mutated response';
    expect(store.idea(id).entries[0].content).toBe(original.entries[0].content);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(makeStore().ideas().items).toHaveLength(1);
    for (const invalidId of ['', 'arbitrary', '../file', 'c9f2eec0-a4d1-053c-a5d2-04f3943a95b7']) expect(() => store.addIdeaWithId(invalidId, { title: 'Invalid', content: 'Invalid' })).toThrow('UUID');
  });

  it('never silently recreates a deleted fixed ID, including after the recovery snapshot expires', () => {
    const id = 'c9f2eec0-a4d1-453c-a5d2-04f3943a95b7';
    const store = makeStore();
    const idea = store.addIdeaWithId(id, { title: 'Source idea', content: 'Captured once' });
    store.deleteIdea(id, { revision: idea.revision });
    const retry = (target: PersonalStore) => target.addIdeaWithId(id, { title: 'Retry', content: 'Retry' });
    expect(() => retry(store)).toThrow('曾被删除');
    expect(() => retry(makeStore())).toThrow('曾被删除');
    const restored = store.restoreIdea(id, {});
    expect(retry(store)).toEqual(restored);
    store.deleteIdea(id, { revision: restored.revision });
    vi.setSystemTime(new Date(instant.valueOf() + IDEAS_TRASH_MS));
    store.addTodo({ title: 'Expire snapshots' });
    const persisted = JSON.parse(readFileSync(file, 'utf8'));
    expect(persisted.ideasTrash).toEqual([]);
    expect(persisted.ideasRemovedIds).toEqual([id]);
    const before = readFileSync(file, 'utf8');
    expect(() => retry(makeStore())).toThrow('曾被删除');
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(makeStore().ideas().items).toEqual([]);
  });

  it('derives deletion IDs from older trash in memory and validates stored tombstones', () => {
    const id = 'c9f2eec0-a4d1-453c-a5d2-04f3943a95b7';
    const store = makeStore();
    const idea = store.addIdeaWithId(id, { title: 'Old trash', content: 'Keep deleted' });
    store.deleteIdea(id, { revision: idea.revision });
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    delete saved.ideasRemovedIds;
    writeFileSync(file, JSON.stringify(saved));
    const before = readFileSync(file, 'utf8');
    const reloaded = makeStore();
    expect(() => reloaded.addIdeaWithId(id, { title: 'Retry', content: 'Retry' })).toThrow('曾被删除');
    expect(readFileSync(file, 'utf8')).toBe(before);
    vi.setSystemTime(new Date(instant.valueOf() + IDEAS_TRASH_MS));
    reloaded.addTodo({ title: 'Expire old trash' });
    expect(JSON.parse(readFileSync(file, 'utf8')).ideasRemovedIds).toEqual([id]);
    saved.ideasRemovedIds = [null];
    writeFileSync(file, JSON.stringify(saved));
    expect(() => makeStore()).toThrow('deleted idea IDs are invalid');
  });

  it('preserves personal settings, unrelated records and other ideas through every deletion', () => {
    const store = makeStore();
    const todo = store.addTodo({ title: 'Keep this task' });
    const reading = store.addReading({ title: 'Keep this book', type: 'book', notes: 'Private notes', category: 'science' });
    store.updateSettings({ animationEnabled: false });
    const first = store.addIdea({ title: 'Remove', content: 'An abandoned thought' });
    const second = store.addIdea({ title: 'Keep', content: 'A useful thought' });
    store.deleteIdea(first.id, { revision: first.revision });
    const reloaded = makeStore();
    expect(reloaded.todos()).toEqual([todo]);
    expect(reloaded.reading().items).toEqual([reading]);
    expect(reloaded.settings().animationEnabled).toBe(false);
    expect(reloaded.idea(second.id)).toEqual(second);
  });

  it('returns isolated copies and latest-update summaries without exposing every timeline', () => {
    const store = makeStore();
    const a = store.addIdea({ title: 'First', content: 'Private original' });
    const b = store.addIdea({ title: 'Second', content: 'Second original' });
    a.entries[0].content = 'Mutated outside the store';
    const fetched = store.idea(a.id);
    fetched.entries.splice(0);
    expect(store.idea(a.id).entries[0].content).toBe('Private original');
    store.addIdeaEntry(a.id, { revision: 1, kind: 'note', content: 'Latest\n\nuseful insight' });
    const list = store.ideas();
    expect(list.items.map(idea => idea.id)).toEqual([a.id, b.id]);
    expect(list.items[0]).not.toHaveProperty('entries');
    expect(list.items[0].preview).toBe('Latest useful insight');
    list.items[0].title = 'External edit';
    expect(store.idea(a.id).title).toBe('First');
  });

  it('rejects stale tab writes, appends and deletions without changing bytes on disk', () => {
    const store = makeStore();
    const first = store.addIdea({ title: 'Research', content: 'Check the assumptions' });
    const current = store.addIdeaEntry(first.id, { revision: first.revision, kind: 'note', content: 'Updated in tab A' });
    const before = readFileSync(file, 'utf8');
    for (const mutate of [
      () => store.editIdea(first.id, { revision: first.revision, title: 'Stale tab B' }),
      () => store.addIdeaEntry(first.id, { revision: first.revision, kind: 'note', content: 'Stale append' }),
      () => store.editIdeaEntry(first.id, current.entries[1].id, { revision: first.revision, content: 'Stale edit' }),
      () => store.deleteIdeaEntry(first.id, current.entries[1].id, { revision: first.revision }),
      () => store.deleteIdea(first.id, { revision: first.revision }),
    ]) {
      try { mutate(); throw new Error('Expected conflict'); } catch (error) { expect(error).toBeInstanceOf(PersonalError); expect((error as PersonalError).status).toBe(409); }
    }
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(store.idea(first.id)).toEqual(current);
  });

  it('rejects unsupported or invalid bodies and initial-entry removal without losing data', () => {
    const store = makeStore();
    for (const body of [null, [], {}, { title: '', content: 'text' }, { title: 'x'.repeat(201), content: 'text' }, { title: 'Idea', content: ' ' }, { title: 'Idea', content: 'x'.repeat(20001) }, { title: 'Idea', content: 'text', prompt: 'forbidden field' }, { id: 'c9f2eec0-a4d1-453c-a5d2-04f3943a95b7', title: 'Caller ID', content: 'Not public' }]) expect(() => store.addIdea(body)).toThrow();
    expect(existsSync(file)).toBe(false);
    const idea = store.addIdea({ title: 'Idea', content: 'Original' });
    const before = readFileSync(file, 'utf8');
    for (const revision of [undefined, null, '1', 0, -1, 1.1]) expect(() => store.editIdea(idea.id, { revision, title: 'Changed' })).toThrow('版本');
    expect(() => store.editIdea(idea.id, { revision: 1 })).toThrow();
    expect(() => store.editIdea(idea.id, { revision: 1, status: 'active' })).toThrow();
    expect(() => store.addIdeaEntry(idea.id, { revision: 1, kind: 'initial', content: 'Another initial' })).toThrow();
    expect(() => store.addIdeaEntry(idea.id, { revision: 1, kind: 'unknown', content: 'Unknown type' })).toThrow();
    expect(() => store.editIdeaEntry(idea.id, idea.entries[0].id, { revision: 1, kind: 'note', content: 'Retype' })).toThrow();
    expect(() => store.deleteIdeaEntry(idea.id, idea.entries[0].id, { revision: 1 })).toThrow();
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('does not edit or delete entries through another idea’s route', () => {
    const store = makeStore();
    const a = store.addIdea({ title: 'A', content: 'A original' });
    const b = store.addIdea({ title: 'B', content: 'B original' });
    const before = readFileSync(file, 'utf8');
    expect(() => store.editIdeaEntry(a.id, b.entries[0].id, { revision: 1, content: 'Wrong idea' })).toThrow('不存在');
    expect(() => store.deleteIdeaEntry(a.id, b.entries[0].id, { revision: 1 })).toThrow('不存在');
    expect(() => store.editIdea('missing', { revision: 1, title: 'Missing' })).toThrow('不存在');
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('loads old files in memory without writing and imports legacy context once', () => {
    const legacy = {
      version: 1, settings: { animationEnabled: false }, todos: [{ id: 'keep', title: 'Legacy task', done: false }],
      workflowItems: [{ id: 'old', title: 'Research direction', status: 'archived', notes: 'Original notes', excerpt: 'Paper excerpt', nextAction: 'Try an experiment', resumeAt: 'Section 3', question: 'Why this method?', url: 'https://example.org/paper', track: 'research', kind: 'paper', createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-02T11:00:00Z' }],
      unrelated: { keep: 'unchanged' },
    };
    writeFileSync(file, JSON.stringify(legacy));
    const before = readFileSync(file, 'utf8');
    const store = makeStore();
    const summary = store.ideas().items[0];
    const idea = store.idea(summary.id);
    expect(idea).toMatchObject({ title: 'Research direction', status: 'parked', createdAt: legacy.workflowItems[0].createdAt, updatedAt: legacy.workflowItems[0].updatedAt, revision: 1 });
    for (const text of ['Original notes', 'Paper excerpt', 'Try an experiment', 'Section 3', 'Why this method?', 'https://example.org/paper', 'research', 'paper']) expect(idea.entries[0].content).toContain(text);
    expect(makeStore().ideas()).toEqual(store.ideas());
    expect(readFileSync(file, 'utf8')).toBe(before);
    store.deleteIdea(idea.id, { revision: 1 });
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.ideas).toEqual([]);
    expect(saved.ideasTrash[0].idea.id).toBe(idea.id);
    expect(saved.workflowItems).toEqual(legacy.workflowItems);
    expect(saved.todos).toEqual(legacy.todos);
    expect(saved.unrelated).toEqual(legacy.unrelated);
    expect(makeStore().ideas().items).toEqual([]);
    expect(makeStore().ideasTrash().items).toHaveLength(1);
    vi.setSystemTime(new Date(instant.valueOf() + IDEAS_TRASH_MS));
    const expired = makeStore();
    expired.addTodo({ title: 'Trigger expiration' });
    expect(makeStore().ideas().items).toEqual([]);
    expect(makeStore().ideasTrash().items).toEqual([]);
  });

  it('keeps large legacy notes intact across migration and restart', () => {
    const excerpt = '论文摘录'.repeat(11000);
    writeFileSync(file, JSON.stringify({ version: 1, settings: {}, todos: [], workflowItems: [{ title: 'Old paper', excerpt, createdAt: instant.toISOString(), updatedAt: instant.toISOString() }] }));
    const store = makeStore();
    const idea = store.idea(store.ideas().items[0].id);
    expect(idea.entries.map(entry => entry.content).join('')).toContain(excerpt);
    expect(idea.entries.every(entry => entry.content.length <= 20000)).toBe(true);
    store.editIdea(idea.id, { revision: 1, status: 'done' });
    expect(makeStore().idea(idea.id).entries).toEqual(idea.entries);
  });

  it('does not invent history for invalid legacy dates and handles long whitespace between notes', () => {
    const legacy = { version: 1, settings: {}, todos: [], workflowItems: [{ title: 'Old thought', notes: `Before${' '.repeat(50000)}After`, createdAt: 'bad-date', updatedAt: instant.toISOString() }] };
    writeFileSync(file, JSON.stringify(legacy));
    const before = readFileSync(file, 'utf8');
    expect(() => makeStore()).toThrow('timestamps are invalid');
    expect(readFileSync(file, 'utf8')).toBe(before);
    legacy.workflowItems[0].createdAt = instant.toISOString();
    writeFileSync(file, JSON.stringify(legacy));
    const store = makeStore();
    const idea = store.idea(store.ideas().items[0].id);
    expect(idea.entries.every(entry => entry.content.trim())).toBe(true);
    expect(idea.entries.map(entry => entry.content).join('')).toMatch(/Before\s+After/);
    store.editIdea(idea.id, { revision: 1, status: 'done' });
    expect(makeStore().idea(idea.id).entries).toEqual(idea.entries);
  });

  it('fails closed for malformed saved idea data instead of overwriting it', () => {
    const store = makeStore();
    store.addIdea({ title: 'Keep', content: 'Keep my entry' });
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    saved.ideas[0].entries = [];
    writeFileSync(file, JSON.stringify(saved));
    const before = readFileSync(file, 'utf8');
    expect(() => makeStore()).toThrow('idea data is invalid');
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('serves creation, detail, repeated updates and deletion through the HTTP API', async () => {
    const store = makeStore();
    server = createPersonalApp(store).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    const base = `http://127.0.0.1:${address.port}/api/personal/ideas`;
    const request = (path: string, method: string, body?: unknown, english = false) => fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(english ? { 'Accept-Language': 'en' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const response = await request('', 'POST', { title: 'HTTP idea', content: 'Initial content' });
    expect(response.status).toBe(201);
    let idea = await response.json() as Idea;
    expect(await request(`/${idea.id}`, 'GET').then(response => response.json())).toEqual(idea);
    const appended = await request(`/${idea.id}/entries`, 'POST', { revision: idea.revision, kind: 'progress', content: 'One step forward' });
    expect(appended.status).toBe(201);
    idea = await appended.json() as Idea;
    idea = await request(`/${idea.id}/entries/${idea.entries[1].id}`, 'PATCH', { revision: idea.revision, content: 'Two steps forward' }).then(response => response.json()) as Idea;
    idea = await request(`/${idea.id}`, 'PATCH', { revision: idea.revision, status: 'done' }).then(response => response.json()) as Idea;
    expect(idea).toMatchObject({ revision: 4, status: 'done' });
    const conflict = await request(`/${idea.id}`, 'DELETE', { revision: 1 }, true);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ message: 'This idea was updated on another page. Refresh and try again.' });
    idea = await request(`/${idea.id}/entries/${idea.entries[1].id}`, 'DELETE', { revision: idea.revision }).then(response => response.json()) as Idea;
    expect(idea.entries).toHaveLength(1);
    expect((await request(`/${idea.id}`, 'DELETE', { revision: idea.revision })).status).toBe(204);
    expect((await request(`/${idea.id}`, 'GET')).status).toBe(404);
    expect(await request('', 'GET').then(response => response.json())).toEqual({ items: [] });
    const trash = await request('/trash', 'GET').then(response => response.json()) as { items: { id: string }[] };
    expect(trash.items.map(item => item.id)).toEqual([idea.id]);
    const restored = await request(`/${idea.id}/restore`, 'POST', {}).then(response => response.json()) as Idea;
    expect(restored).toMatchObject({ id: idea.id, revision: idea.revision + 1, entries: idea.entries });
    expect(await request('/trash', 'GET').then(response => response.json())).toEqual({ items: [] });
  });

  it('accepts full-length Chinese entries, rejects oversized bodies, and enforces origin/JSON guards', async () => {
    server = createPersonalApp(makeStore()).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    const base = `http://127.0.0.1:${address.port}/api/personal/ideas`;
    const post = (body: string, headers: Record<string, string> = {}) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
    const response = await post(JSON.stringify({ title: '完整中文记录', content: '中'.repeat(20000) }));
    expect(response.status).toBe(201);
    const idea = await response.json() as Idea;
    expect(idea.entries[0].content).toHaveLength(20000);
    const before = readFileSync(file, 'utf8');
    expect((await post(JSON.stringify({ title: 'Too big', content: 'x'.repeat(140000) }))).status).toBe(413);
    expect((await post('{broken')).status).toBe(400);
    expect((await post('{}', { Origin: 'https://example.com' })).status).toBe(403);
    expect((await fetch(`${base}/${idea.id}`, { method: 'DELETE', body: 'revision=1' })).status).toBe(415);
    expect((await fetch(`${base}/${idea.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(400);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});
