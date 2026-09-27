// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReadingTrash, { type TrashEntry } from './ReadingTrash';
import ReadingImports from './ReadingImports';
import type { CollectionRun } from './ReadingCollection';
import type { ReadingItem } from './reading-model';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./api', async original => ({ ...(await original<typeof import('./api')>()), request: mocks.request }));
const onChanged = vi.fn(async () => {}); const onBusy = vi.fn();
let host: HTMLDivElement; let root: Root;
const material = (id: string): ReadingItem => ({ id, title: `Material ${id}`, url: `https://example.com/${id}`, notes: 'Keep my notes', type: 'video', category: 'design', status: 'done', addedAt: '2026-09-20T10:00:00Z', updatedAt: '2026-09-20T10:00:00Z', origin: 'manual', finishedAt: '2026-09-23T10:00:00Z' });
function button(name: string | RegExp) {
  const target = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(node => typeof name === 'string' ? node.textContent?.trim() === name : name.test(node.textContent ?? ''));
  if (!target) throw new Error(`Button not found: ${String(name)}`);
  return target;
}
function input(label: string) {
  const target = Array.from(host.querySelectorAll<HTMLInputElement>('input')).find(node => node.getAttribute('aria-label') === label || node.closest('label')?.textContent?.trim() === label);
  if (!target) throw new Error(`Input not found: ${label}`);
  return target;
}
const click = async (node: HTMLElement) => { await act(async () => { node.click(); }); };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mocks.request.mockReset(); onChanged.mockClear(); onBusy.mockClear();
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); vi.useRealTimers(); });

describe('reading recycle bin', () => {
  let entries: TrashEntry[];
  beforeEach(() => {
    entries = ['one', 'two'].map(id => ({ item: material(id), deletedAt: '2026-09-26T12:00:00Z', expiresAt: '2026-10-26T12:00:00Z' }));
    mocks.request.mockImplementation(async (path: string, method = 'GET', body?: { ids: string[] }) => {
      if (path === '/reading/trash' && method === 'GET') return { items: structuredClone(entries) };
      if (path === '/reading/restore' && method === 'POST') { entries = entries.filter(entry => !body!.ids.includes(entry.item.id)); return { restoredIds: body!.ids }; }
      throw new Error(`Unexpected request ${method} ${path}`);
    });
  });
  const mount = async () => { await act(async () => { root.render(<ReadingTrash onChanged={onChanged} onBusy={onBusy}/>); }); };

  it('restores a reviewed selection and leaves other records intact', async () => {
    await mount();
    await click(input('恢复选择：Material one')); await click(button('恢复所选'));
    expect(mocks.request).toHaveBeenCalledWith('/reading/restore', 'POST', { ids: ['one'] });
    expect(host.textContent).not.toContain('Material one'); expect(host.textContent).toContain('Material two');
    expect(host.textContent).toContain('保留原来的阅读状态'); expect(onChanged).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(button('刷新'));
  });

  it('selects only recoverable items and gives expired entries no restore action', async () => {
    entries.push({ item: material('expired'), deletedAt: '2026-08-01T12:00:00Z', expiresAt: '2026-08-31T12:00:00Z' });
    await mount();
    expect(input('恢复选择：Material expired').disabled).toBe(true);
    await click(input('全选可恢复项')); await click(button('恢复所选'));
    expect(mocks.request).toHaveBeenCalledWith('/reading/restore', 'POST', { ids: ['one', 'two'] });
    expect(host.textContent).toContain('已过恢复期限');
  });

  it('keeps the selection after restore fails so the same item can be retried', async () => {
    await mount(); await click(input('恢复选择：Material one'));
    mocks.request.mockRejectedValueOnce(new Error('Restore unavailable'));
    await click(button('恢复所选'));
    expect(input('恢复选择：Material one').checked).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Restore unavailable');
    await click(button('恢复所选'));
    expect(host.textContent).not.toContain('Material one');
  });
});

