// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReadingPage from './Reading';
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
  const result = Array.from(host.querySelectorAll('button')).find(node => typeof name === 'string' ? node.textContent?.trim() === name : name.test(node.textContent?.trim() ?? ''));
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
async function mount() { await act(async () => { root.render(<ReadingPage/>); }); }
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
    await change(control<HTMLSelectElement>('阅读进度：Read React'), 'done');
    expect(writes()).toEqual([['/reading/book-1', 'PATCH', { status: 'done' }]]);
    expect(row('Read React')?.classList.contains('is-completing')).toBe(true);
    expect(row('Read React')?.querySelector('.reading-bookmark svg')).not.toBeNull();
    expect(row('Read React')?.querySelector('.reading-completion-label')?.textContent).toContain('已完成');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(row('Read React')).toBeUndefined();
    await change(control<HTMLSelectElement>('筛选进度'), 'done');
    expect(row('Read React')).toBeDefined();
    expect(control<HTMLSelectElement>('阅读进度：Read React').value).toBe('done');
    control<HTMLSelectElement>('阅读进度：Read React').focus();
    await change(control<HTMLSelectElement>('阅读进度：Read React'), 'unread');
    expect(document.activeElement).toBe(control<HTMLSelectElement>('筛选进度'));
    await change(control<HTMLSelectElement>('筛选进度'), 'active');
    expect(row('Read React')).toBeDefined();
    expect(control<HTMLSelectElement>('阅读进度：Read React').value).toBe('unread');
  });

  it('keeps a failed completion visible and does not celebrate before the save succeeds', async () => {
    await mount();
    let rejectSave!: (reason: Error) => void;
    mocks.request.mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }));
    await change(control<HTMLSelectElement>('阅读进度：Read React'), 'done');
    expect(row('Read React')?.classList.contains('is-completing')).toBe(false);
    await act(async () => { rejectSave(new Error('Could not save progress')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(row('Read React')).toBeDefined();
    expect(control<HTMLSelectElement>('阅读进度：Read React').value).toBe('unread');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not save progress');
  });

  it('finishes promptly when reduced motion is requested', async () => {
    reducedMotion = true;
    await mount();
    await change(control<HTMLSelectElement>('阅读进度：Read React'), 'done');
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(row('Read React')).toBeUndefined();
    expect(shelf.items.find(entry => entry.id === 'book-1')?.status).toBe('done');
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
    await change(control<HTMLSelectElement>('筛选类型'), 'video');
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
    await change(control<HTMLSelectElement>('筛选类型'), 'video');
    expect(host.querySelectorAll('.reading-row')).toHaveLength(1);
    await click(button('全部移除'));
    expect(writes()).toEqual([]);
    await click(button('确认移除'));
    expect(writes()).toEqual([['/reading/remove', 'POST', { ids: ['book-1', 'video-1', 'report-1', 'done-1'] }]]);
    expect(shelf.items).toEqual([]);
    expect(host.querySelectorAll('.reading-row')).toHaveLength(0);
    expect(document.activeElement).toBe(control<HTMLSelectElement>('筛选进度'));
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
