import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { createPersonalApp } from '../src/personal/app';
import { PersonalStore } from '../src/personal/store';
import type { ReadingItem } from '../src/personal/types';

let root: string;
let dataFile: string;
let base: string;
let tech: string;
let aesthetic: string;
let server: Server | undefined;
const makeStore = () => new PersonalStore(dataFile, join(root, 'Desktop'), base);
const pdf = (path: string, text = 'report') => writeFileSync(path, `%PDF-1.7\n${text}\n%%EOF`);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'garden-reading-'));
  dataFile = join(root, 'personal.json');
  base = join(root, 'reports');
  tech = join(base, '每日AI科技早报');
  aesthetic = join(base, '每日审美图鉴');
  mkdirSync(tech, { recursive: true });
  mkdirSync(aesthetic, { recursive: true });
});
afterEach(async () => {
  if (server) {
    const closing = new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closing;
    server = undefined;
  }
  rmSync(root, { recursive: true, force: true });
});

describe('personal reading shelf', () => {
  it('persists manual books and links with editable metadata and reading state', () => {
    const store = makeStore();
    const book = store.addReading({ title: '  The Art of Learning  ', type: 'book' });
    const video = store.addReading({ title: 'A tutorial', type: 'video', url: 'https://www.bilibili.com/video/BV123', notes: 'Watch chapter two' });
    expect(book).toMatchObject({ origin: 'manual', title: 'The Art of Learning', url: '', status: 'unread' });
    store.editReading(video.id, { title: 'Revised tutorial', notes: 'My notes', status: 'reading' });
    const reloaded = makeStore();
    expect(reloaded.reading().items.find(item => item.id === video.id)).toMatchObject({ title: 'Revised tutorial', notes: 'My notes', status: 'reading' });
    reloaded.deleteReading(book.id);
    expect(makeStore().reading().items.map(item => item.id)).toEqual([video.id]);
  });

  it('rejects executable or credential-bearing URLs and incomplete non-book links', () => {
    const store = makeStore();
    for (const url of ['javascript:alert(1)', 'file:///C:/private.pdf', 'data:text/html,test', 'https://user:secret@example.com', 'https://example.com/\nprivate']) expect(() => store.addReading({ title: 'Invalid', type: 'article', url })).toThrow();
    expect(() => store.addReading({ title: 'No link', type: 'course' })).toThrow('链接');
    expect(() => store.addReading({ title: 'Unknown type', type: 'podcast', url: 'https://example.com' })).toThrow('类型');
    expect(() => store.addReading({ title: 'Invalid status', type: 'book', status: 'archived' })).toThrow('状态');
    expect(existsSync(dataFile)).toBe(false);
  });

  it('discovers only final nonempty root PDFs with valid dates and stable IDs', () => {
    pdf(join(tech, '2026-09-25_AI科技早报.pdf'));
    pdf(join(aesthetic, '2026-09-26_每日审美图鉴.pdf'));
    pdf(join(tech, '2026-09-25_AI科技早报_试刊.pdf'));
    pdf(join(tech, '2026-02-31_AI科技早报.pdf'));
    writeFileSync(join(tech, '2026-09-24_AI科技早报.pdf'), '');
    mkdirSync(join(tech, 'tmp'));
    pdf(join(tech, 'tmp', '2026-09-23_AI科技早报.pdf'));
    const store = makeStore();
    const first = store.reading();
    expect(first.items.map(item => item.id).sort()).toEqual(['report:aesthetic:2026-09-26', 'report:tech:2026-09-25']);
    expect(first.items.find(item => item.reportSource === 'tech')).toMatchObject({ reportDate: '2026-09-25', coverageDate: '2026-09-25', status: 'unread', updatedSinceRead: false });
    expect(first.items.find(item => item.reportSource === 'aesthetic')?.coverageDate).toBeUndefined();
    expect(first.sources.map(source => source.count)).toEqual([1, 1]);
    expect(store.reading().items.map(item => item.id)).toEqual(first.items.map(item => item.id));
    expect(existsSync(dataFile)).toBe(false);
  });

  it('retains read status across report replacement and highlights a newer file version', () => {
    const path = join(tech, '2026-09-25_AI科技早报.pdf');
    pdf(path);
    utimesSync(path, new Date('2026-09-26T13:00:00Z'), new Date('2026-09-26T13:00:00Z'));
    const store = makeStore();
    const id = store.reading().items[0].id;
    store.editReading(id, { status: 'done' });
    pdf(path, 'revised report');
    utimesSync(path, new Date('2026-09-26T14:00:00Z'), new Date('2026-09-26T14:00:00Z'));
    const reloaded = makeStore();
    expect(reloaded.reading().items[0]).toMatchObject({ id, status: 'done', updatedSinceRead: true, updatedAt: '2026-09-26T14:00:00.000Z' });
    reloaded.editReading(id, { status: 'done' });
    expect(makeStore().reading().items[0].updatedSinceRead).toBe(false);
    expect(() => reloaded.editReading(id, { title: 'Overwrite report' })).toThrow();
    reloaded.deleteReading(id);
    expect(makeStore().reading().items).toEqual([]);
    expect(readFileSync(path, 'utf8')).toContain('revised report');
  });

  it('removes a deduplicated mixed selection while preserving other items and report metadata', () => {
    const path = join(tech, '2026-09-25_AI科技早报.pdf');
    pdf(path);
    const originalPdf = readFileSync(path);
    const store = makeStore();
    const book = store.addReading({ title: 'Remove book', type: 'book' });
    const keep = store.addReading({ title: 'Keep completed book', type: 'book', status: 'done' });
    const reportId = 'report:tech:2026-09-25';
    store.editReading(reportId, { status: 'reading' });
    const reportState = JSON.parse(readFileSync(dataFile, 'utf8')).readingReports[reportId];
    expect(store.removeReading({ ids: [book.id, reportId, book.id] })).toEqual({ removedIds: [book.id, reportId] });
    const reloaded = makeStore();
    expect(reloaded.reading().items).toEqual([keep]);
    expect(JSON.parse(readFileSync(dataFile, 'utf8')).readingReports[reportId]).toEqual({ ...reportState, hidden: true });
    expect(readFileSync(path)).toEqual(originalPdf);
    expect(reloaded.readingPdf(reportId)).toBe(path);
    expect(() => reloaded.editReading(reportId, { status: 'unread' })).toThrow('不存在');
    // Regenerating a hidden day's PDF must not restore it; tomorrow is a new item.
    pdf(path, 'a regenerated edition');
    pdf(join(tech, '2026-09-26_AI科技早报.pdf'));
    expect(makeStore().reading().items.map(item => item.id)).toEqual([keep.id, 'report:tech:2026-09-26']);
  });

  it('validates every requested ID and leaves memory and disk intact on malformed or stale selections', () => {
    pdf(join(tech, '2026-09-25_AI科技早报.pdf'));
    const store = makeStore();
    const item = store.addReading({ title: 'Keep on failure', type: 'book' });
    const before = readFileSync(dataFile, 'utf8');
    const originalIds = store.reading().items.map(entry => entry.id);
    const invalidBodies: unknown[] = [null, [], {}, { ids: [] }, { ids: 'all' }, { ids: [null] }, { ids: [''] }, { ids: ['x'.repeat(129)] }, { ids: Array(10001).fill(item.id) }, { all: false }, { all: 'true' }, { all: true, ids: [item.id] }, { all: true, status: 'done' }, { ids: [item.id, 'missing'] }];
    for (const body of invalidBodies) {
      expect(() => store.removeReading(body)).toThrow();
      expect(readFileSync(dataFile, 'utf8')).toBe(before);
      expect(store.reading().items.map(entry => entry.id)).toEqual(originalIds);
    }
  });

  it('removes the entire current shelf across all statuses and keeps discovering future reports', () => {
    const techFile = join(tech, '2026-09-25_AI科技早报.pdf');
    const aestheticFile = join(aesthetic, '2026-09-26_每日审美图鉴.pdf');
    pdf(techFile);
    pdf(aestheticFile);
    const store = makeStore();
    for (const status of ['unread', 'reading', 'done']) store.addReading({ title: status, type: 'book', status });
    store.editReading('report:tech:2026-09-25', { status: 'done' });
    const originalIds = store.reading().items.map(item => item.id);
    expect(store.removeReading({ all: true })).toEqual({ removedIds: originalIds });
    const reloaded = makeStore();
    expect(reloaded.reading().items).toEqual([]);
    expect(reloaded.removeReading({ all: true })).toEqual({ removedIds: [] });
    expect(existsSync(techFile)).toBe(true);
    expect(existsSync(aestheticFile)).toBe(true);
    pdf(join(aesthetic, '2026-09-27_每日审美图鉴.pdf'));
    expect(makeStore().reading().items.map(item => item.id)).toEqual(['report:aesthetic:2026-09-27']);
  });

  it('adopts v1 data without losing prior tasks or private settings', () => {
    const oldTodo = { id: 'existing-task', title: 'Keep my task', done: false, createdAt: '2026-09-20T12:00:00.000Z', dueDate: null };
    const legacy = { version: 1, settings: { vaultPath: '', calendarFile: '', calendarUrl: 'https://p01-caldav.icloud.com/published/private-token', animationEnabled: false }, todos: [oldTodo] };
    writeFileSync(dataFile, JSON.stringify(legacy));
    const store = makeStore();
    const migrated = readFileSync(dataFile, 'utf8');
    expect(JSON.parse(migrated)).toMatchObject({ readingWorkflowVersion: 2, readingImports: [], todos: legacy.todos, settings: legacy.settings });
    const readMarker = new Date('2000-01-01T00:00:00.000Z'); utimesSync(dataFile, readMarker, readMarker);
    expect(store.todos()).toEqual([oldTodo]);
    expect(store.settings()).toMatchObject({ animationEnabled: false, calendarUrlConfigured: true, readingTechPath: tech, readingAestheticPath: aesthetic });
    expect(store.reading().items).toEqual([]);
    expect(makeStore().todos()).toEqual([oldTodo]);
    expect(readFileSync(dataFile, 'utf8')).toBe(migrated);
    expect(statSync(dataFile).mtime.getTime()).toBe(readMarker.getTime());
    store.addReading({ title: 'New book', type: 'book' });
    const persisted = JSON.parse(readFileSync(dataFile, 'utf8'));
    expect(persisted.todos).toEqual([oldTodo]);
    expect(persisted.settings.calendarUrl).toBe(legacy.settings.calendarUrl);
    expect(persisted.readingItems).toHaveLength(1);
    expect(statSync(dataFile).mtime.getTime()).toBeGreaterThan(readMarker.getTime());
    expect(makeStore().settings().animationEnabled).toBe(false);
  });

  it('reports missing folders honestly and rejects junction escapes or arbitrary PDF paths', () => {
    const store = makeStore();
    const outside = join(root, 'outside');
    mkdirSync(outside);
    pdf(join(outside, '2026-09-25_AI科技早报.pdf'), 'private');
    renameSync(tech, join(root, 'old-tech'));
    symlinkSync(outside, tech, 'junction');
    expect(store.reading().sources[0].status).toBe('error');
    expect(() => store.readingPdf('report:tech:2026-09-25')).toThrow();
    expect(() => store.readingPdf('../../outside/private.pdf')).toThrow();
    store.updateSettings({ readingTechPath: join(root, 'missing') });
    expect(store.reading().sources[0].status).toBe('missing');
    store.updateSettings({ readingTechPath: '' });
    expect(store.settings().readingTechPath).toBe(tech);
  });

  it('serves authorized PDFs and localizes service text without changing user content', async () => {
    const path = join(tech, '2026-09-25_AI科技早报.pdf');
    pdf(path);
    const store = makeStore();
    server = createPersonalApp(store).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    const url = `http://127.0.0.1:${address.port}`;
    const headers = { 'Content-Type': 'application/json', 'Accept-Language': 'en' };
    const added = await fetch(`${url}/api/personal/reading`, { method: 'POST', headers, body: JSON.stringify({ title: '中文书名', type: 'book', notes: '保留我的笔记' }) });
    expect(added.status).toBe(201);
    const item = await added.json() as ReadingItem;
    expect(item).toMatchObject({ title: '中文书名', notes: '保留我的笔记' });
    const response = await fetch(`${url}/api/personal/reading`, { headers });
    const shelf = await response.json() as { items: ReadingItem[]; sources: { label: string; message: string }[] };
    expect(response.headers.get('content-language')).toBe('en');
    expect(shelf.sources[0].label).toBe('Daily AI & Technology');
    expect(shelf.sources[0].message).toContain('Reads final PDFs');
    const report = shelf.items.find(entry => entry.origin === 'report')!;
    expect(report.title).toBe('Daily AI & Technology · 2026-09-25');
    const pdfResponse = await fetch(`${url}${report.pdfUrl}`);
    expect(pdfResponse.headers.get('content-type')).toContain('application/pdf');
    expect(await pdfResponse.text()).toContain('%PDF-1.7');
    renameSync(path, join(root, 'moved.pdf'));
    expect((await fetch(`${url}${report.pdfUrl}`)).status).toBe(404);
    const invalid = await fetch(`${url}/api/personal/reading`, { method: 'POST', headers, body: JSON.stringify({ title: 'Bad link', type: 'video', url: 'javascript:alert(1)' }) });
    expect(await invalid.json()).toEqual({ message: 'Enter a valid HTTP or HTTPS link without embedded credentials.' });
    const state = await fetch(`${url}/api/personal/state`, { headers }).then(result => result.json()) as { calendar: { message: string } };
    expect(state.calendar.message).toMatch(/^Connect an existing/);
  });

  it('supports full-capacity batch removal over HTTP and keeps failures atomic and localized', async () => {
    // Seed at the supported manual limit without 5,000 unrelated disk writes.
    const items: ReadingItem[] = Array.from({ length: 5000 }, (_, index) => ({
      id: `reading:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      title: `Fixture ${index}`, type: 'book', url: '', notes: '', status: index % 2 ? 'done' : 'unread',
      addedAt: '2026-09-26T12:00:00Z', updatedAt: '2026-09-26T12:00:00Z', origin: 'manual',
    }));
    writeFileSync(dataFile, JSON.stringify({ version: 1, settings: {}, todos: [], readingItems: items }));
    pdf(join(tech, '2026-09-25_AI科技早报.pdf'));
    const store = makeStore();
    server = createPersonalApp(store).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    const url = `http://127.0.0.1:${address.port}/api/personal/reading`;
    const headers = { 'Content-Type': 'application/json', 'Accept-Language': 'en' };
    const remove = (body: unknown) => fetch(`${url}/remove`, { method: 'POST', headers, body: JSON.stringify(body) });
    const invalid = await remove({ ids: [items[0].id, 'missing'] });
    expect(invalid.status).toBe(404);
    expect(await invalid.json()).toEqual({ message: 'Some reading items no longer exist. Refresh the shelf and try again.' });
    expect(store.reading().items).toHaveLength(5001);
    const malformed = await remove({ all: true, ids: [] });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ message: 'Select 1–10,000 reading items, or explicitly remove all items.' });
    const ids = items.map(item => item.id);
    const removed = await remove({ ids });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ removedIds: ids });
    expect(makeStore().reading().items.map(item => item.id)).toEqual(['report:tech:2026-09-25']);
    expect((await fetch(`${url}/${encodeURIComponent('report:tech:2026-09-25')}`, { method: 'DELETE' })).status).toBe(204);
    expect(makeStore().reading().items).toEqual([]);
    pdf(join(tech, '2026-09-26_AI科技早报.pdf'));
    const all = await remove({ all: true });
    expect(all.status).toBe(200);
    expect(await all.json()).toEqual({ removedIds: ['report:tech:2026-09-26'] });
    expect(await (await remove({ all: true })).json()).toEqual({ removedIds: [] });
  });
});
