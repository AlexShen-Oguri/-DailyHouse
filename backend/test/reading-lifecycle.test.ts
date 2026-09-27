import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { PersonalStore } from '../src/personal/store';
import { createPersonalApp } from '../src/personal/app';
import { READING_IMPORT_WINDOW_MS, READING_TRASH_MS } from '../src/personal/reading-lifecycle';

let root: string;
let file: string;
let reports: string;
let server: Server | undefined;
const now = new Date('2026-09-27T12:00:00.000Z');
const cover = 'https://i0.hdslb.com/bfs/archive/fixture.jpg';
const url = (number = 0) => `https://www.bilibili.com/video/BV${String(number).padStart(10, '0')}/`;
const candidate = (number = 0, override: Record<string, unknown> = {}) => ({ title: 'Python 编程入门教程', url: url(number), viewedAt: '2026-09-26T12:00:00.000Z', progress: 0.1, notes: 'At chapter two', ...override });
const makeStore = (request: typeof fetch = vi.fn<typeof fetch>()) => new PersonalStore(file, undefined, reports, request);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'garden-lifecycle-'));
  file = join(root, 'personal.json');
  reports = join(root, 'reports');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
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

describe('reading lifecycle', () => {
  it('records completion once, preserves it during note/category edits, and clears it on reopening', () => {
    const store = makeStore();
    const item = store.addReading({ title: 'Book', type: 'book', category: 'science' });
    expect(item.category).toBe('science');
    expect(item.finishedAt).toBeUndefined();
    const done = store.editReading(item.id, { status: 'done' });
    expect(done.finishedAt).toBe(now.toISOString());
    vi.setSystemTime(new Date(now.valueOf() + 1000));
    expect(store.editReading(item.id, { notes: 'A useful insight', category: 'humanities' }).finishedAt).toBe(done.finishedAt);
    expect(store.editReading(item.id, { status: 'done' }).finishedAt).toBe(done.finishedAt);
    expect(store.editReading(item.id, { status: 'reading' }).finishedAt).toBeUndefined();
    expect(makeStore().reading().items[0]).toMatchObject({ status: 'reading', category: 'humanities' });
  });

  it('derives legacy categories without writing and prefers an explicit old import direction', () => {
    const store = makeStore();
    const a = store.addReading({ title: 'AI 教程', type: 'video', url: url(1), notes: 'UP主：Fixture\n来源：B站历史（2026-09-26），方向：编程。' });
    const b = store.addReading({ title: 'English grammar lesson', type: 'video', url: url(2), notes: 'AI is mentioned in a long note but is not the topic' });
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    for (const item of saved.readingItems) delete item.category;
    saved.workflowItems = [{ id: 'preserved-legacy-workflow', readingId: a.id, notes: 'Keep historical records' }];
    writeFileSync(file, JSON.stringify(saved));
    const before = readFileSync(file, 'utf8');
    const reloaded = makeStore();
    expect(reloaded.reading().items.find(item => item.id === a.id)).toMatchObject({ category: 'programming_ai', updatedAt: a.updatedAt });
    expect(reloaded.reading().items.find(item => item.id === b.id)?.category).toBe('language');
    expect(readFileSync(file, 'utf8')).toBe(before);
    reloaded.editReading(a.id, { category: 'science' });
    expect(JSON.parse(readFileSync(file, 'utf8')).workflowItems).toEqual(saved.workflowItems);
  });

  it('restores original IDs, progress, notes and cover while leaving unrelated todos intact', () => {
    const store = makeStore();
    const item = store.addReading({ title: 'AI tutorial', type: 'video', url: url(), coverUrl: cover, notes: 'My private lesson notes', category: 'programming_ai', status: 'done' });
    const todo = store.addTodo({ title: 'Unrelated task' });
    store.deleteReading(item.id);
    expect(store.reading().items).toEqual([]);
    expect(store.readingTrash().items[0]).toMatchObject({ item, deletedAt: now.toISOString(), expiresAt: new Date(now.valueOf() + READING_TRASH_MS).toISOString(), expired: false });
    const result = makeStore().restoreReading({ ids: [item.id, item.id] });
    expect(result.restoredIds).toEqual([item.id]);
    expect(result.items).toEqual([item]);
    expect(makeStore().todos()).toEqual([todo]);
    expect(makeStore().readingTrash().items).toEqual([]);
  });

  it('atomically restores mixed reports and manual entries while retaining PDF bytes and completion', () => {
    const folder = join(reports, '每日AI科技早报');
    mkdirSync(folder, { recursive: true });
    const pdf = join(folder, '2026-09-26_AI科技早报.pdf');
    writeFileSync(pdf, '%PDF-1.7\nOriginal report');
    const store = makeStore();
    const book = store.addReading({ title: 'Keep my book', type: 'book' });
    const report = store.editReading('report:tech:2026-09-26', { status: 'done', category: 'science' });
    const bytes = readFileSync(pdf);
    store.removeReading({ all: true });
    expect(store.readingTrash().items).toHaveLength(2);
    const before = readFileSync(file, 'utf8');
    expect(() => store.restoreReading({ ids: [book.id, 'missing'] })).toThrow();
    expect(readFileSync(file, 'utf8')).toBe(before);
    const restored = store.restoreReading({ ids: [book.id, report.id] });
    expect(restored.items.find(item => item.id === report.id)).toMatchObject({ status: 'done', category: 'science', finishedAt: report.finishedAt });
    expect(readFileSync(pdf)).toEqual(bytes);
  });

  it('hides expired snapshots and purges their private contents on the next write while retaining suppression', () => {
    const store = makeStore();
    const item = store.addReading({ title: 'Private title', type: 'video', url: url(), notes: 'secret-only-in-snapshot', coverUrl: cover });
    store.deleteReading(item.id);
    vi.setSystemTime(new Date(now.valueOf() + READING_TRASH_MS));
    expect(store.readingTrash().items).toEqual([]);
    expect(() => store.restoreReading({ ids: [item.id] })).toThrow('30 天');
    store.addTodo({ title: 'Any later operation' });
    for (const secret of ['secret-only-in-snapshot', 'Private title', cover]) expect(readFileSync(file, 'utf8')).not.toContain(secret);
    const reloaded = makeStore();
    expect(() => reloaded.restoreReading({ ids: [item.id] })).toThrowError(expect.objectContaining({ status: 410 }));
    expect(reloaded.previewReadingImport({ items: [candidate(0, { viewedAt: new Date().toISOString() })] }).counts.suppressed).toBe(1);
  });

  it('suppresses removed imports, allows explicit new manual collection, and rejects duplicate restore/add', () => {
    const store = makeStore();
    const original = store.addReading({ title: 'Original', type: 'video', url: url(), status: 'done' });
    store.deleteReading(original.id);
    const input = { items: [candidate()], acceptedUrls: [url()] };
    expect(store.importReading(input).counts.suppressed).toBe(1);
    const newItem = store.addReading({ title: 'Explicit new collection', type: 'video', url: `${url()}?spm_id_from=tracking` });
    expect(newItem.id).not.toBe(original.id);
    expect(() => store.restoreReading({ ids: [original.id] })).toThrowError(expect.objectContaining({ status: 409 }));
    expect(() => store.addReading({ title: 'Duplicate', type: 'video', url: `${url()}?p=2` })).toThrowError(expect.objectContaining({ status: 409 }));
    expect(store.previewReadingImport(input).counts.duplicates).toBe(1);
  });

  it('registers historical removal suppression without changing active content', () => {
    const store = makeStore();
    const keep = store.addReading({ title: 'Kept', type: 'video', url: url(1) });
    expect(store.suppressReading({ urls: [url(0), `${url(0)}?p=3`, url(1)] })).toEqual({ suppressedCount: 1, skippedExistingCount: 1 });
    expect(store.suppressReading({ urls: [url(0)] }).suppressedCount).toBe(0);
    expect(store.reading().items).toEqual([keep]);
    expect(store.previewReadingImport({ items: [candidate(0), candidate(1)] }).candidates.map(item => item.decision)).toEqual(['suppressed', 'duplicate']);
  });

  it('rejects same-source conflicts within a restore selection atomically', () => {
    const store = makeStore();
    const first = store.addReading({ title: 'First collection', type: 'video', url: url() });
    store.deleteReading(first.id);
    const second = store.addReading({ title: 'Second collection', type: 'video', url: url() });
    store.deleteReading(second.id);
    const before = readFileSync(file, 'utf8');
    expect(() => store.restoreReading({ ids: [first.id, second.id] })).toThrowError(expect.objectContaining({ status: 409 }));
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(store.readingTrash().items).toHaveLength(2);
  });

  it('previews fixed seven-day and progress boundaries without writing or fetching covers', () => {
    const request = vi.fn<typeof fetch>();
    const store = makeStore(request);
    const input = { items: [
      candidate(1, { viewedAt: new Date(now.valueOf() - READING_IMPORT_WINDOW_MS).toISOString() }),
      candidate(2, { viewedAt: new Date(now.valueOf() - READING_IMPORT_WINDOW_MS - 1).toISOString() }),
      candidate(3, { viewedAt: new Date(now.valueOf() + 1).toISOString() }),
      candidate(4, { progress: 0.25 }), candidate(5, { progress: null }), candidate(6, { title: '周末搞笑鬼畜合集' }),
      candidate(7, { title: 'Some interesting thoughts' }),
    ], acceptedUrls: [url(2), url(3), url(4), url(5), url(6), url(7)] };
    const preview = store.previewReadingImport(input);
    expect(preview.candidates.map(item => item.decision)).toEqual(['import', 'excluded', 'excluded', 'excluded', 'review', 'excluded', 'import']);
    expect(preview.counts).toEqual({ total: 7, accepted: 2, excluded: 4, review: 1, duplicates: 0, suppressed: 0 });
    expect(existsSync(file)).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('commits a verified batch with canonical deduplication and never resets completed content', () => {
    const store = makeStore();
    const existing = store.addReading({ title: 'Already learned', type: 'video', url: url(3), status: 'done', notes: 'Remember my notes', category: 'science' });
    const result = store.importReading({ items: [candidate(1, { coverUrl: cover }), candidate(1, { url: `${url(1)}?p=2&spm_id_from=track` }), candidate(3), candidate(4, { title: 'Unknown topic' })], coverage: { from: '2026-09-20T12:00:00Z', to: now.toISOString(), complete: false } });
    expect(result.counts).toEqual({ total: 4, accepted: 1, duplicates: 2, review: 1, excluded: 0, suppressed: 0 });
    expect(result.items[0]).toMatchObject({ category: 'programming_ai', status: 'unread', coverUrl: cover, importBatchId: result.batch.id, sourceKey: 'bilibili:BV0000000001' });
    expect(result.batch).toMatchObject({ addedCount: 1, duplicateCount: 2, reviewCount: 1, canUndo: true, coverage: { complete: false } });
    expect(makeStore().reading().items.find(item => item.id === existing.id)).toEqual(existing);
    expect(makeStore().readingImports().items[0]).toEqual(result.batch);
    expect(result.batch.candidates[0].notes).toBe('');
    expect(store.importReading({ items: [candidate(1)] }).items).toEqual([]);
  });

  it('rejects a malformed batch without mutating a valid prefix', () => {
    const store = makeStore();
    store.addTodo({ title: 'Keep' });
    const before = readFileSync(file, 'utf8');
    for (const invalid of [{ progress: NaN }, { progress: -1 }, { url: 'javascript:bad' }, { viewedAt: 'yesterday' }, { title: '' }, { coverUrl: 'http://localhost/private' }]) {
      expect(() => store.importReading({ items: [candidate(1), candidate(2, invalid)] })).toThrow();
      expect(readFileSync(file, 'utf8')).toBe(before);
      expect(store.reading().items).toEqual([]);
    }
  });

  it('uses the latest playback position and resolves equal-time records conservatively', () => {
    const store = makeStore();
    const older = candidate(1, { viewedAt: '2026-09-25T12:00:00Z', progress: 0.1 });
    const newer = candidate(1, { viewedAt: '2026-09-26T12:00:00Z', progress: 0.8 });
    for (const items of [[older, newer], [newer, older], [candidate(1), candidate(1, { progress: 0.9 })]]) {
      const preview = store.previewReadingImport({ items });
      expect(preview.counts).toMatchObject({ accepted: 0, excluded: 1, duplicates: 1 });
    }
    expect(store.previewReadingImport({ items: [candidate(1), candidate(1, { progress: null })] }).counts).toMatchObject({ accepted: 0, review: 1, duplicates: 1 });
    expect(existsSync(file)).toBe(false);
  });

  it('does not treat cover-only enrichment as a user progress edit during batch undo', () => {
    const store = makeStore();
    const result = store.importReading({ items: [candidate(1)] });
    store.editReading(result.items[0].id, { coverUrl: cover });
    expect(store.undoReadingImport(result.batch.id).removedIds).toEqual([result.items[0].id]);
  });

  it('lets a user decline unknown-progress candidates and suppresses later imports', () => {
    const store = makeStore();
    const input = { items: [candidate(1, { progress: null })], excludedUrls: [url(1)] };
    expect(store.previewReadingImport(input).counts.excluded).toBe(1);
    expect(store.importReading(input).batch.excludedCount).toBe(1);
    expect(store.previewReadingImport({ items: [candidate(1)], acceptedUrls: [url(1)] }).counts.suppressed).toBe(1);
  });

  it('undoes untouched imports, protects same-millisecond edits and restores, and remains idempotent', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { bvid: 'BV0000000000', pic: cover } }), { headers: { 'Content-Type': 'application/json' } }));
    const store = makeStore(request);
    const result = store.importReading({ items: Array.from({ length: 7 }, (_, number) => candidate(number)) });
    const ids = result.items.map(item => item.id);
    await store.readingCover(ids[0]);
    store.editReading(ids[1], { notes: 'New thoughts' });
    store.editReading(ids[2], { status: 'done' });
    store.editReading(ids[3], { category: 'design' });
    store.editReading(ids[4], { title: result.items[4].title });
    store.deleteReading(ids[5]);
    store.restoreReading({ ids: [ids[5]] });
    store.deleteReading(ids[6]);
    const undone = store.undoReadingImport(result.batch.id);
    expect(undone).toEqual({ batchId: result.batch.id, removedIds: [ids[0]], conflictIds: ids.slice(1, 6), skippedIds: [ids[6]], alreadyUndone: false });
    expect(store.readingImports().items[0]).toMatchObject({ canUndo: false, undoResult: { removedCount: 1, conflictCount: 5, skippedCount: 1 } });
    store.restoreReading({ ids: [ids[0]] });
    expect(store.undoReadingImport(result.batch.id)).toEqual({ ...undone, alreadyUndone: true });
    expect(makeStore().reading().items.some(item => item.id === ids[0])).toBe(true);
  });

  it('refuses invalid saved collections instead of replacing legacy data', () => {
    const good = { version: 1, settings: {}, todos: [] };
    for (const invalid of [{ readingItems: {} }, { readingItems: [null] }, { readingItems: [{ id: 'broken' }] }, { readingTrash: {} }, { readingReports: [] }, { readingImports: [{}] }, { readingSuppressions: { key: 'not a date' } }, { readingRevisions: { item: -1 } }]) {
      const source = JSON.stringify({ ...good, ...invalid });
      writeFileSync(file, source);
      expect(() => makeStore()).toThrow('reading data is invalid');
      expect(readFileSync(file, 'utf8')).toBe(source);
    }
  });

  it('exposes preview, imports, trash, restore and undo through the local HTTP API', async () => {
    const store = makeStore();
    server = createPersonalApp(store).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test server address');
    const base = `http://127.0.0.1:${address.port}/api/personal/reading`;
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post('/imports/preview', { items: [candidate()] })).status).toBe(200);
    const committed = await post('/imports', { items: [candidate()] });
    expect(committed.status).toBe(201);
    const result = await committed.json() as { batch: { id: string }; items: { id: string }[] };
    expect((await post('/remove', { ids: [result.items[0].id] })).status).toBe(200);
    expect((await fetch(`${base}/trash`).then(response => response.json()) as { items: unknown[] }).items).toHaveLength(1);
    expect((await post('/restore', { ids: [result.items[0].id] })).status).toBe(200);
    expect((await post(`/imports/${encodeURIComponent(result.batch.id)}/undo`, {})).status).toBe(200);
    expect((await fetch(`${base}/imports`).then(response => response.json()) as { items: unknown[] }).items).toHaveLength(1);
    const english = await fetch(`${base}/imports/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en' }, body: JSON.stringify({ items: [candidate(2, { title: '中文教程', progress: 0.5 })] }) }).then(response => response.json()) as { candidates: { title: string; reason: string }[] };
    expect(english.candidates[0].title).toBe('中文教程');
    expect(english.candidates[0].reason).toBe('Playback progress is at least 25%, outside this import rule.');
  });
});
