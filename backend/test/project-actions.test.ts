import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { PersonalStore } from '../src/personal/store';
import { createPersonalApp } from '../src/personal/app';
import { ProjectResumeService } from '../src/personal/project-resume';
import type { ActionProject } from '../src/personal/project-actions';
import type { ProjectNextAction } from '../src/personal/types';

let root: string;
let store: PersonalStore;
let server: Server | undefined;
let visible: boolean;
let project: ActionProject;
const reload = () => {
  const next = new PersonalStore(join(root, 'personal.json'), undefined, join(root, 'reports'));
  next.configureProjectActions(id => visible && id === project.id ? project : undefined);
  return next;
};
const create = (extra: Record<string, unknown> = {}) => store.addProjectAction('project-a', { title: 'Add a garden gate', acceptance: 'The gate opens with a keyboard and a pointer.', threadId: 'thread-a', ...extra }).action;
const patch = (action: ProjectNextAction, values: Record<string, unknown>) => store.editProjectAction(action.projectId, action.id, { revision: action.revision, ...values });
const current = (id: string) => store.projectActions('project-a').items.find(item => item.id === id)!;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dailyhouse-actions-')); visible = true;
  project = { id: 'project-a', title: 'Garden', threads: [{ id: 'thread-a', title: 'Gate work', url: 'codex://threads/thread-a' }] };
  store = reload();
});
afterEach(async () => {
  if (server) { const closed = new Promise<void>(resolve => server!.close(() => resolve())); server.closeAllConnections(); await closed; server = undefined; }
  rmSync(root, { recursive: true, force: true });
});

