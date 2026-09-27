import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createPersonalApp } from '../src/personal/app';
import { PersonalStore } from '../src/personal/store';
import type { PersonalTodo, WorkflowItem } from '../src/personal/types';

let root: string;
let dataFile: string;
let server: Server | undefined;
const makeStore = () => new PersonalStore(dataFile, undefined, join(root, 'reports'));
const headers = { 'Content-Type': 'application/json', 'Accept-Language': 'en' };
async function serve(store: PersonalStore): Promise<string> {
  server = createPersonalApp(store).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  return `http://127.0.0.1:${address.port}/api/personal`;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'garden-workflow-'));
  dataFile = join(root, 'personal.json');
});
afterEach(async () => {
  if (server) {
    const closing = new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closing;
    server = undefined;
  }
  expect(root.startsWith(join(tmpdir(), 'garden-workflow-'))).toBe(true);
  rmSync(root, { recursive: true, force: true });
});

describe('personal learning workflow', () => {
  it('adopts v1 data without rewriting it and preserves old data through workflow mutations', () => {
    const todo = { id: 'old-task', title: 'Existing task', done: false, createdAt: '2026-09-20T12:00:00Z', dueDate: null };
    const legacy = { version: 1, settings: { calendarUrl: 'https://p01-caldav.icloud.com/published/private-token', animationEnabled: false }, todos: [todo] };
    writeFileSync(dataFile, JSON.stringify(legacy));
    const store = makeStore();
    expect(store.workflow()).toEqual({ items: [] });
    expect(JSON.parse(readFileSync(dataFile, 'utf8'))).toEqual(legacy);
    const item = store.addWorkflow({ title: '  学习注意力机制  ' });
    expect(item).toMatchObject({ title: '学习注意力机制', kind: 'idea', track: 'other', status: 'inbox', notes: '', excerpt: '', nextAction: '', resumeAt: '', question: '', url: '', readingId: null, todoId: null });
    expect(makeStore().workflow().items).toEqual([item]);
    const saved = JSON.parse(readFileSync(dataFile, 'utf8'));
    expect(saved.version).toBe(1);
    expect(saved.todos).toEqual([todo]);
    expect(saved.settings.calendarUrl).toBe(legacy.settings.calendarUrl);
    expect(store.settings().animationEnabled).toBe(false);
    expect(saved.readingItems).toEqual([]);
    item.title = 'External mutation';
    const returned = store.workflow();
    returned.items[0].title = 'Another external mutation';
    expect(store.workflow().items[0].title).toBe('学习注意力机制');
  });

  it('edits every content field, archives and restores without removing source material or completing tasks', () => {
    const store = makeStore();
    const item = store.addWorkflow({ title: 'Idea', nextAction: 'Read the introduction' });
    const linked = store.workflowTodo(item.id, { dueDate: null });
    const content = { title: 'Transformer paper', kind: 'paper', track: 'research', status: 'active', url: 'https://example.com/paper', notes: 'Notes', excerpt: 'Actual excerpt', nextAction: 'Explain attention shapes', resumeAt: 'Section 3, page 4', question: 'Why scale the dot product?' };
    const edited = store.editWorkflow(item.id, content);
    expect(edited).toMatchObject({ ...content, todoId: linked.todo.id, createdAt: item.createdAt });
    expect(store.editWorkflow(item.id, { status: 'archived' }).status).toBe('archived');
    expect(store.editWorkflow(item.id, { status: 'active' }).status).toBe('active');
    expect(store.editWorkflow(item.id, { status: 'done' }).status).toBe('done');
    expect(store.todos()[0].done).toBe(false);
    expect(makeStore().workflow().items[0]).toMatchObject({ ...content, status: 'done' });
    expect(store.editWorkflow(item.id, { status: 'parked' }).status).toBe('parked');
  });

  it('strictly validates keys, types, limits and safe URLs without writing invalid changes', () => {
    const store = makeStore();
    for (const input of [null, [], {}, { title: '' }, { title: ' ' }, { title: 1 }, { title: 'x', id: 'fake' }, { title: 'x', todoId: 'fake' }, { title: 'x', readingId: 'fake' }, { title: 'x', createdAt: 'fake' }]) expect(() => store.addWorkflow(input)).toThrow();
    expect(existsSync(dataFile)).toBe(false);
    const item = store.addWorkflow({ title: 'Valid' });
    const before = readFileSync(dataFile, 'utf8');
    const limits = { title: 200, notes: 12000, excerpt: 18000, nextAction: 200, resumeAt: 200, question: 2000 };
    for (const [key, limit] of Object.entries(limits)) {
      for (const value of [null, 1, [], {}, 'x'.repeat(limit + 1)]) expect(() => store.editWorkflow(item.id, { [key]: value })).toThrow();
    }
    for (const url of [null, 1, 'javascript:alert(1)', 'file:///C:/secret.pdf', 'data:text/plain,hello', 'https://user:secret@example.com', 'https://example.com/\nprivate', 'http:example.com', 'https://example.com/' + 'x'.repeat(2000)]) expect(() => store.editWorkflow(item.id, { url })).toThrow();
    for (const content of [{ status: 'reading' }, { status: true }, { track: 'cs' }, { track: null }, { kind: 'tutorial' }, { kind: [] }, { todoId: null }, { readingId: null }, { id: item.id }, { updatedAt: '' }]) expect(() => store.editWorkflow(item.id, content)).toThrow();
    expect(readFileSync(dataFile, 'utf8')).toBe(before);
    expect(store.workflow().items).toEqual([item]);
    const maxContent = Object.fromEntries(Object.entries(limits).map(([key, limit]) => [key, '学'.repeat(limit)]));
    expect(store.editWorkflow(item.id, maxContent).excerpt).toHaveLength(18000);
    expect(store.editWorkflow(item.id, { url: 'https://example.com/论文', notes: '', excerpt: '' }).url).toBe('https://example.com/论文');
    expect(store.editWorkflow(item.id, { url: '' }).url).toBe('');
  });

  it('imports manual reading once, preserves later edits and does not alter the shelf', () => {
    const store = makeStore();
    const reading = store.addReading({ title: 'ML lecture', type: 'video', url: 'https://www.youtube.com/watch?v=example', notes: 'At 10:30', status: 'reading' });
    const imported = store.importWorkflowReading({ id: reading.id });
    expect(imported).toMatchObject({ title: reading.title, url: reading.url, notes: reading.notes, kind: 'video', track: 'other', status: 'active', readingId: reading.id });
    const edited = store.editWorkflow(imported.id, { title: 'My learning session', track: 'aiml', status: 'parked', nextAction: 'Implement a loss function' });
    store.editReading(reading.id, { title: 'Changed shelf title', notes: 'Changed shelf notes' });
    const before = readFileSync(dataFile, 'utf8');
    expect(store.importWorkflowReading({ id: reading.id })).toEqual(edited);
    expect(readFileSync(dataFile, 'utf8')).toBe(before);
    expect(makeStore().workflow().items).toEqual([edited]);
    expect(store.reading().items[0].notes).toBe('Changed shelf notes');
    for (const input of [{ id: 'report:tech:2026-09-25' }, { id: 'missing' }, { id: null }, { id: 1 }, { id: reading.id, title: 'Fake' }, {}]) expect(() => store.importWorkflowReading(input)).toThrow();
    const longTitle = store.addReading({ title: 'x'.repeat(201), type: 'book' });
    expect(() => store.importWorkflowReading({ id: longTitle.id })).toThrow('标题');
    for (const [type, kind, status, expectedStatus] of [['github', 'project', 'unread', 'inbox'], ['book', 'article', 'done', 'done'], ['course', 'course', 'reading', 'active']]) {
      const source = store.addReading({ title: type, type, status, url: 'https://example.com' });
      expect(store.importWorkflowReading({ id: source.id })).toMatchObject({ kind, status: expectedStatus, readingId: source.id });
    }
  });

  it('creates and links a saved next action atomically, deduplicates retries and advances completed work', () => {
    const store = makeStore();
    const item = store.addWorkflow({ title: 'Paper' });
    expect(() => store.workflowTodo(item.id, { dueDate: null })).toThrow('下一步');
    store.editWorkflow(item.id, { nextAction: 'Work through equation 3' });
    const result = store.workflowTodo(item.id, { dueDate: '2026-10-01' });
    expect(result).toMatchObject({ created: true, item: { todoId: result.todo.id }, todo: { title: 'Work through equation 3', dueDate: '2026-10-01', done: false } });
    const persisted = makeStore();
    expect(persisted.workflow().items[0].todoId).toBe(persisted.todos()[0].id);
    persisted.editTodo(result.todo.id, { title: 'Renamed task' });
    persisted.editWorkflow(item.id, { nextAction: 'A different saved next action' });
    expect(persisted.workflowTodo(item.id, { dueDate: '2026-10-02' })).toMatchObject({ created: false, todo: { id: result.todo.id, title: 'Renamed task', done: false, dueDate: '2026-10-01' } });
    expect(persisted.todos()).toHaveLength(1);
    persisted.editTodo(result.todo.id, { title: 'A different saved next action', done: true });
    expect(persisted.workflowTodo(item.id, { dueDate: null })).toMatchObject({ created: false, todo: { id: result.todo.id, done: true } });
    expect(persisted.todos()).toHaveLength(1);
    persisted.editWorkflow(item.id, { nextAction: '' });
    expect(persisted.workflowTodo(item.id, { dueDate: null }).created).toBe(false);
    persisted.editWorkflow(item.id, { nextAction: 'The next step after completion' });
    const next = persisted.workflowTodo(item.id, { dueDate: '2026-10-03' });
    expect(next).toMatchObject({ created: true, item: { todoId: next.todo.id }, todo: { title: 'The next step after completion', done: false, dueDate: '2026-10-03' } });
    expect(next.todo.id).not.toBe(result.todo.id);
    expect(persisted.todos()).toHaveLength(2);
    expect(persisted.todos().find(todo => todo.id === result.todo.id)?.done).toBe(true);
    expect(persisted.workflowTodo(item.id, { dueDate: null })).toMatchObject({ created: false, todo: { id: next.todo.id } });
    expect(makeStore().workflow().items[0].todoId).toBe(next.todo.id);
    expect(makeStore().todos()).toHaveLength(2);
    persisted.deleteTodo(next.todo.id);
    const recreated = persisted.workflowTodo(item.id, { dueDate: null });
    expect(recreated.created).toBe(true);
    expect(recreated.todo.id).not.toBe(next.todo.id);
    expect(recreated.todo.title).toBe('The next step after completion');
    expect(makeStore().workflow().items[0].todoId).toBe(recreated.todo.id);
  });

  it('keeps both memory and disk unchanged if persistence or capacity checks fail', () => {
    const store = makeStore();
    const item = store.addWorkflow({ title: 'Safe write', nextAction: 'One action' });
    const before = readFileSync(dataFile, 'utf8');
    // Block only this fixture's pending file, simulating a write failure.
    mkdirSync(`${dataFile}.tmp`);
    expect(() => store.workflowTodo(item.id, { dueDate: null })).toThrow();
    expect(store.todos()).toEqual([]);
    expect(store.workflow().items).toEqual([item]);
    expect(readFileSync(dataFile, 'utf8')).toBe(before);
    rmSync(`${dataFile}.tmp`, { recursive: true });
    const todos: PersonalTodo[] = Array.from({ length: 5000 }, (_, index) => ({ id: `task-${index}`, title: 'Fixture', done: false, dueDate: null, createdAt: item.createdAt }));
    writeFileSync(dataFile, JSON.stringify({ ...JSON.parse(before), todos }));
    const full = makeStore();
    const fullBefore = readFileSync(dataFile, 'utf8');
    expect(() => full.workflowTodo(item.id, { dueDate: null })).toThrow('5000');
    expect(full.workflow().items[0].todoId).toBeNull();
    expect(readFileSync(dataFile, 'utf8')).toBe(fullBefore);
    const workflowItems = Array.from({ length: 5000 }, (_, index) => ({ ...item, id: `workflow-${index}` }));
    writeFileSync(dataFile, JSON.stringify({ ...JSON.parse(before), workflowItems }));
    const fullWorkflow = makeStore();
    expect(() => fullWorkflow.addWorkflow({ title: 'Beyond capacity' })).toThrow('5000');
    expect(fullWorkflow.editWorkflow('workflow-0', { status: 'archived' }).status).toBe('archived');
  });

  it('serves workflow routes with English errors, 404s and strict task payloads', async () => {
    const store = makeStore();
    const base = await serve(store);
    const request = (path: string, body: unknown, method = 'POST') => fetch(`${base}/workflow${path}`, { method, headers, body: JSON.stringify(body) });
    expect(await fetch(`${base}/workflow`).then(response => response.json())).toEqual({ items: [] });
    const created = await request('', { title: '中文标题', notes: '我的笔记', nextAction: 'Study gradients' });
    expect(created.status).toBe(201);
    const item = await created.json() as WorkflowItem;
    expect(item).toMatchObject({ title: '中文标题', notes: '我的笔记' });
    const invalid = await request(`/${encodeURIComponent(item.id)}`, { status: 'invalid' }, 'PATCH');
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('content-language')).toBe('en');
    expect(await invalid.json()).toEqual({ message: 'Choose a valid workflow status.' });
    for (const [path, method, body] of [['/missing', 'PATCH', { status: 'done' }], ['/missing/todo', 'POST', { dueDate: null }], ['/import-reading', 'POST', { id: 'missing' }]] as const) {
      const response = await request(path, body, method);
      expect(response.status).toBe(404);
    }
    for (const body of [{ dueDate: false }, { dueDate: '' }, { dueDate: '2026-02-31' }, { dueDate: null, title: 'Forged next action' }]) expect((await request(`/${encodeURIComponent(item.id)}/todo`, body)).status).toBe(400);
    const results = await Promise.all(Array.from({ length: 3 }, () => request(`/${encodeURIComponent(item.id)}/todo`, { dueDate: null })));
    expect(results.map(result => result.status).sort()).toEqual([200, 200, 201]);
    const links = await Promise.all(results.map(result => result.json())) as { item: WorkflowItem; todo: PersonalTodo; created: boolean }[];
    expect(new Set(links.map(link => link.todo.id)).size).toBe(1);
    expect(store.todos()).toHaveLength(1);
    const reading = store.addReading({ title: 'Book', type: 'book' });
    const imported = await request('/import-reading', { id: reading.id });
    expect(imported.status).toBe(200);
    expect(await imported.json()).toMatchObject({ readingId: reading.id });
  });

  it('accepts full Chinese excerpts within 128 KB while retaining other route limits', async () => {
    const base = await serve(makeStore());
    const body = { title: 'Paper', notes: '学'.repeat(12000), excerpt: '文'.repeat(18000), question: '问'.repeat(2000) };
    const response = await fetch(`${base}/workflow`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject(body);
    const excessive = await fetch(`${base}/workflow`, { method: 'POST', headers, body: JSON.stringify({ title: 'x', excerpt: '学'.repeat(50000) }) });
    expect(excessive.status).toBe(413);
    expect(await excessive.json()).toEqual({ message: 'The request body is too large.' });
    const ordinary = await fetch(`${base}/todos`, { method: 'POST', headers, body: JSON.stringify({ title: 'x'.repeat(40000) }) });
    expect(ordinary.status).toBe(413);
    expect(makeStore().workflow().items).toHaveLength(1);
  });
});
