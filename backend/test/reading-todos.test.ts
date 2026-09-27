import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import type { Server } from 'node:http';
import { PersonalStore } from '../src/personal/store';
import { createPersonalApp } from '../src/personal/app';
import type { ReadingType } from '../src/personal/types';

let root: string;
let store: PersonalStore;
let server: Server | undefined;
const reload = () => new PersonalStore(join(root, 'personal.json'), undefined, join(root, 'reports'));
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'garden-reading-todos-')); store = reload(); });
afterEach(async () => {
  if (server) { const closed = new Promise<void>(resolve => server!.close(() => resolve())); server.closeAllConnections(); await closed; server = undefined; }
  rmSync(root, { recursive: true, force: true });
});

describe('shelf content in tasks', () => {
  it.each(['book', 'video', 'course', 'tutorial', 'github', 'article'] as ReadingType[])('adds %s without changing shelf status, notes or classification', type => {
    const item = store.addReading({ title: 'A useful resource', type, url: 'https://example.org/resource', notes: 'Read chapter two', category: 'design' });
    const result = store.addReadingTodo(item.id, { dueDate: '2026-12-15' });
    expect(result).toMatchObject({ created: true, todoId: result.todo.id, todo: { title: item.title, dueDate: '2026-12-15', done: false, source: { kind: 'reading', id: item.id, title: item.title, type, url: item.url, available: true } } });
    expect(store.reading().items[0]).toEqual(item);
    expect(reload().todos()).toEqual([result.todo]);
  });

  it('keeps one task even after completing, editing, and reloading; deletion permits an intentional new task', () => {
    const item = store.addReading({ title: 'Learn something', type: 'book' });
    const first = store.addReadingTodo(item.id, {});
    store.editTodo(first.todoId, { title: 'Read just chapter one', done: true, dueDate: '2026-10-01' });
    store = reload();
    expect(store.addReadingTodo(item.id, { title: 'A retry', dueDate: '2026-11-01' })).toMatchObject({ created: false, todoId: first.todoId, todo: { title: 'Read just chapter one', done: true, dueDate: '2026-10-01' } });
    expect(store.todos()).toHaveLength(1);
    expect(store.reading().items[0].status).toBe('unread');
    store.editReading(item.id, { status: 'done' });
    store.editTodo(first.todoId, { done: false });
    expect(store.reading().items[0].status).toBe('done');
    store.deleteTodo(first.todoId);
    expect(store.reading().items).toHaveLength(1);
    expect(store.addReadingTodo(item.id, {})).toMatchObject({ created: true });
    expect(store.todos()[0].id).not.toBe(first.todoId);
  });

  it('preserves a task and its source snapshot when the shelf entry is removed; restoring reconnects it', () => {
    const item = store.addReading({ title: 'Saved article', type: 'article', url: 'https://example.org/article' });
    const task = store.addReadingTodo(item.id, {}).todo;
    store.editReading(item.id, { title: 'Revised article' });
    expect(store.todos()[0].source).toMatchObject({ title: 'Revised article', available: true });
    expect(store.todos()[0].title).toBe('Saved article');
    store.deleteReading(item.id);
    expect(store.todos()[0]).toMatchObject({ id: task.id, source: { title: 'Saved article', available: false, url: item.url } });
    expect(() => store.addReadingTodo(item.id, {})).toThrow('书架条目不存在或已移除');
    store.restoreReading({ ids: [item.id] });
    expect(store.todos()[0].source).toMatchObject({ title: 'Revised article', available: true });
    expect(store.addReadingTodo(item.id, {})).toMatchObject({ created: false, todoId: task.id });
  });

  it('links formal reports and marks moved or hidden reports unavailable without deleting the task or report file', () => {
    const directory = join(root, 'reports', '每日AI科技早报'); mkdirSync(directory, { recursive: true });
    const file = join(directory, '2026-09-27_AI科技早报.pdf'); writeFileSync(file, '%PDF-1.7\nReport');
    const report = store.reading().items[0];
    const task = store.addReadingTodo(report.id, {}).todo;
    expect(task.source).toMatchObject({ id: report.id, type: 'article', available: true, url: '' });
    store.deleteReading(report.id);
    expect(store.todos()[0].source?.available).toBe(false);
    expect(readFileSync(file, 'utf8')).toContain('%PDF');
    store.restoreReading({ ids: [report.id] });
    rmSync(file);
    expect(reload().todos()[0]).toMatchObject({ id: task.id, source: { available: false } });
  });

  it('supports 300-character shelf titles and rejects forged source metadata or invalid dates without writes', () => {
    const item = store.addReading({ title: '书'.repeat(300), type: 'book' });
    const before = readFileSync(join(root, 'personal.json'), 'utf8');
    expect(() => store.addReadingTodo(item.id, { dueDate: '2026-02-30' })).toThrow('到期日期无效');
    expect(() => store.addReadingTodo(item.id, { source: { url: 'javascript:alert(1)' } })).toThrow('不支持的字段');
    expect(() => store.addReadingTodo(item.id, { title: '' })).toThrow();
    expect(readFileSync(join(root, 'personal.json'), 'utf8')).toBe(before);
    expect(store.addReadingTodo(item.id, {}).todo.title).toHaveLength(200);
    expect(store.todos()[0].source?.title).toHaveLength(300);
  });

  it('does not retain managed attachment bytes after permanent shelf removal', async () => {
    const original = join(root, 'original.md'); writeFileSync(original, '# Learning notes');
    const upload = await store.readingAttachments.stage('notes.md', Readable.from(readFileSync(original)));
    const imported = store.importQuickReading({ items: [{ uploadId: upload.uploadId }] });
    const item = imported.items[0];
    const managed = store.readingAttachment(item.id).path;
    const task = store.addReadingTodo(item.id, {}).todo;
    expect(task.source).toMatchObject({ available: true, url: '' });
    store.deleteReading(item.id);
    const removed = store.readingTrash().items.find(entry => entry.item.id === item.id)!;
    store.purgeReading(item.id, { deletedAt: removed.deletedAt });
    expect(existsSync(managed)).toBe(false);
    expect(readFileSync(original, 'utf8')).toBe('# Learning notes');
    expect(reload().todos()[0]).toMatchObject({ id: task.id, source: { available: false } });
  });

  it('exposes the idempotent API, blocks unknown items, and keeps existing manual todos compatible', async () => {
    const item = store.addReading({ title: 'API testing', type: 'book' });
    store.addTodo({ title: 'An unrelated task' });
    server = createPersonalApp(store).listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test address');
    const base = `http://127.0.0.1:${address.port}/api/personal`;
    const post = (id: string) => fetch(`${base}/reading/${encodeURIComponent(id)}/todo`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en' }, body: '{}' });
    const responses = await Promise.all([post(item.id), post(item.id)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 201]);
    const [a, b] = await Promise.all(responses.map(response => response.json())); expect(a.todoId).toBe(b.todoId);
    expect(store.todos()).toHaveLength(2);
    expect(store.todos().find(todo => todo.title === 'An unrelated task')?.source).toBeUndefined();
    const missing = await post('missing'); expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ message: 'The shelf item is unavailable or has been removed.' });
    await fetch(`${base}/todos/${a.todoId}`, { method: 'DELETE' });
    expect(store.todos()).toHaveLength(1); expect(store.reading().items).toHaveLength(1);
  });
});
