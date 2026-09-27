// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReadingPage from './Reading';
import { MemoryRouter } from 'react-router-dom';
import type { ReadingItem, ReadingState } from './reading-model';

const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn() }));
vi.mock('./api', async importOriginal => ({ ...(await importOriginal<typeof import('./api')>()), request: mocks.request }));
vi.mock('./Workspace', () => ({ useWorkspace: () => ({ data: { settings: { readingTechPath: '', readingAestheticPath: '', animationEnabled: true } }, refresh: mocks.refresh }) }));

const item = (id: string, title: string, overrides: Partial<ReadingItem> = {}): ReadingItem => ({
  id, title, type: 'book', url: '', notes: '', status: 'unread', origin: 'manual',
  addedAt: '2026-09-26T10:00:00Z', updatedAt: '2026-09-26T10:00:00Z', ...overrides,
});
let shelf: ReadingState;
let host: HTMLDivElement;
let root: Root;
let writeFailure = '';
let reducedMotion = false;

function button(name: string | RegExp) {
  const result = Array.from(host.querySelectorAll('button')).find(node => typeof name === 'string' ? (node.getAttribute('aria-label') || node.textContent?.trim()) === name : name.test(node.textContent?.trim() ?? ''));
  if (!result) throw new Error(`Button not found: ${String(name)}`);
  return result;
}
function control<T extends HTMLInputElement | HTMLSelectElement>(name: string): T {
  const result = Array.from(host.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')).find(node => {
    if (node.getAttribute('aria-label') === name) return true;
    const label = node.closest('label');
    return label?.querySelector('.pw-sr-only')?.textContent === name || label?.textContent?.trim() === name;
  });
  if (!result) throw new Error(`Control not found: ${name}`);
  return result as T;
}
function row(title: string) {
  return Array.from(host.querySelectorAll<HTMLLIElement>('li[data-reading-id]')).find(node => node.querySelector('h3')?.textContent === title);
}
async function click(element: HTMLElement) { await act(async () => { element.click(); }); }
async function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLInputElement ? 'input' : 'change', { bubbles: true }));
  });
}
async function mount() { await act(async () => { root.render(<MemoryRouter><ReadingPage/></MemoryRouter>); }); }
const writes = () => mocks.request.mock.calls.filter(([, method]) => method && method !== 'GET');

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  writeFailure = ''; reducedMotion = false;
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reducedMotion, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  shelf = { scannedAt: '2026-09-26T10:00:00Z', sources: [], items: [
    item('book-1', 'Read React'),
    item('video-1', 'Learn TypeScript', { type: 'video', status: 'reading', url: 'https://example.com/tutorial' }),
    item('report-1', 'Daily technology report', { type: 'article', origin: 'report', reportSource: 'tech', reportDate: '2026-09-26', pdfUrl: '/fixture.pdf' }),
    item('done-1', 'Finished project', { type: 'github', status: 'done' }),
  ] };
  mocks.request.mockReset(); mocks.refresh.mockReset();
  mocks.request.mockImplementation(async (path: string, method = 'GET', body?: { status?: ReadingItem['status']; ids?: string[] }) => {
    if (method === 'GET' && path === '/reading') return structuredClone(shelf);
    if (method === 'GET' && path === '/reading/collection') return { bridge: { connected: true }, run: null, history: [] };
    if (writeFailure) throw new Error(writeFailure);
    if (method === 'PATCH' && path.startsWith('/reading/')) {
      const current = shelf.items.find(entry => entry.id === decodeURIComponent(path.slice('/reading/'.length)))!;
      Object.assign(current, body);
      return { ...current };
    }
    if (method === 'POST' && path === '/reading/remove') {
      const ids = body?.ids ?? [];
      shelf.items = shelf.items.filter(entry => !ids.includes(entry.id));
      return { removedIds: ids };
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('reading shelf completion', () => {
  it('shows a completion animation after saving, then archives the item and permits reopening it', async () => {
    await mount();
    expect(control<HTMLSelectElement>('筛选进度').value).toBe('active');
    expect(row('Finished project')).toBeUndefined();
    const complete = button('已完成：Read React'); complete.focus();
    await click(complete);
    expect(writes()).toEqual([['/reading/book-1', 'PATCH', { status: 'done' }]]);
    expect(row('Read React')?.classList.contains('is-completing')).toBe(true);
    expect(row('Read React')?.querySelector('.reading-bookmark svg')).not.toBeNull();
    expect(row('Read React')?.querySelector('.reading-completion-label')?.textContent).toContain('已完成');
    expect(complete.disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(row('Read React')).toBeUndefined();
    expect(document.activeElement).toBe(button('未完成'));
    await click(button('已完成'));
    expect(row('Read React')).toBeDefined();
    expect(control<HTMLSelectElement>('阅读进度：Read React').value).toBe('done');
    const restart = button('重新开始：Read React'); restart.focus();
    await click(restart);
    expect(document.activeElement).toBe(button('已完成'));
    await click(button('未完成'));
    expect(row('Read React')).toBeDefined();
    expect(control<HTMLSelectElement>('阅读进度：Read React').value).toBe('unread');
    expect(button('已完成：Read React').disabled).toBe(false);
  });

  it('keeps a failed completion visible and does not celebrate before the save succeeds', async () => {
    await mount();
    let rejectSave!: (reason: Error) => void;
    mocks.request.mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }));
    await click(button('已完成：Read React'));
    expect(row('Read React')?.classList.contains('is-completing')).toBe(false);
    expect(button('已完成：Read React').disabled).toBe(true);
    await act(async () => { rejectSave(new Error('Could not save progress')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(row('Read React')).toBeDefined();
    expect(control<HTMLSelectElement>('阅读进度：Read React').value).toBe('unread');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not save progress');
    expect(button('已完成：Read React').disabled).toBe(false);
  });

  it('finishes promptly when reduced motion is requested', async () => {
    reducedMotion = true;
    await mount();
    await click(button('已完成：Read React'));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(row('Read React')).toBeUndefined();
    expect(shelf.items.find(entry => entry.id === 'book-1')?.status).toBe('done');
  });

  it('offers a distinct completion action for every material type and formal report', async () => {
    shelf.items.push(item('course-1', 'Course', { type: 'course' }), item('tutorial-1', 'Tutorial', { type: 'tutorial' }), item('article-1', 'Article', { type: 'article' }), item('github-1', 'Repository', { type: 'github' }));
    await mount();
    for (const entry of shelf.items.filter(entry => entry.status !== 'done')) {
      const complete = button('已完成：' + entry.title);
      expect(complete.textContent).toBe('已完成');
      expect(complete.closest('.reading-item-links')).toBeNull();
      expect(complete.closest('[data-reading-id]')?.getAttribute('data-reading-id')).toBe(entry.id);
    }
    await click(button('已完成：Daily technology report'));
    expect(writes()).toEqual([['/reading/report-1', 'PATCH', { status: 'done' }]]);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(row('Daily technology report')).toBeUndefined();
    await click(button('已完成'));
    expect(row('Daily technology report')?.querySelector('a')?.getAttribute('href')).toBe('/fixture.pdf');
    expect(button('重新开始：Daily technology report')).toBeDefined();
  });
});

describe('compact shelf navigation and categories', () => {
  it('separates report sources from articles, and groups courses with tutorials', async () => {
    shelf.items.push(item('tutorial-1', 'CSS animation', { type: 'tutorial', category: 'design' }), item('course-1', 'Physics course', { type: 'course', category: 'science' }), item('article-1', 'A design essay', { type: 'article', category: 'design' }), item('report-2', 'Daily art report', { type: 'article', origin: 'report', reportSource: 'aesthetic' }));
    await mount();
    expect(host.querySelector('.reading-letters')).toBeNull();
    expect(host.querySelectorAll('.reading-type-shortcuts button')).toHaveLength(8);
    await click(button('科技早报'));
    expect(row('Daily technology report')).toBeDefined();
    expect(row('Daily art report')).toBeUndefined();
    await click(button('文章'));
    expect(row('A design essay')).toBeDefined();
    expect(row('Daily technology report')).toBeUndefined();
    await click(button('课程 / 教程'));
    expect(row('CSS animation')).toBeDefined(); expect(row('Physics course')).toBeDefined();
    await change(control<HTMLSelectElement>('筛选分类'), 'design');
    expect(row('CSS animation')).toBeDefined(); expect(row('Physics course')).toBeUndefined();
  });

  it('saves a corrected category without changing the material type', async () => {
    shelf.items = [item('video-1', 'A visual lesson', { type: 'video', category: 'other' })];
    await mount(); await click(button('编辑'));
    const categorySelect = Array.from(host.querySelectorAll('select')).find(node => node.closest('label')?.textContent?.startsWith('内容分类'))!;
    await change(categorySelect, 'design');
    await act(async () => { host.querySelector('.reading-editor form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(writes()[0]).toEqual(['/reading/video-1', 'PATCH', expect.objectContaining({ type: 'video', category: 'design' })]);
    expect(row('A visual lesson')?.querySelector('.reading-category')?.textContent).toBe('设计');
  });
});

describe('reading shelf bulk removal', () => {
  it('confirms the selected snapshot and cancels without writing', async () => {
    await mount();
    await click(button('批量移除'));
    await click(control<HTMLInputElement>('选择：Read React'));
    await click(control<HTMLInputElement>('选择：Daily technology report'));
    const selectedRemovalButton = button(/移除所选.*2/);
    selectedRemovalButton.focus();
    await click(selectedRemovalButton);
    expect(writes()).toEqual([]);
    await click(button('取消'));
    expect(document.activeElement).toBe(selectedRemovalButton);
    expect(writes()).toEqual([]);
    expect(control<HTMLInputElement>('选择：Read React').checked).toBe(true);
    await click(button(/移除所选.*2/));
    await click(button('确认移除'));
    expect(writes()).toEqual([['/reading/remove', 'POST', { ids: ['book-1', 'report-1'] }]]);
    expect(row('Read React')).toBeUndefined();
    expect(row('Daily technology report')).toBeUndefined();
    expect(row('Learn TypeScript')).toBeDefined();
    expect(document.activeElement).toBe(button('结束多选'));
  });

  it('selects only displayed rows and clears stale selections when filters change', async () => {
    await mount();
    await click(button('批量移除'));
    await click(control<HTMLInputElement>('全选当前列表'));
    expect(Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).filter(node => node.checked)).toHaveLength(4);
    await click(button('视频'));
    expect(control<HTMLInputElement>('选择：Learn TypeScript').checked).toBe(false);
    await click(control<HTMLInputElement>('全选当前列表'));
    expect(control<HTMLInputElement>('选择：Learn TypeScript').checked).toBe(true);
    await change(control<HTMLInputElement>('搜索书架'), 'TypeScript');
    expect(control<HTMLInputElement>('选择：Learn TypeScript').checked).toBe(false);
    await click(control<HTMLInputElement>('选择：Learn TypeScript'));
    await change(control<HTMLSelectElement>('筛选进度'), 'reading');
    expect(control<HTMLInputElement>('选择：Learn TypeScript').checked).toBe(false);
    expect(writes()).toEqual([]);
  });

  it('removes all shelf items, including reports and completed items hidden by a filter', async () => {
    await mount();
    await click(button('视频'));
    expect(host.querySelectorAll('.reading-row')).toHaveLength(1);
    await click(button('全部移除'));
    expect(writes()).toEqual([]);
    await click(button('确认移除'));
    expect(writes()).toEqual([['/reading/remove', 'POST', { ids: ['book-1', 'video-1', 'report-1', 'done-1'] }]]);
    expect(shelf.items).toEqual([]);
    expect(host.querySelectorAll('.reading-row')).toHaveLength(0);
    expect(document.activeElement).toBe(button('未完成'));
  });

  it('retains selected items after a removal error so the user can retry', async () => {
    await mount();
    await click(button('批量移除'));
    await click(control<HTMLInputElement>('选择：Read React'));
    await click(button(/移除所选.*1/));
    writeFailure = 'Could not remove items';
    await click(button('确认移除'));
    expect(row('Read React')).toBeDefined();
    expect(control<HTMLInputElement>('选择：Read React').checked).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not remove items');
    writeFailure = '';
    await click(button('确认移除'));
    expect(row('Read React')).toBeUndefined();
  });
});

describe('reading shelf cover response races', () => {
  async function startCoverRequest() {
    let notifyVisible!: IntersectionObserverCallback;
    vi.stubGlobal('IntersectionObserver', class {
      disconnect = vi.fn(); observe = vi.fn();
      constructor(callback: IntersectionObserverCallback) { notifyVisible = callback; }
    });
    const original = item('video-1', 'Learn TypeScript', { type: 'video', url: 'https://www.bilibili.com/video/BV1a6Yx62EH4/' });
    shelf.items = [original];
    await mount();
    let resolveCover!: (value: ReadingItem) => void;
    const defaultRequest = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((path, method, body) => path === '/reading/video-1/cover'
      ? new Promise(resolve => { resolveCover = resolve; }) : defaultRequest(path, method, body));
    await act(async () => { notifyVisible([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); });
    expect(mocks.request).toHaveBeenCalledWith('/reading/video-1/cover', 'POST', {});
    return () => resolveCover({ ...original, coverUrl: 'https://i0.hdslb.com/bfs/archive/cover.jpg', coverCheckedAt: '2026-09-26T12:00:00Z', status: 'unread' });
  }

  it('merges only cover metadata when the response arrives after a newer completion', async () => {
    const finishCover = await startCoverRequest();
    await change(control<HTMLSelectElement>('阅读进度：Learn TypeScript'), 'done');
    await act(async () => { finishCover(); });
    expect(control<HTMLSelectElement>('阅读进度：Learn TypeScript').value).toBe('done');
    expect(row('Learn TypeScript')?.querySelector('img')?.getAttribute('src')).toContain('cover.jpg');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(row('Learn TypeScript')).toBeUndefined();
    await click(button('已完成'));
    expect(control<HTMLSelectElement>('阅读进度：Learn TypeScript').value).toBe('done');
    expect(row('Learn TypeScript')?.querySelector('img')).not.toBeNull();
  });

  it('does not restore an item removed while its cover request was pending', async () => {
    const finishCover = await startCoverRequest();
    await click(button('移出')); await click(button('确认移除'));
    expect(row('Learn TypeScript')).toBeUndefined();
    await act(async () => { finishCover(); });
    expect(row('Learn TypeScript')).toBeUndefined();
    expect(shelf.items).toEqual([]);
    expect(host.querySelectorAll('li[data-reading-id]')).toHaveLength(0);
  });
});

describe('automatic report refresh', () => {
  it('discovers new reports after a minute and when the page becomes visible', async () => {
    await mount(); shelf.items.push(item('new-report', 'A fresh technology digest', { origin: 'report', reportSource: 'tech', type: 'article' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); }); expect(row('A fresh technology digest')).toBeDefined();
    shelf.items.push(item('design-report', 'A fresh design digest', { origin: 'report', reportSource: 'aesthetic', type: 'article' }));
    await act(async () => document.dispatchEvent(new Event('visibilitychange'))); expect(row('A fresh design digest')).toBeDefined();
  });
  it('pauses background refresh while the user is editing and resumes after closing', async () => {
    await mount(); await click(button('编辑'));
    const title = control<HTMLInputElement>('标题'); await change(title, 'My unsaved title');
    const before = mocks.request.mock.calls.filter(([path]) => path === '/reading').length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    expect(mocks.request.mock.calls.filter(([path]) => path === '/reading')).toHaveLength(before); expect(title.value).toBe('My unsaved title');
    await click(button('关闭添加表单')); await act(async () => window.dispatchEvent(new Event('focus')));
    expect(mocks.request.mock.calls.filter(([path]) => path === '/reading')).toHaveLength(before + 1);
  });
});
