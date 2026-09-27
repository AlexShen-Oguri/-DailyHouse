// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReadingTodoAction from './ReadingTodoAction';
import { TodoRows } from './shared';
import type { Todo } from './api';
import type { ReadingItem } from './reading-model';
const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn(), todos: [] as Todo[] }));
vi.mock('./api', async original => ({ ...(await original<typeof import('./api')>()), request: mocks.request }));
vi.mock('./Workspace', () => ({ useWorkspace: () => ({ data: { todos: mocks.todos }, refresh: mocks.refresh }) }));
const item: ReadingItem = { id: 'book:one', title: 'A useful tutorial', type: 'tutorial', url: 'https://example.com/lesson', notes: '', status: 'reading', addedAt: '2026-09-27T12:00:00Z', updatedAt: '2026-09-27T12:00:00Z', origin: 'manual' };
const task = (): Todo => ({ id: 'todo:one', title: item.title, done: false, createdAt: '2026-09-27T12:00:00Z', dueDate: null, source: { kind: 'reading', id: item.id, title: item.title, type: item.type, url: item.url, available: true } });
let host: HTMLDivElement; let root: Root;
async function mount(element: React.ReactNode) { await act(async () => { root.render(<MemoryRouter>{element}</MemoryRouter>); }); }
async function click(node: HTMLElement) { await act(async () => { node.click(); }); }
function button(text: string) { const target = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => (node.getAttribute('aria-label') || node.textContent?.trim()) === text); if (!target) throw new Error(`Missing ${text}`); return target; }
async function fill(input: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); mocks.request.mockReset(); mocks.refresh.mockReset(); mocks.todos = []; });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe('shelf tasks', () => {
  it('adds once and exposes the returned source-linked task without completing the material', async () => {
    mocks.request.mockResolvedValue({ todo: task(), todoId: 'todo:one', created: true }); await mount(<ReadingTodoAction item={item}/>); await click(button('加入待办：A useful tutorial'));
    expect(mocks.request).toHaveBeenCalledWith('/reading/book%3Aone/todo', 'POST'); expect(mocks.request).toHaveBeenCalledTimes(1); expect(host.querySelector('a')?.getAttribute('href')).toBe('/todos?task=todo%3Aone'); expect(item.status).toBe('reading'); expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('links to the completed task instead of making a duplicate and permits re-add after deletion', async () => {
    mocks.todos = [{ ...task(), done: true }]; await mount(<ReadingTodoAction item={item}/>); expect(host.textContent).toContain('待办已完成'); expect(mocks.request).not.toHaveBeenCalled();
    mocks.todos = []; await mount(<ReadingTodoAction item={item}/>); expect(button('加入待办：A useful tutorial').disabled).toBe(false);
  });
  it('keeps an explicit retry available after a failed add', async () => {
    mocks.request.mockRejectedValueOnce(new Error('Save failed')).mockResolvedValueOnce({ todo: task(), created: true }); await mount(<ReadingTodoAction item={item}/>); await click(button('加入待办：A useful tutorial')); expect(host.querySelector('[role="alert"]')?.textContent).toBe('Save failed'); await click(button('加入待办：A useful tutorial')); expect(host.textContent).toContain('已加入待办');
  });
});
describe('task source and lifecycle', () => {
  it('keeps unavailable source evidence and original URL, confirms only the todo deletion', async () => {
    const todo = task(); todo.source!.available = false; await mount(<TodoRows items={[todo]} allowDelete/>);
    expect(host.textContent).toContain('书架来源已移除或暂不可用'); expect(host.querySelector('a')?.href).toBe(item.url); expect(host.querySelector('a[href*="/reading?"]')).toBeNull();
    await click(button('删除: A useful tutorial')); expect(mocks.request).not.toHaveBeenCalled(); expect(host.textContent).toContain('书架内容、阅读状态和原始文件保留'); await click(button('确认删除待办')); expect(mocks.request).toHaveBeenCalledWith('/todos/todo%3Aone', 'DELETE', undefined);
  });
  it('completes only the task while linking back to the precise shelf item', async () => {
    await mount(<TodoRows items={[task()]} allowDelete/>); expect(host.querySelector('a')?.getAttribute('href')).toBe('/reading?item=book%3Aone'); await click(button('完成: A useful tutorial')); expect(mocks.request).toHaveBeenCalledWith('/todos/todo%3Aone', 'PATCH', { done: true }); expect(mocks.request.mock.calls.some(([path]) => path.startsWith('/reading/'))).toBe(false);
  });
  it('cancels editing and then saves title/date without rewriting the source or completed state', async () => {
    const todo = { ...task(), done: true }; await mount(<TodoRows items={[todo]} allowDelete/>); await click(button('编辑待办：A useful tutorial')); await fill(host.querySelector('input')!, 'Watch lesson one'); await click(button('取消编辑')); expect(mocks.request).not.toHaveBeenCalled(); expect(host.textContent).toContain(item.title);
    await click(button('编辑待办：A useful tutorial')); await fill(host.querySelector('input')!, 'Watch lesson one'); host.querySelector<HTMLInputElement>('input[type="date"]')!.value = '2026-10-01'; await click(button('保存修改')); expect(mocks.request).toHaveBeenCalledWith('/todos/todo%3Aone', 'PATCH', { title: 'Watch lesson one', dueDate: '2026-10-01' }); expect(todo.done).toBe(true); expect(todo.source!.title).toBe(item.title);
  });
});
