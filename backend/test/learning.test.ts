import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { PersonalStore } from '../src/personal/store';
import { createPersonalApp } from '../src/personal/app';
import { LEARNING_TRASH_MS } from '../src/personal/learning';

let root: string, file: string, server: Server | undefined;
const makeStore = () => new PersonalStore(file, undefined, join(root, 'reports'));
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dailyhouse-learning-')); file = join(root, 'personal.json'); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-29T14:00:00Z')); });
afterEach(async () => { vi.useRealTimers(); if (server) { const closing = new Promise<void>(resolve => server!.close(() => resolve())); server.closeAllConnections(); await closing; server = undefined; } rmSync(root, { recursive: true, force: true }); });

describe('long-term study plans', () => {
  it('applies storage limits after URL normalization so accepted links remain reloadable', () => {
    const store = makeStore(); let plan = store.addLearning({ title: 'Resource limits' });
    const before = readFileSync(file, 'utf8');
    expect(() => store.addLearningEntry(plan.id, { revision: plan.revision, kind: 'resource', links: [{ url: `https://example.com/${'学'.repeat(300)}` }] })).toThrow('2048');
    expect(readFileSync(file, 'utf8')).toBe(before);
    const hostname = Array.from({ length: 4 }, () => 'a'.repeat(60)).join('.');
    plan = store.addLearningEntry(plan.id, { revision: plan.revision, kind: 'resource', links: [{ url: `https://${hostname}/paper` }] });
    expect(plan.entries[1].links[0].title).toHaveLength(200);
    expect(makeStore().learning(plan.id)).toEqual(plan);
  });
  it('keeps plans separate from ideas, persists ordered updates and lists only summaries', () => {
    const store = makeStore();
    const idea = store.addIdea({ title: 'Game idea', content: 'A passing thought' });
    let plan = store.addLearning({ title: '  Data structures  ', course: 'CS 253', goal: 'Understand trees', nextStep: 'Read chapter 3', dueDate: '2026-12-01' });
    const first = plan.entries[0];
    plan = store.addLearningEntry(plan.id, { revision: plan.revision, kind: 'question', content: 'Why balance a tree?' });
    vi.setSystemTime(new Date('2026-09-29T13:00:00Z'));
    plan = store.addLearningEntry(plan.id, { revision: plan.revision, kind: 'milestone', content: 'Implemented AVL rotations' });
    expect(plan.title).toBe('Data structures'); expect(plan.entries.map(entry => entry.kind)).toEqual(['initial', 'question', 'milestone']);
    expect(plan.entries[0]).toEqual(first);
    expect(plan.entries.map(entry => entry.createdAt)).toEqual([...plan.entries.map(entry => entry.createdAt)].sort());
    expect(makeStore().learning(plan.id)).toEqual(plan);
    expect(store.learningPlans().items[0]).toMatchObject({ entryCount: 3, preview: 'Implemented AVL rotations' });
    expect(store.learningPlans().items[0]).not.toHaveProperty('entries');
    expect(store.idea(idea.id).entries).toHaveLength(1);
  });

  it('edits updates in place, removes a link independently and rejects stale writes', () => {
    const store = makeStore(); let plan = store.addLearning({ title: 'ML', goal: 'Learn regression' });
    const link1 = { id: randomUUID(), title: 'Lecture', url: 'https://example.com/lecture' }, link2 = { id: randomUUID(), title: 'Notes', url: 'https://example.com/notes' };
    plan = store.addLearningEntry(plan.id, { revision: plan.revision, kind: 'resource', content: 'Regression resources', links: [link1, link2] });
    const entry = plan.entries[1], revision = plan.revision;
    plan = store.editLearningEntry(plan.id, entry.id, { revision, kind: 'progress', content: 'Read the lecture', links: [link2] });
    expect(plan.entries[1]).toMatchObject({ id: entry.id, createdAt: entry.createdAt, links: [link2] });
    expect(() => store.editLearning(plan.id, { revision, title: 'Stale edit' })).toThrow('已更新');
    expect(store.learning(plan.id)).toEqual(plan);
    expect(() => store.addLearningEntry(plan.id, { revision: plan.revision, kind: 'resource', links: [link2] })).toThrow('复用');
  });

  it('deduplicates plan and entry tasks, preserves edited tasks and never marks the plan done automatically', () => {
    const store = makeStore(); let plan = store.addLearning({ title: 'Algorithms', nextStep: 'Solve exercise 1' });
    const first = store.addLearningTodo(plan.id, { revision: plan.revision, dueDate: '2026-09-29' });
    store.editTodo(first.todoId, { title: 'My revised task', dueDate: '2026-10-02', done: true });
    const again = store.addLearningTodo(plan.id, { revision: plan.revision, dueDate: '2026-09-29' });
    expect(again).toMatchObject({ created: false, todoId: first.todoId, todo: { title: 'My revised task', dueDate: '2026-10-02', done: true } });
    expect(store.learning(plan.id).status).toBe('active'); expect(store.learning(plan.id).entries).toHaveLength(1);
    plan = store.addLearningEntry(plan.id, { revision: plan.revision, kind: 'progress', content: 'Finished exercise 1', nextStep: 'Solve exercise 2' });
    const entryTask = store.addLearningTodo(plan.id, { revision: plan.revision, entryId: plan.entries[1].id, dueDate: '2026-09-29' });
    expect(entryTask.todoId).not.toBe(first.todoId); expect(store.todos()).toHaveLength(2);
    store.deleteTodo(entryTask.todoId); expect(store.learning(plan.id)).toEqual(plan);
    expect(store.addLearningTodo(plan.id, { revision: plan.revision, entryId: plan.entries[1].id }).created).toBe(true);
    plan = store.editLearning(plan.id, { revision: plan.revision, nextStep: 'Review chapter 2' });
    expect(store.todos().find(todo => todo.id === first.todoId)?.source?.available).toBe(false);
    expect(store.addLearningTodo(plan.id, { revision: plan.revision }).created).toBe(true);
  });

  it('requires confirmation and recovers individual entries at their original position with links and tasks', () => {
    const store = makeStore(); let plan = store.addLearning({ title: 'AI', nextStep: 'Read chapter' });
    plan = store.addLearningEntry(plan.id, { revision: plan.revision, kind: 'progress', content: 'First update', nextStep: 'Run the notebook', links: [{ title: 'Notebook', url: 'https://example.com/notebook' }] });
    const entry = plan.entries[1]; const task = store.addLearningTodo(plan.id, { revision: plan.revision, entryId: entry.id });
    plan = store.addLearningEntry(plan.id, { revision: plan.revision, kind: 'question', content: 'Second update' });
    expect(() => store.deleteLearningEntry(plan.id, entry.id, { revision: plan.revision })).toThrow('确认');
    plan = store.deleteLearningEntry(plan.id, entry.id, { revision: plan.revision, confirmed: true });
    expect(plan.entries.map(item => item.content)).toEqual(['AI', 'Second update']); expect(plan.removedEntries[0].links).toEqual(entry.links);
    expect(store.todos().find(todo => todo.id === task.todoId)?.source?.available).toBe(false);
    plan = makeStore().restoreLearningEntry(plan.id, entry.id, { revision: plan.revision });
    expect(plan.entries[1]).toEqual(entry); expect(plan.removedEntries).toEqual([]);
    expect(makeStore().todos().find(todo => todo.id === task.todoId)?.source?.available).toBe(true);
    plan = makeStore().deleteLearningEntry(plan.id, plan.entries[0].id, { revision: plan.revision, confirmed: true });
    expect(plan.entries).toHaveLength(2); // The automatically created starting point is deletable, too.
  });

  it('recovers a complete plan while keeping independent tasks and other records intact', () => {
    const store = makeStore(); const other = store.addLearning({ title: 'Other course' });
    let plan = store.addLearning({ title: 'Research', nextStep: 'Read the paper' });
    plan = store.addLearningEntry(plan.id, { revision: plan.revision, kind: 'resource', content: '', links: [{ title: 'Paper', url: 'https://example.com/paper' }] });
    const task = store.addLearningTodo(plan.id, { revision: plan.revision });
    expect(() => store.deleteLearning(plan.id, { revision: plan.revision })).toThrow('确认');
    store.deleteLearning(plan.id, { revision: plan.revision, confirmed: true });
    expect(() => store.learning(plan.id)).toThrow('不存在'); expect(store.learning(other.id)).toBeTruthy();
    expect(store.todos()[0]).toMatchObject({ id: task.todoId, source: { available: false } });
    expect(store.learningTrash().items[0]).toMatchObject({ id: plan.id, entryCount: 2 });
    const restored = makeStore().restoreLearning(plan.id, { revision: plan.revision });
    expect(restored.entries).toEqual(plan.entries); expect(restored.revision).toBe(plan.revision + 1);
    expect(makeStore().todos()[0]).toMatchObject({ id: task.todoId, source: { available: true } });
  });

  it('expires removed entries and parents after 30 days without deleting their tasks', () => {
    const store = makeStore(); let plan = store.addLearning({ title: 'Course', nextStep: 'Keep this task' });
    const task = store.addLearningTodo(plan.id, { revision: plan.revision });
    const initial = plan.entries[0]; plan = store.deleteLearningEntry(plan.id, initial.id, { revision: plan.revision, confirmed: true });
    const now = Date.now(); vi.setSystemTime(now + LEARNING_TRASH_MS - 1); expect(store.learning(plan.id).removedEntries).toHaveLength(1);
    vi.setSystemTime(now + LEARNING_TRASH_MS); expect(store.learning(plan.id).removedEntries).toHaveLength(0);
    expect(() => store.restoreLearningEntry(plan.id, initial.id, { revision: plan.revision })).toThrow('30 天');
    store.deleteLearning(plan.id, { revision: plan.revision, confirmed: true }); vi.setSystemTime(Date.now() + LEARNING_TRASH_MS);
    expect(store.learningTrash().items).toEqual([]); expect(() => store.restoreLearning(plan.id, { revision: plan.revision })).toThrow('30 天');
    store.addTodo({ title: 'Prune expired snapshots' });
    expect(JSON.parse(readFileSync(file, 'utf8')).learningTrash).toEqual([]);
    expect(store.todos().find(todo => todo.id === task.todoId)).toBeTruthy();
  });

  it('rejects unsafe links, invalid dates, unsupported fields and missing actions without mutation', () => {
    const store = makeStore(); const plan = store.addLearning({ title: 'Validation' }); const bytes = readFileSync(file, 'utf8');
    for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///C:/test', 'https://user:pass@example.com/paper', '/relative']) expect(() => store.addLearningEntry(plan.id, { revision: 1, kind: 'resource', links: [{ url }] })).toThrow();
    for (const body of [{ title: '' }, { title: 'Date', dueDate: '2026-02-31' }, { title: 'Unknown', aiPrompt: 'no' }]) expect(() => store.addLearning(body)).toThrow();
    expect(() => store.addLearningTodo(plan.id, { revision: 1 })).toThrow('下一步');
    expect(() => store.addLearningTodo(plan.id, { revision: 1, entryId: '' })).toThrow('标识');
    expect(() => store.addLearningEntry(plan.id, { revision: 1, kind: 'initial', content: 'Duplicate start' })).toThrow('类型');
    expect(readFileSync(file, 'utf8')).toBe(bytes);
  });

  it('loads legacy personal data without changing it and fails closed on malformed learning snapshots', () => {
    const store = makeStore(); const todo = store.addTodo({ title: 'Existing task' }); const idea = store.addIdea({ title: 'Existing idea', content: 'Keep me' });
    const saved = JSON.parse(readFileSync(file, 'utf8')); delete saved.learningPlans; delete saved.learningTrash; writeFileSync(file, JSON.stringify(saved));
    const before = readFileSync(file, 'utf8'); const legacy = makeStore(); expect(legacy.learningPlans().items).toEqual([]); expect(readFileSync(file, 'utf8')).toBe(before);
    const plan = legacy.addLearning({ title: 'New course' }); expect(legacy.todos()[0].id).toBe(todo.id); expect(legacy.idea(idea.id).title).toBe('Existing idea');
    const damaged = JSON.parse(readFileSync(file, 'utf8')); damaged.learningPlans[0].entries[0].links = [{ title: 'No ID', url: 'https://example.com' }];
    writeFileSync(file, JSON.stringify(damaged)); const corrupt = readFileSync(file, 'utf8'); expect(() => makeStore()).toThrow('Saved learning plans are invalid'); expect(readFileSync(file, 'utf8')).toBe(corrupt);
    expect(plan.id).toBeTruthy();
  });

  it('exposes all CRUD routes with revision checks, English errors and same-origin protection', async () => {
    server = createPersonalApp(makeStore()).listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/personal/learning`;
    const call = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    let response = await call('', 'POST', { title: '保留原文', goal: '原文目标', nextStep: 'Read' }); expect(response.status).toBe(201); let plan = await response.json();
    expect(plan.title).toBe('保留原文'); expect(plan.entries[0].content).toBe('原文目标');
    response = await call(`/${plan.id}`, 'PATCH', { revision: 0, title: 'stale' }); expect(response.status).toBe(409); expect((await response.json()).message).toContain('new updates');
    response = await call('', 'POST', { title: '' }); expect(response.status).toBe(400); expect((await response.json()).message).toContain('200 characters');
    response = await call(`/${plan.id}/entries`, 'POST', { revision: plan.revision, kind: 'progress', content: 'Read notes', links: [{ url: 'https://example.com/notes' }] }); expect(response.status).toBe(201); plan = await response.json();
    response = await call(`/${plan.id}/todo`, 'POST', { revision: plan.revision, dueDate: '2026-09-29' }); expect(response.status).toBe(201); expect((await call(`/${plan.id}/todo`, 'POST', { revision: plan.revision })).status).toBe(200);
    const entryId = plan.entries[1].id;
    response = await call(`/${plan.id}/entries/${entryId}`, 'DELETE', { revision: plan.revision, confirmed: true }); expect(response.status).toBe(200); plan = await response.json();
    response = await call(`/${plan.id}/entries/${entryId}/restore`, 'POST', { revision: plan.revision }); expect(response.status).toBe(200); plan = await response.json();
    expect((await call(`/${plan.id}`, 'DELETE', { revision: plan.revision, confirmed: true })).status).toBe(204);
    expect((await (await call('/trash')).json()).items).toHaveLength(1);
    expect((await call(`/${plan.id}/restore`, 'POST', { revision: plan.revision })).status).toBe(200);
    expect((await call('', 'POST', { title: 'Blocked' }, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await fetch(`${base}/${plan.id}`, { method: 'DELETE', body: 'revision=1' })).status).toBe(415);
  });
});
