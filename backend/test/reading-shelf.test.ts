import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
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
    expect(() => reloaded.deleteReading(id)).toThrow();
    expect(readFileSync(path, 'utf8')).toContain('revised report');
  });

  it('adopts v1 data without losing prior tasks or private settings', () => {
    const oldTodo = { id: 'existing-task', title: 'Keep my task', done: false, createdAt: '2026-09-20T12:00:00.000Z', dueDate: null };
    const legacy = { version: 1, settings: { vaultPath: '', calendarFile: '', calendarUrl: 'https://p01-caldav.icloud.com/published/private-token', animationEnabled: false }, todos: [oldTodo] };
    writeFileSync(dataFile, JSON.stringify(legacy));
    const store = makeStore();
    expect(store.todos()).toEqual([oldTodo]);
    expect(store.settings()).toMatchObject({ animationEnabled: false, calendarUrlConfigured: true, readingTechPath: tech, readingAestheticPath: aesthetic });
    expect(JSON.parse(readFileSync(dataFile, 'utf8'))).toEqual(legacy);
    store.addReading({ title: 'New book', type: 'book' });
    const persisted = JSON.parse(readFileSync(dataFile, 'utf8'));
    expect(persisted.todos).toEqual([oldTodo]);
    expect(persisted.settings.calendarUrl).toBe(legacy.settings.calendarUrl);
    expect(persisted.readingItems).toHaveLength(1);
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
    const state = await fetch(`${url}/api/personal/state`, { headers }).then(result => result.json()) as { finance: { message: string }; calendar: { message: string } };
    expect(state.finance.message).toMatch(/^This workbench/);
    expect(state.calendar.message).toMatch(/^Connect an existing/);
  });
});