describe('recent readings', () => {
  const run = (id: string, overrides: Partial<CollectionRun> = {}): CollectionRun => ({ id, status: 'completed', createdAt: '2026-09-27T12:00:00Z', updatedAt: '2026-09-27T12:00:00Z', scanned: 125, result: { added: 3, skipped: 122, itemIds: ['one'] }, conversationUrl: 'codex://threads/' + id, ...overrides });
  const retry = vi.fn();
  const mount = async () => { await act(async () => root.render(<ReadingImports onBusy={onBusy} onRetry={retry}/>)); };
  it('shows only five plain summaries and no review or file workflow', async () => {
    mocks.request.mockResolvedValue({ items: Array.from({ length: 7 }, (_, i) => run(String(i))) }); await mount();
    expect(mocks.request).toHaveBeenCalledWith('/reading/reads'); expect(host.querySelectorAll('.reading-recent-list > li')).toHaveLength(5);
    expect(host.textContent).toContain('新增 3 项，已放入书架'); expect(host.textContent).not.toMatch(/待确认|审阅|排除|批次/); expect(host.querySelector('input')).toBeNull();
    expect(host.querySelector('a')?.href).toBe('codex://threads/0');
  });
  it('confirms summary-only deletion and leaves other readings intact', async () => {
    mocks.request.mockImplementation(async (path: string, method?: string) => method === 'DELETE' ? { removed: true } : { items: [run('one'), run('two')] }); await mount();
    await click(host.querySelector<HTMLButtonElement>('[aria-label^="删除读取记录"]')!);
    expect(mocks.request.mock.calls.some(([, method]) => method === 'DELETE')).toBe(false); expect(host.textContent).toContain('书架内容和 Codex 对话保留');
    await click(button('删除记录')); expect(mocks.request).toHaveBeenCalledWith('/reading/reads/one', 'DELETE', { confirm: true }); expect(host.querySelectorAll('.reading-recent-list > li')).toHaveLength(1);
    expect(host.querySelector('a')?.href).toBe('codex://threads/two'); expect(document.activeElement).toBe(button('刷新记录'));
  });
  it('retains a record after failed deletion and supports retry', async () => {
    mocks.request.mockResolvedValue({ items: [run('one')] }); await mount(); await click(host.querySelector<HTMLButtonElement>('[aria-label^="删除读取记录"]')!);
    mocks.request.mockRejectedValueOnce(new Error('Delete unavailable')); await click(button('删除记录'));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Delete unavailable'); expect(host.querySelectorAll('.reading-recent-list > li')).toHaveLength(1);
    await click(button('删除记录')); expect(host.textContent).toContain('还没有读取记录');
  });
  it('keeps partial coverage and retry visible without inventing a full sync', async () => {
    mocks.request.mockResolvedValue({ items: [run('partial', { status: 'partial', coverage: { from: '2026-09-26T12:00:00Z', to: '2026-09-27T12:00:00Z', complete: false } })] }); await mount();
    expect(host.textContent).toContain('部分历史'); await click(button('重新读取')); expect(retry).toHaveBeenCalled();
  });
  it('hides deletion while reading is still running', async () => {
    mocks.request.mockResolvedValue({ items: [run('active', { status: 'importing' })] }); await mount();
    expect(host.querySelector('[aria-label^="删除读取记录"]')).toBeNull(); expect(host.textContent).toContain('Codex 正在挑选内容');
  });
});

describe('reading permanent removal', () => {
  it('confirms one snapshot and keeps unrelated removed records', async () => {
    const entries = ['one', 'two'].map(id => ({ item: material(id), deletedAt: '2026-09-26T12:00:00Z', expiresAt: '2026-10-26T12:00:00Z' }));
    mocks.request.mockResolvedValue({ items: entries });
    await act(async () => { root.render(<ReadingTrash onChanged={onChanged} onBusy={onBusy}/>); });
    await click(button('永久删除')); expect(mocks.request.mock.calls.some(([, method]) => method === 'DELETE')).toBe(false); expect(host.textContent).toContain('原始网页、导入前的本机文件不会被删除');
    await click(button('确认永久删除')); expect(mocks.request).toHaveBeenCalledWith('/reading/trash/one', 'DELETE', { deletedAt: '2026-09-26T12:00:00Z' }); expect(host.textContent).toContain('Material two'); expect(host.textContent).not.toContain('Material one');
  });
});
