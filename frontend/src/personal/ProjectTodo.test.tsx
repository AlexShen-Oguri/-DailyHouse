// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TodoRows } from './TodoRows';
import type { Todo, TodoSource } from './api';
const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn() }));
vi.mock('./api', async original => ({ ...(await original<typeof import('./api')>()), request: mocks.request }));
vi.mock('./Workspace', () => ({ useWorkspace: () => ({ refresh: mocks.refresh }) }));
const source: Extract<TodoSource, {kind: 'project_action'}> = { kind: 'project_action', id: 'step:one', projectId: 'project:one', title: 'Garden', url: 'codex://threads/thread-one', available: true, linked: true, acceptance: 'Pass keyboard checks', status: 'active', result: '', reason: '', revision: 3 };
const task = (fields: Partial<Todo> = {}): Todo => ({ id: 'todo:one', title: 'Build a path', done: false, createdAt: '2026-09-27T12:00:00Z', dueDate: null, source: {...source}, ...fields });
let host: HTMLDivElement; let root: Root;
const button = (name: string) => { const result = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => (node.getAttribute('aria-label') || node.textContent?.trim()) === name); if (!result) throw new Error(`Missing ${name}`); return result; };
async function mount(todo: Todo) { await act(async () => root.render(<MemoryRouter><TodoRows items={[todo]} allowDelete/></MemoryRouter>)); }
async function click(name: string) { await act(async () => button(name).click()); }
async function fill(input: HTMLInputElement | HTMLTextAreaElement, value: string) { await act(async () => { const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', {bubbles:true})); }); }
beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; mocks.request.mockReset(); mocks.refresh.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe('project-linked tasks', () => {
  it('requires a reviewed result before completion and sends the current action revision', async () => {
    await mount(task());
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/projects?project=project%3Aone&action=step%3Aone');
    expect(host.textContent).toContain('Pass keyboard checks');
    await click('完成: Build a path'); expect(mocks.request).not.toHaveBeenCalled();
    expect(button('记录结果并完成').disabled).toBe(true);
    await fill(host.querySelector('textarea')!, 'Keyboard traversal verified.'); await click('记录结果并完成');
    expect(mocks.request).toHaveBeenCalledWith('/todos/todo%3Aone', 'PATCH', {done:true,result:'Keyboard traversal verified.',actionRevision:3});
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('retains result drafts after errors and uses refreshed revision on retry', async () => {
    mocks.request.mockRejectedValueOnce(new Error('Action changed; refresh')).mockResolvedValueOnce({});
    await mount(task()); await click('完成: Build a path'); await fill(host.querySelector('textarea')!, 'Validated'); await click('记录结果并完成');
    expect(host.querySelector('textarea')!.value).toBe('Validated'); expect(host.querySelector('[role="alert"]')?.textContent).toContain('Action changed');
    await mount(task({source:{...source,revision:4}}));
    expect(host.textContent).toContain('项目行动已更新');
    await click('已核对，使用最新版本'); await click('记录结果并完成');
    expect(mocks.request).toHaveBeenLastCalledWith('/todos/todo%3Aone','PATCH',{done:true,result:'Validated',actionRevision:4});
  });
  it('cancels completion without modifying data and reopens with concurrency protection', async () => {
    await mount(task()); await click('完成: Build a path'); await click('取消'); expect(mocks.request).not.toHaveBeenCalled();
    await mount(task({done:true,source:{...source,status:'done',result:'Verified'}})); await click('恢复: Build a path');
    expect(mocks.request).toHaveBeenCalledWith('/todos/todo%3Aone','PATCH',{done:false,actionRevision:3});
  });
  it('still collects results while a project entry is hidden, but handles a deleted action as standalone', async () => {
    await mount(task({source:{...source,available:false}}));
    expect(host.querySelector('a[href^="/projects"]')).toBeNull(); expect(host.querySelector('a')?.getAttribute('href')).toBe(source.url);
    await click('完成: Build a path'); expect(host.querySelector('textarea')).not.toBeNull(); await click('取消');
    await mount(task({source:{...source,available:false,linked:false}})); await click('完成: Build a path');
    expect(mocks.request).toHaveBeenCalledWith('/todos/todo%3Aone','PATCH',{done:true});
  });
  it('edits title/date with revision and confirms task-only deletion', async () => {
    await mount(task()); await click('编辑待办：Build a path'); await fill(host.querySelector('input[name="title"]')!, 'Verify path');
    host.querySelector<HTMLInputElement>('input[name="dueDate"]')!.value='2026-10-02'; await click('保存修改');
    expect(mocks.request).toHaveBeenCalledWith('/todos/todo%3Aone','PATCH',{title:'Verify path',dueDate:'2026-10-02',actionRevision:3});
    mocks.request.mockClear(); await click('删除: Build a path'); expect(host.textContent).toContain('项目行动、验收条件和完成记录保留'); expect(mocks.request).not.toHaveBeenCalled();
    await click('确认删除待办'); expect(mocks.request).toHaveBeenCalledWith('/todos/todo%3Aone','DELETE',undefined);
  });
  it('does not silently rebase an old edit and unlocks rows when the edited task leaves a filter', async () => {
    await mount(task()); await click('编辑待办：Build a path'); await fill(host.querySelector('input[name="title"]')!, 'Draft title');
    await mount(task({source:{...source,revision:4}})); await click('保存修改');
    expect(mocks.request).toHaveBeenCalledWith('/todos/todo%3Aone','PATCH',{title:'Draft title',dueDate:null,actionRevision:3});
    await mount(task()); await click('完成: Build a path');
    await mount(task({id:'todo:other',title:'Other task',done:true}));
    expect(button('恢复: Other task').disabled).toBe(false); expect(button('编辑待办：Other task').disabled).toBe(false);
  });
});