describe('real-project next actions', () => {
  it('creates only for a visible registered project and known thread; never accepts supplied paths or URLs', () => {
    expect(() => store.addProjectAction('unknown', { title: 'Forged', acceptance: 'No' })).toThrow('项目不存在');
    for (const value of [{ threadId: 'other-project-thread' }, { path: 'C:/private' }, { thread: { url: 'javascript:alert(1)' } }, { title: '' }, { acceptance: ' ' }, { dueDate: '2026-02-30' }]) expect(() => create(value)).toThrow();
    expect(store.projectActions(project.id).items).toEqual([]);
    const action = create({ dueDate: '2026-12-15' });
    expect(action).toMatchObject({ projectId: 'project-a', projectTitle: 'Garden', status: 'active', dueDate: '2026-12-15', revision: 1, result: '', reason: '', completions: [], thread: project.threads[0] });
    expect(reload().projectActions(project.id).items).toEqual([action]);
  });

  it('deduplicates retried creates across reload, but never resurrects a deleted request', () => {
    const requestId = 'request-1234567890';
    const action = create({ requestId }); store = reload();
    expect(store.addProjectAction(project.id, { title: action.title, acceptance: action.acceptance, threadId: action.thread!.id, requestId })).toMatchObject({ created: false, action });
    expect(() => create({ title: 'Changed after an ambiguous request', requestId })).toThrow('保存过不同内容');
    project.threads = [];
    expect(create({ requestId })).toEqual(action);
    expect(() => create({ requestId: 'new-request-1234567890' })).toThrow('请选择');
    store.deleteProjectAction(project.id, action.id, { confirm: true, revision: action.revision });
    store = reload(); expect(() => create({ requestId })).toThrow('曾被删除');
    expect(create({ requestId: 'new-request-1234567890', threadId: null }).id).not.toBe(action.id);
  });

  it('requires reasons and completion evidence; reopening keeps every previous completion result', () => {
    let action = create();
    expect(() => patch(action, { status: 'blocked' })).toThrow('原因');
    expect(() => patch(action, { status: 'done' })).toThrow('完成结果');
    action = patch(action, { status: 'blocked', reason: 'Waiting for the keyboard interaction design' });
    action = patch(action, { status: 'paused', reason: 'Resume after class' });
    action = patch(action, { status: 'active' }); expect(action.reason).toBe('');
    action = patch(action, { status: 'done', result: 'Both interaction paths were verified.' });
    const first = action.completions[0]; expect(action.completedAt).toBe(first.completedAt);
    expect(() => patch(action, { result: 'Silently replace accepted evidence' })).toThrow('已保留');
    action = patch(action, { status: 'active' });
    expect(action.completedAt).toBeUndefined(); expect(action.result).toBe(first.result); expect(action.completions).toEqual([first]);
    expect(() => patch(action, { status: 'done' })).toThrow('完成结果');
    action = patch(action, { status: 'done', result: 'Rechecked after the screen-reader update.' });
    expect(action.completions).toHaveLength(2); expect(action.completions[0]).toEqual(first);
    expect(reload().projectActions(project.id).items[0]).toEqual(action);
  });

  it('rejects stale forms and stale deletion without losing data; existing thread snapshots survive refresh', () => {
    const initial = create(); let action = patch(initial, { title: 'Add an accessible gate' });
    expect(() => patch(initial, { title: 'Stale overwrite' })).toThrow('已变化');
    expect(() => store.deleteProjectAction(project.id, action.id, { confirm: true, revision: initial.revision })).toThrow('已变化');
    expect(() => store.deleteProjectAction(project.id, action.id, { revision: action.revision })).toThrow('请确认');
    project.threads = []; action = patch(action, { dueDate: '2026-10-01' });
    expect(action.thread?.id).toBe('thread-a');
    action = patch(action, { threadId: null }); expect(action.thread).toBeUndefined();
    store.deleteProjectAction(project.id, action.id, { confirm: true, revision: action.revision });
    expect(() => patch(action, { title: 'After deletion' })).toThrow('已删除');
  });

  it('creates one linked task, atomically synchronizes title/date both ways, and permits re-add after task deletion', () => {
    let action = create({ dueDate: '2026-10-02' }); const first = store.addProjectActionTodo(project.id, action.id, {});
    action = current(action.id);
    expect(first).toMatchObject({ created: true, todo: { title: action.title, dueDate: action.dueDate, source: { kind: 'project_action', id: action.id, available: true, linked: true, revision: action.revision } } });
    store = reload(); expect(store.addProjectActionTodo(project.id, action.id, {})).toMatchObject({ created: false, todoId: first.todoId });
    action = patch(action, { title: 'Build a small gate first', dueDate: '2026-10-03' });
    expect(store.todos()[0]).toMatchObject({ title: action.title, dueDate: action.dueDate });
    const todo = store.editTodo(first.todoId, { title: 'Finish the garden entrance', dueDate: null, actionRevision: action.revision });
    action = current(action.id); expect(action).toMatchObject({ title: todo.title, dueDate: null });
    const saved = JSON.parse(readFileSync(join(root, 'personal.json'), 'utf8'));
    expect(saved.todos[0].title).toBe(saved.projectActions[0].title);
    expect(() => store.editTodo(first.todoId, { title: 'Stale task edit', actionRevision: action.revision - 1 })).toThrow('已变化');
    store.deleteTodo(first.todoId); expect(current(action.id).todoId).toBeUndefined();
    const second = store.addProjectActionTodo(project.id, action.id, {}); expect(second.created).toBe(true); expect(second.todoId).not.toBe(first.todoId);
  });

  it('completes and reopens from either surface without fake results, duplicate completions, or a shelf cascade', () => {
    const shelf = store.addReading({ title: 'Related guide', type: 'book' });
    let action = create(); const { todoId } = store.addProjectActionTodo(project.id, action.id, {}); action = current(action.id);
    expect(() => store.editTodo(todoId, { done: true, actionRevision: action.revision })).toThrow('完成结果');
    store.editTodo(todoId, { done: true, result: 'Entrance opens and keyboard focus remains visible.', actionRevision: action.revision });
    action = current(action.id); expect(action.status).toBe('done'); expect(action.completions).toHaveLength(1);
    store.editTodo(todoId, { done: true, actionRevision: action.revision }); action = current(action.id);
    expect(action.completions).toHaveLength(1);
    store.editTodo(todoId, { done: false, actionRevision: action.revision }); action = current(action.id);
    expect(action.status).toBe('active'); expect(action.result).toContain('keyboard');
    action = patch(action, { status: 'done', result: 'Second verification passed.' });
    expect(store.todos()[0].done).toBe(true); expect(action.completions).toHaveLength(2);
    expect(store.reading().items[0]).toEqual(shelf);
  });

  it('keeps task/action consistency while a project is hidden and reconnects on restore without external work', () => {
    let action = create(); const { todoId } = store.addProjectActionTodo(project.id, action.id, {}); action = current(action.id);
    visible = false;
    expect(() => store.projectActions(project.id)).toThrow('已从小院移除');
    expect(store.todos()[0].source).toMatchObject({ linked: true, available: false });
    store.editTodo(todoId, { title: 'Finish while project is hidden', done: true, result: 'Verified in the original project.', actionRevision: action.revision });
    store = reload(); expect(store.todos()[0]).toMatchObject({ done: true, source: { linked: true, available: false, result: 'Verified in the original project.' } });
    visible = true;
    expect(current(action.id)).toMatchObject({ title: 'Finish while project is hidden', status: 'done', todoId });
    expect(store.todos()[0].source).toMatchObject({ linked: true, available: true });
  });

  it('deletes only a confirmed completion result, preserving other evidence and completed task state', () => {
    let action = create(); const { todoId } = store.addProjectActionTodo(project.id, action.id, {}); action = current(action.id);
    action = patch(action, { status: 'done', result: 'First verification' });
    const firstId = action.completions[0].id;
    action = patch(action, { status: 'active' }); action = patch(action, { status: 'done', result: 'Second verification' });
    const secondId = action.completions[1].id;
    expect(() => store.deleteProjectActionCompletion(project.id, action.id, secondId, { revision: action.revision })).toThrow('请确认');
    expect(() => store.deleteProjectActionCompletion(project.id, action.id, secondId, { confirm: true, revision: action.revision - 1 })).toThrow('已变化');
    const completedAt = action.completedAt;
    action = store.deleteProjectActionCompletion(project.id, action.id, secondId, { confirm: true, revision: action.revision });
    expect(action).toMatchObject({ status: 'done', result: '', completedAt }); expect(action.completions.map(entry => entry.id)).toEqual([firstId]);
    expect(store.todos().find(todo => todo.id === todoId)).toMatchObject({ done: true, source: { result: '', linked: true } });
    store = reload(); expect(current(action.id).result).toBe('');
    expect(() => store.deleteProjectActionCompletion(project.id, action.id, secondId, { confirm: true, revision: action.revision })).toThrow('已删除');
    action = patch(current(action.id), { status: 'active' }); action = patch(action, { status: 'done', result: 'New verification after removal' });
    action = store.deleteProjectActionCompletion(project.id, action.id, firstId, { confirm: true, revision: action.revision });
    expect(action.result).toBe('New verification after removal'); expect(action.completions).toHaveLength(1);
  });

  it('migrates completion identifiers without a read-time write or changing saved result evidence', () => {
    let action = patch(create(), { status: 'done', result: 'Earlier result' });
    const path = join(root, 'personal.json'); const saved = JSON.parse(readFileSync(path, 'utf8'));
    delete saved.projectActions[0].currentResultId; delete saved.projectActions[0].completions[0].id; writeFileSync(path, JSON.stringify(saved));
    const bytes = readFileSync(path, 'utf8'); store = reload(); action = current(action.id);
    expect(action.completions[0].id).toMatch(/^[a-f0-9]{32}$/); expect(action.currentResultId).toBe(action.completions[0].id);
    expect(reload().projectActions(project.id).items[0].completions).toEqual(action.completions); expect(readFileSync(path, 'utf8')).toBe(bytes);
  });

  it('prunes expired project actions on the next task read and preserves detached task snapshots', () => {
    const action = create(); const { todoId } = store.addProjectActionTodo(project.id, action.id, {});
    let expired = false; store.configureProjectActions(id => !expired && id === project.id ? project : undefined, () => expired ? [project.id] : []);
    expired = true;
    expect(store.todos()[0]).toMatchObject({ id: todoId, source: { linked: false, available: false, acceptance: action.acceptance } });
    expect(JSON.parse(readFileSync(join(root, 'personal.json'), 'utf8')).projectActions).toEqual([]);
    expect(store.editTodo(todoId, { done: true })).toMatchObject({ done: true });
  });

  it('deleting an action preserves the task snapshot and permits standalone edits without changing unrelated records', () => {
    store.addTodo({ title: 'An unrelated manual task' });
    let action = create(); const { todoId } = store.addProjectActionTodo(project.id, action.id, {}); action = current(action.id);
    store.deleteProjectAction(project.id, action.id, { confirm: true, revision: action.revision }); store = reload();
    expect(store.todos()[0].source).toMatchObject({ id: action.id, linked: false, available: false, acceptance: action.acceptance });
    expect(() => store.editTodo(todoId, { done: true, result: 'Stale result', actionRevision: action.revision })).toThrow('已不再关联');
    expect(store.editTodo(todoId, { done: true, title: 'Independent task' })).toMatchObject({ done: true, title: 'Independent task' });
    expect(store.todos().find(todo => todo.title === 'An unrelated manual task')).toBeDefined();
  });

  it('loads older personal data without rewriting or losing the legacy project linkage', () => {
    const todo = store.addTodo({ title: 'Legacy task' }); const path = join(root, 'personal.json');
    const old = JSON.parse(readFileSync(path, 'utf8')); delete old.projectActions; old.projectTodoLinks = { 'legacy-action-key': todo.id }; writeFileSync(path, JSON.stringify(old));
    const bytes = readFileSync(path, 'utf8'); store = reload(); expect(readFileSync(path, 'utf8')).toBe(bytes);
    create(); expect(JSON.parse(readFileSync(path, 'utf8')).projectTodoLinks).toEqual(old.projectTodoLinks); expect(store.todos()[0]).toEqual(todo);
    const bad = JSON.parse(readFileSync(path, 'utf8')); bad.projectActions[0].revision = 'bad'; writeFileSync(path, JSON.stringify(bad));
    expect(reload).toThrow('Project action data is invalid');
  });

  it('provides authenticated-local routes and never mutates Codex, GitHub or project files', async () => {
    const workspace = join(root, 'workspace'); mkdirSync(workspace); writeFileSync(join(workspace, 'original.txt'), 'Preserve me');
    const rpc = { call: vi.fn(async (method: string) => {
      if (method === 'project/list') return { data: [{ id: 'project-a', name: 'Garden', roots: [{ path: workspace }], updatedAt: 1 }] };
      if (method === 'thread/list') return { data: [{ id: 'thread-a', name: 'Gate work', preview: 'Add a gate', updatedAt: 1000 }] };
      throw Error('Not supported');
    }) as any, close: vi.fn() };
    const github = { repos: vi.fn(async () => []), login: vi.fn(async () => 'AlexShen-Oguri'), create: vi.fn() };
    const git = vi.fn(async () => '');
    const projects = new ProjectResumeService(join(root, 'projects.json'), { repositoryTitle: () => 'Fixture' }, { rpc, github, git, snapshot: async () => ({ status: 'not_repository' }) });
    server = createPersonalApp(store, undefined, 3456, undefined, { projects }).listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing address');
    const base = `http://127.0.0.1:${address.port}/api/personal`;
    const request = (url: string, method = 'GET', body?: unknown) => fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const created = await request('/project-resume/project-a/actions', 'POST', { title: 'Gate', acceptance: 'Works with keyboard', threadId: 'thread-a', requestId: 'request-1234567890' });
    expect(created.status).toBe(201); const action = await created.json();
    const duplicate = await request('/project-resume/project-a/actions', 'POST', { title: 'Gate', acceptance: 'Works with keyboard', threadId: 'thread-a', requestId: 'request-1234567890' }); expect(duplicate.status).toBe(200);
    const linked = await request(`/project-resume/project-a/actions/${action.id}/todo`, 'POST', {}); expect(linked.status).toBe(201);
    const bad = await request(`/project-resume/project-a/actions/${action.id}`, 'PATCH', { revision: 1, status: 'done', result: 'Stale' }); expect(bad.status).toBe(409); expect(await bad.json()).toEqual({ message: 'This next action changed. Refresh and try again.' });
    const wrongProject = await request(`/project-resume/project-b/actions/${action.id}`, 'PATCH', { revision: 2, title: 'Forged' }); expect(wrongProject.status).toBe(404);
    expect((await request('/project-resume/project-a', 'DELETE')).status).toBe(204);
    expect((await request('/project-resume/project-a/actions')).status).toBe(404);
    expect((await request('/todos')).status).toBe(200); expect(store.todos()[0].source).toMatchObject({ linked: true, available: false });
    await request('/project-resume/restore', 'POST', { ids: ['project-a'] });
    expect((await request('/project-resume/project-a/actions')).status).toBe(200);
    expect((await request(`/project-resume/project-a/actions/${action.id}`, 'DELETE', { confirm: true, revision: 2 })).status).toBe(204);
    expect(store.todos()).toHaveLength(1); expect(store.todos()[0].source).toMatchObject({ linked: false });
    const purgeAction = create(); store.addProjectActionTodo(project.id, purgeAction.id, {});
    projects.remove(project.id); const deletedAt = projects.trash().items[0].deletedAt;
    const stalePurge = await request('/project-resume/trash/purge', 'POST', { ids: [project.id], confirm: true, deletedAt: { [project.id]: 'stale' } }); expect(stalePurge.status).toBe(409);
    expect(store.todos()[0].source).toMatchObject({ linked: true });
    expect((await request('/project-resume/trash/purge', 'POST', { ids: [project.id], confirm: true, deletedAt: { [project.id]: deletedAt } })).status).toBe(200);
    expect(projects.actionPurgeIds()).toContain(project.id); expect(store.todos()).toHaveLength(2);
    expect(store.todos().every(todo => todo.source?.kind === 'project_action' && todo.source.linked === false)).toBe(true);
    expect(JSON.parse(readFileSync(join(root, 'personal.json'), 'utf8')).projectActions).toEqual([]);
    expect(rpc.call.mock.calls.every((args: any[]) => ['project/list', 'thread/list', 'thread/turns/list'].includes(args[0]))).toBe(true);
    expect(github.create).not.toHaveBeenCalled(); expect(git).not.toHaveBeenCalled(); expect(readFileSync(join(workspace, 'original.txt'), 'utf8')).toBe('Preserve me'); projects.close();
  });
});
