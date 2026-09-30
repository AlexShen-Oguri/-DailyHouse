import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LearningPage, { LearningDetailPage } from './Learning';
import type { LearningPlan, LearningSummary } from './learning-model';
import type { Todo } from './api';

const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn(), data: { todos: [] as Todo[] } }));
vi.mock('./api', async () => ({ ...await vi.importActual('./api'), request: mocks.request }));
vi.mock('./Workspace', () => ({ useWorkspace: () => ({ data: mocks.data, refresh: mocks.refresh }) }));
let host: HTMLDivElement, root: Root, plan: LearningPlan;
function sample(): LearningPlan {
  const at = '2026-09-29T14:00:00Z';
  return { id: 'course-1', title: '数据结构', course: 'CS 253', goal: '掌握树结构', nextStep: '阅读第三章', nextStepId: 'step-plan', dueDate: null, status: 'active', revision: 3, createdAt: at, updatedAt: at,
    entries: [
      { id: 'start', kind: 'initial', content: '最初的目标', links: [], nextStep: '', nextStepId: 'step-start', createdAt: at, updatedAt: at },
      { id: 'progress', kind: 'progress', content: '完成基础练习', links: [{ id: 'link-a', title: '课程讲义', url: 'https://example.com/lecture' }, { id: 'link-b', title: '补充资料', url: 'https://example.com/notes' }], nextStep: '复习旋转', nextStepId: 'step-entry', createdAt: '2026-09-29T14:05:00Z', updatedAt: '2026-09-29T14:05:00Z' }
    ], removedEntries: [] };
}
function summary(): LearningSummary { const { entries, removedEntries: _removed, ...rest } = plan; return { ...rest, entryCount: entries.length, preview: entries.at(-1)!.content }; }
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); plan = sample(); mocks.data.todos = [];
  mocks.refresh.mockReset().mockResolvedValue(undefined); mocks.request.mockReset().mockImplementation(async (path: string) => path === '/learning' ? { items: [summary()] } : structuredClone(plan));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function render(path = '/learning/course-1') { await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/learning" element={<LearningPage/>}/><Route path="/learning/:id" element={<LearningDetailPage/>}/><Route path="/todos" element={<p>今日待办入口</p>}/></Routes></MemoryRouter>)); }
function button(name: string) { const found = [...host.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === name || item.textContent === name); expect(found, name).toBeTruthy(); return found!; }
async function click(name: string) { await act(async () => button(name).click()); }
async function field(name: string, value: string) { const label = [...host.querySelectorAll('label')].find(item => item.textContent?.startsWith(name)); const input = label?.querySelector('input, textarea') as HTMLInputElement | HTMLTextAreaElement; expect(input, name).toBeTruthy(); await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function submit() { await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }

describe('study plan pages', () => {
  it('shows a summary list and opens a dedicated page after creating a plan', async () => {
    await render('/learning'); expect(host.querySelector('.idea-timeline')).toBeNull(); expect(host.querySelector('.idea-list-link')?.getAttribute('href')).toBe('/learning/course-1');
    await click('新建计划'); await field('计划名称', '机器学习'); await field('学习目标', '理解回归');
    mocks.request.mockImplementation(async (path: string, method: string, body: Record<string, unknown>) => {
      if (method === 'POST') { expect(path).toBe('/learning'); plan = { ...plan, title: body.title as string, goal: body.goal as string }; }
      return structuredClone(plan);
    });
    await submit(); expect(host.querySelector('h1')?.textContent).toBe('机器学习'); expect(host.querySelector('.idea-timeline')).not.toBeNull();
    expect(host.textContent).not.toContain('AI prompting');
  });
  it('reads the timeline oldest first, supports reversing it and opens safe resource links', async () => {
    await render(); expect([...host.querySelectorAll('.idea-entry-content')].map(item => item.textContent)).toEqual(['最初的目标', '完成基础练习']);
    const link = host.querySelector<HTMLAnchorElement>('.learning-resources a')!; expect(link.target).toBe('_blank'); expect(link.rel).toBe('noopener noreferrer');
    const select = host.querySelector<HTMLSelectElement>('.idea-history-head select')!;
    await act(async () => { select.value = 'newest'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect([...host.querySelectorAll('.idea-entry-content')].map(item => item.textContent)).toEqual(['完成基础练习', '最初的目标']);
  });
  it('keeps the draft after a stale save and asks the user to review the new revision', async () => {
    await render(); await click('编辑计划'); await field('学习目标', '保留我的新草稿');
    mocks.request.mockImplementation(async (_path: string, method: string) => { if (method === 'PATCH') { plan.revision = 4; plan.goal = '另一次更新'; throw new Error('学习计划已更新'); } return structuredClone(plan); });
    await submit(); expect(host.querySelector('textarea')?.value).toBe('保留我的新草稿'); expect(button('保存计划').disabled).toBe(true);
    await click('已核对，保留草稿使用最新版本'); expect(button('保存计划').disabled).toBe(false);
    mocks.request.mockImplementation(async (_path: string, method: string, body: Record<string, unknown>) => { if (method === 'PATCH') { expect(body.revision).toBe(4); expect(body.goal).toBe('保留我的新草稿'); plan.goal = body.goal as string; plan.revision++; } return structuredClone(plan); });
    await submit(); expect(host.querySelector('form')).toBeNull(); expect(host.textContent).toContain('保留我的新草稿');
  });
  it('confirms link removal separately and saves only the remaining references', async () => {
    await render(); await click('编辑记录：完成基础练习'); await click('移除链接: 课程讲义');
    expect(host.textContent).toContain('原网页、论文与其他链接会保留'); expect(mocks.request.mock.calls.filter(call => call[1] === 'PATCH')).toHaveLength(0);
    await click('保留链接'); expect(host.querySelectorAll('.learning-link-drafts li')).toHaveLength(2);
    await click('移除链接: 课程讲义'); await click('确认移除链接');
    mocks.request.mockImplementation(async (_path: string, method: string, body: Record<string, unknown>) => { if (method === 'PATCH') { expect(body.links).toEqual([plan.entries[1].links[1]]); plan.entries[1].links = body.links as LearningPlan['entries'][0]['links']; plan.revision++; } return structuredClone(plan); });
    await submit(); expect(host.querySelectorAll('.learning-resources a')).toHaveLength(1); expect(host.querySelector('.learning-resources a')?.textContent).toContain('补充资料');
  });
  it('cancels deletion, removes an entry with confirmation and restores its original position', async () => {
    await render(); await click('删除记录：完成基础练习'); expect(host.textContent).toContain('原网页与已加入的待办会保留'); await click('保留记录');
    expect(mocks.request.mock.calls.filter(call => call[1] === 'DELETE')).toHaveLength(0);
    mocks.request.mockImplementation(async (path: string, method: string, body: Record<string, unknown>) => {
      if (method === 'DELETE') { expect(body.confirmed).toBe(true); const removed = plan.entries.pop()!; plan.removedEntries = [{ ...removed, removedAt: plan.updatedAt, expiresAt: '2026-10-29T14:00:00Z' }]; plan.revision++; }
      if (path.endsWith('/restore')) { const { removedAt: _removed, expiresAt: _expires, ...entry } = plan.removedEntries[0]; plan.entries.push(entry); plan.removedEntries = []; plan.revision++; }
      return structuredClone(plan);
    });
    await click('删除记录：完成基础练习'); await click('确认删除记录'); expect(host.querySelectorAll('.idea-timeline-entry')).toHaveLength(1);
    await click('已移除记录（1）'); await click('恢复记录：完成基础练习'); expect([...host.querySelectorAll('.idea-entry-content')].map(item => item.textContent)).toEqual(['最初的目标', '完成基础练习']);
  });
  it('adds a next step to today and links to the task without changing course completion', async () => {
    await render(); mocks.request.mockImplementation(async (path: string, _method: string, body: Record<string, unknown>) => { if (path.endsWith('/todo')) { expect(body).toMatchObject({ revision: 3, dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }); return { created: true, todoId: 'task-1' }; } return structuredClone(plan); });
    mocks.refresh.mockImplementation(async () => { mocks.data.todos = [{ id: 'task-1', title: plan.nextStep, done: true, dueDate: null, createdAt: plan.createdAt, source: { kind: 'learning', id: plan.id, stepId: plan.nextStepId, title: plan.title, url: '#/learning/course-1' } }]; });
    await act(async () => host.querySelector<HTMLButtonElement>('.learning-goal .learning-next-step button')!.click());
    expect(host.querySelector('.learning-goal .learning-next-step a')?.getAttribute('href')).toBe('/todos?task=task-1');
    expect(host.textContent).toContain('查看已完成待办'); expect(host.querySelector('.idea-status')?.textContent).toBe('进行中');
  });
  it('deletes the parent with a clear scope and opens the recoverable plans list', async () => {
    await render(); await click('删除这个计划'); expect(host.textContent).toContain('已加入的待办、灵感和原始资料不会删除');
    mocks.request.mockImplementation(async (path: string, method: string, body: Record<string, unknown>) => { if (method === 'DELETE') { expect(path).toBe('/learning/course-1'); expect(body).toEqual({ revision: 3, confirmed: true }); return {}; } return { items: [{ ...summary(), removedAt: plan.updatedAt, expiresAt: '2026-10-29T14:00:00Z' }] }; });
    await click('确认删除计划'); expect(host.querySelector('h1')?.textContent).toBe('学习计划'); expect(host.textContent).toContain('恢复并打开');
    mocks.request.mockImplementation(async (_path: string, method: string, body: Record<string, unknown>) => { if (method === 'POST') expect(body.revision).toBe(3); return structuredClone(plan); });
    await click('恢复计划：数据结构'); expect(host.querySelector('h1')?.textContent).toBe('数据结构');
  });
});
