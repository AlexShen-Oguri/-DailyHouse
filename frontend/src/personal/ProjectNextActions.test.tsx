// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectNextActions from './ProjectNextActions';
import type { ProjectNextAction } from './project-actions-model';
const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn(), todos: [] }));
vi.mock('./api', async original => ({ ...(await original<typeof import('./api')>()), request: mocks.request }));
vi.mock('./Workspace', () => ({ useWorkspace: () => ({ data: { todos: mocks.todos }, refresh: mocks.refresh }) }));
const path = '/project-resume/project%3Aone/actions';
const thread = { id: 'thread:one', title: 'Bouquet game design', url: 'codex://threads/thread-one', latest: { request: 'Build the flower picker with preview' } };
const fixture = (extra: Partial<ProjectNextAction> = {}): ProjectNextAction => ({ id: 'action:one', projectId: 'project:one', projectTitle: 'Bouquet game', title: 'Build flower picker', acceptance: 'Pick three flowers and see a preview', thread, status: 'active', reason: '', result: '', dueDate: null, createdAt: '2026-09-27T12:00:00Z', updatedAt: '2026-09-27T12:00:00Z', revision: 1, completions: [], ...extra });
let host: HTMLDivElement; let root: Root; let items: ProjectNextAction[];
const click = async (node: HTMLElement) => { await act(async () => { node.click(); }); };
function button(text: string) { const node = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text); if (!node) throw new Error(`Missing button ${text}`); return node; }
function field(name: string, value: string) { const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`); if (!element) throw new Error(`Missing field ${name}`); element.value = value; }
async function mount(targetAction?: string) { await act(async () => { root.render(<MemoryRouter><ProjectNextActions projectId="project:one" projectTitle="Bouquet game" threads={[thread]} targetAction={targetAction}/></MemoryRouter>); }); }
beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); items = []; mocks.request.mockReset(); mocks.refresh.mockReset(); mocks.request.mockImplementation(async (_url: string, method = 'GET') => method === 'GET' ? { items: [...items] } : {}); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('project next actions', () => {
  it('requires an explicit title and acceptance, reviews conversation context and saves native date values', async () => {
    await mount(); await click(button('安排下一步')); expect((host.querySelector('[name="title"]') as HTMLInputElement).value).toBe('');
    await click(button('填入标题，再由我修改')); expect((host.querySelector('[name="title"]') as HTMLInputElement).value).toBe(thread.latest.request);
    field('title', 'Build flower picker'); field('acceptance', 'Pick three flowers and see a preview'); field('dueDate', '2026-10-01');
    mocks.request.mockImplementation(async (_url: string, method = 'GET', body?: Record<string, unknown>) => { if (method === 'POST') items = [fixture({ dueDate: body!.dueDate as string })]; return method === 'GET' ? { items: [...items] } : items[0]; });
    await click(button('保存下一步')); expect(mocks.request).toHaveBeenCalledWith(path, 'POST', expect.objectContaining({ requestId: expect.any(String), title: 'Build flower picker', acceptance: 'Pick three flowers and see a preview', threadId: 'thread:one', dueDate: '2026-10-01' })); expect(host.textContent).toContain('2026-10-01'); expect(host.querySelector('a[href="codex://threads/thread-one"]')).not.toBeNull(); expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('retains creation drafts and the same idempotency key after a failed save', async () => {
    await mount(); await click(button('安排下一步')); field('title', 'Build flower picker'); field('acceptance', 'Three flowers selectable'); mocks.request.mockRejectedValueOnce(new Error('Temporarily unavailable'));
    await click(button('保存下一步')); expect(host.textContent).toContain('Temporarily unavailable'); expect((host.querySelector('[name="title"]') as HTMLInputElement).value).toBe('Build flower picker');
    const first = mocks.request.mock.calls.find(([, method]) => method === 'POST')![2]; await click(button('保存下一步')); const calls = mocks.request.mock.calls.filter(([, method]) => method === 'POST'); expect(calls).toHaveLength(2); expect(calls[1][2].requestId).toBe(first.requestId);
  });
  it('adds one linked task, re-reads its ID and routes directly to it', async () => {
    items = [fixture()]; await mount(); mocks.request.mockImplementation(async (_url: string, method = 'GET') => { if (method === 'POST') items = [fixture({ todoId: 'todo:one', revision: 2 })]; return method === 'GET' ? { items: [...items] } : { todoId: 'todo:one', created: true }; });
    await click(button('加入待办')); expect(mocks.request).toHaveBeenCalledWith(`${path}/action%3Aone/todo`, 'POST', {}); expect(host.querySelector('a[href="/todos?task=todo%3Aone"]')).not.toBeNull(); expect([...host.querySelectorAll('button')].some(node => node.textContent === '加入待办')).toBe(false); expect(host.textContent).toContain('完成状态将与行动同步');
  });
  it('records completion result, keeps it in history, and reopens with the current revision', async () => {
    items = [fixture()]; await mount(); mocks.request.mockImplementation(async (_url: string, method = 'GET', body?: Partial<ProjectNextAction>) => { if (method === 'PATCH') items = [fixture({ ...items[0], ...body, revision: items[0].revision + 1, completions: [{ id: 'completion:one', result: 'Preview works with three flowers', completedAt: '2026-09-27T13:00:00Z' }] })]; return method === 'GET' ? { items: [...items] } : items[0]; });
    await click(button('完成并记结果')); field('result', 'Preview works with three flowers'); await click(button('保存结果并完成')); expect(mocks.request).toHaveBeenCalledWith(`${path}/action%3Aone`, 'PATCH', { revision: 1, status: 'done', result: 'Preview works with three flowers' });
    expect(document.activeElement).toBe(host.querySelector('.project-next-actions > header h3'));
    await click(button('已完成的行动 · 1+')); expect(host.textContent).toContain('Preview works with three flowers'); await click(button('重新打开')); expect(mocks.request).toHaveBeenCalledWith(`${path}/action%3Aone`, 'PATCH', { revision: 2, status: 'active' }); expect(host.textContent).toContain('完成记录 · 1');
  });
  it('records block reasons and safely preserves a conflicting edit for review', async () => {
    items = [fixture()]; await mount(); await click(button('遇到阻碍')); field('reason', 'Need the interaction design'); await click(button('保存行动')); expect(mocks.request).toHaveBeenCalledWith(`${path}/action%3Aone`, 'PATCH', { revision: 1, status: 'blocked', reason: 'Need the interaction design' });
    await click(button('编辑行动')); field('title', 'My revised action'); mocks.request.mockRejectedValueOnce(new Error('Action changed. Reload and review.')); await click(button('保存行动')); expect(host.textContent).toContain('Reload and review'); expect((host.querySelector('[name="title"]') as HTMLInputElement).value).toBe('My revised action');
    items = [fixture({ revision: 2, title: 'Updated elsewhere', acceptance: 'Latest criteria' })]; await click(button('重新读取行动')); expect(button('保存行动').disabled).toBe(true); expect(host.textContent).toContain('Latest criteria'); expect((host.querySelector('[name="title"]') as HTMLInputElement).value).toBe('My revised action'); await click(button('已核对最新记录，保留输入继续')); await click(button('保存行动')); expect(mocks.request).toHaveBeenCalledWith(`${path}/action%3Aone`, 'PATCH', { revision: 2, title: 'My revised action', acceptance: 'Pick three flowers and see a preview', dueDate: null });
  });
  it('only deletes after explicit confirmation and never calls task, Codex or repository deletion', async () => {
    items = [fixture({ todoId: 'todo:one' })]; await mount(); await click(button('删除行动')); expect(mocks.request.mock.calls.filter(([, method]) => method === 'DELETE')).toHaveLength(0); expect(host.textContent).toContain('已有待办保留为独立记录'); await click(button('取消')); expect(host.textContent).toContain('Build flower picker');
    await click(button('删除行动')); mocks.request.mockImplementation(async (_url: string, method = 'GET') => { if (method === 'DELETE') items = []; return method === 'GET' ? { items: [...items] } : undefined; }); await click(button('确认删除行动')); expect(mocks.request).toHaveBeenCalledWith(`${path}/action%3Aone`, 'DELETE', { confirm: true, revision: 1 }); expect(host.textContent).not.toContain('Build flower picker'); expect(mocks.request.mock.calls.every(([url]) => url.startsWith(path))).toBe(true);
    expect(document.activeElement).toBe(host.querySelector('.project-next-actions > header h3'));
  });
  it('opens completed history and focuses a direct linked action', async () => {
    items = [fixture({ status: 'done', result: 'Delivered', completedAt: '2026-09-27T13:00:00Z', completions: [{ id: 'completion:one', result: 'Delivered', completedAt: '2026-09-27T13:00:00Z' }] })]; await mount('action:one'); expect(host.querySelector('.is-linked-target')).not.toBeNull(); expect(document.activeElement).toBe(host.querySelector('.is-linked-target')); expect(host.textContent).toContain('Delivered');
  });
  it('reports missing targets without inventing an action', async () => { await mount('removed:action'); expect(host.textContent).toContain('这条行动已删除或暂不可用'); expect(host.querySelectorAll('.project-action-row')).toHaveLength(0); });
  it('confirms deletion of one completion result while leaving the action completed and task linked', async () => {
    items = [fixture({ status: 'done', result: 'Delivered', todoId: 'todo:one', completions: [{ id: 'completion:one', result: 'Delivered', completedAt: '2026-09-27T13:00:00Z' }] })]; await mount('action:one'); await click(button('删除这次结果')); expect(host.textContent).toContain('行动的完成状态、其他完成记录、已有待办'); expect(mocks.request.mock.calls.filter(([, method]) => method === 'DELETE')).toHaveLength(0); await click(button('取消')); expect(host.textContent).toContain('Delivered');
    await click(button('删除这次结果')); mocks.request.mockImplementation(async (_url: string, method = 'GET') => { if (method === 'DELETE') items = [{ ...items[0], revision: 2, result: '', completions: [] }]; return method === 'GET' ? { items: [...items] } : items[0]; }); await click(button('确认删除这次结果')); expect(mocks.request).toHaveBeenCalledWith(`${path}/action%3Aone/completions/completion%3Aone`, 'DELETE', { revision: 1, confirm: true }); expect(host.textContent).toContain('完成结果已删除'); expect(host.textContent).toContain('已完成的行动 · 1'); expect(host.querySelector('a[href="/todos?task=todo%3Aone"]')).not.toBeNull();
  });
});
