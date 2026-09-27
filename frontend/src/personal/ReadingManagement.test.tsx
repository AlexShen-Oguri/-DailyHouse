// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReadingTrash, { type TrashEntry } from './ReadingTrash';
import ReadingImports, { type ImportBatch, type ImportCandidate, type ImportPayload, type ImportPreview } from './ReadingImports';
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
async function upload(payload: unknown, options: { size?: number; raw?: string } = {}) {
  const file = new File([options.raw ?? JSON.stringify(payload)], 'history.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => options.raw ?? JSON.stringify(payload) });
  if (options.size) Object.defineProperty(file, 'size', { value: options.size });
  const target = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(target, 'files', { configurable: true, value: [file] });
  await act(async () => { target.dispatchEvent(new Event('change', { bubbles: true })); });
}
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

describe('reading import preview and batch history', () => {
  let candidates: ImportCandidate[]; let batches: ImportBatch[]; let failure: string;
  const counts = (rows: ImportCandidate[]) => ({ total: rows.length, accepted: rows.filter(row => row.decision === 'import').length, excluded: rows.filter(row => row.decision === 'excluded').length, review: rows.filter(row => row.decision === 'review').length, duplicates: rows.filter(row => row.decision === 'duplicate').length, suppressed: rows.filter(row => row.decision === 'suppressed').length });
  const batch = (rows = candidates): ImportBatch => ({ id: 'batch-one', createdAt: '2026-09-27T12:00:00Z', counts: counts(rows), addedCount: rows.filter(row => row.decision === 'import').length, duplicateCount: 0, excludedCount: 0, reviewCount: rows.filter(row => row.decision === 'review').length, suppressedCount: 0, itemIds: ['new-one'], canUndo: true, candidates: rows });
  const source = (): ImportPayload => ({ items: candidates.map(({ title, url, notes, viewedAt, progress }) => ({ title, url, notes, viewedAt, progress })), coverage: { from: '2026-09-25T12:00:00Z', to: '2026-09-27T12:00:00Z', complete: false } });
  beforeEach(() => {
    failure = ''; batches = [];
    candidates = [
      { index: 0, title: 'React tutorial', url: 'https://www.bilibili.com/video/BV1a6Yx62EH4/', notes: '', viewedAt: '2026-09-26T10:00:00Z', progress: 0.1, sourceKey: 'bili:one', category: 'programming', reason: 'Relevant tutorial', decision: 'import' },
      { index: 1, title: 'An uncertain workshop', url: 'https://www.bilibili.com/video/BV1a6Yx62EH5/', notes: '', viewedAt: '2026-09-26T10:00:00Z', progress: 0.2, sourceKey: 'bili:two', category: 'other', reason: 'Please confirm the topic', decision: 'review' },
      { index: 2, title: 'Already saved video', url: 'https://www.bilibili.com/video/BV1a6Yx62EH6/', notes: '', viewedAt: '2026-09-26T10:00:00Z', progress: 0.1, sourceKey: 'bili:three', category: 'ai', reason: 'Source is already saved', decision: 'duplicate' },
    ];
    mocks.request.mockImplementation(async (path: string, method = 'GET', payload?: ImportPayload) => {
      if (path === '/reading/imports' && method === 'GET') return { items: structuredClone(batches) };
      if (path === '/reading/imports/preview' || (path === '/reading/imports' && method === 'POST')) {
        if (failure && path === '/reading/imports') throw new Error(failure);
        const rows = candidates.map(candidate => ({ ...candidate, decision: payload?.excludedUrls?.includes(candidate.url) ? 'excluded' as const : candidate.decision === 'review' && payload?.acceptedUrls?.includes(candidate.url) ? 'import' as const : candidate.decision }));
        const result: ImportPreview = { candidates: rows, counts: counts(rows), coverage: payload?.coverage, window: { from: '2026-09-20T12:00:00Z', to: '2026-09-27T12:00:00Z' } };
        if (path.endsWith('/preview')) return result;
        const saved = batch(rows); batches = [saved]; return { ...result, batch: saved, items: rows.filter(row => row.decision === 'import').map((_, index) => material(String(index))) };
      }
      if (path === '/reading/imports/batch-one/undo') {
        batches = [{ ...batches[0], canUndo: false, undoneAt: '2026-09-27T12:00:00Z', undoResult: { removedCount: 1, conflictCount: 1, skippedCount: 0 } }];
        return { batchId: 'batch-one', removedIds: ['one'], conflictIds: ['edited'], skippedIds: [], alreadyUndone: false };
      }
      throw new Error(`Unexpected request ${method} ${path}`);
    });
  });
  const mount = async () => { await act(async () => { root.render(<ReadingImports onChanged={onChanged} onBusy={onBusy}/>); }); };
  const commits = () => mocks.request.mock.calls.filter(([path, method]) => path === '/reading/imports' && method === 'POST');

  it('previews before saving, requires an updated preview after review choices, then retains the batch log', async () => {
    await mount(); await upload(source());
    expect(commits()).toEqual([]); expect(host.textContent).toContain('历史覆盖不完整');
    expect(host.textContent).toContain('Source is already saved');
    expect(host.querySelector<HTMLInputElement>('[aria-label="收录：Already saved video"]')).toBeNull();
    await click(input('收录：An uncertain workshop'));
    expect(button('确认收录 1 项').disabled).toBe(true);
    await click(button('更新预览'));
    expect(mocks.request.mock.calls.at(-1)?.[2]).toEqual(expect.objectContaining({ acceptedUrls: [candidates[1].url] }));
    await click(button('确认收录 2 项'));
    expect(commits()).toHaveLength(1); expect(onChanged).toHaveBeenCalledOnce();
    expect(host.querySelector('.reading-import-preview')).toBeNull();
    expect(host.textContent).toContain('逐项结果'); expect(host.textContent).toContain('撤销此批次');
  });

  it('preserves explicit exclusions and never commits a stale preview', async () => {
    await mount(); await upload(source());
    await click(input('收录：React tutorial'));
    expect(button('确认收录 1 项').disabled).toBe(true); await click(button('确认收录 1 项')); expect(commits()).toEqual([]);
    await click(button('更新预览'));
    expect(input('收录：React tutorial').checked).toBe(false);
    await click(button('保存本次审阅记录'));
    expect(commits()[0][2]).toEqual(expect.objectContaining({ excludedUrls: [candidates[0].url] }));
    expect(host.textContent).toContain('1 项保留在批次记录中待确认');
  });

  it('rejects oversized and malformed files without sending import requests', async () => {
    await mount(); await upload(source(), { size: 2 * 1024 * 1024 + 1 });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('超过 2 MB');
    await upload(null, { raw: '{oops' });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('无法解析 JSON');
    expect(mocks.request.mock.calls.every(([, method]) => !method || method === 'GET')).toBe(true);
  });

  it('accepts UTF-8 BOM files like the local import CLI', async () => {
    await mount();
    await upload(source(), { raw: '\uFEFF' + JSON.stringify(source()) });
    expect(mocks.request).toHaveBeenCalledWith('/reading/imports/preview', 'POST', source());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(button('确认收录 1 项').disabled).toBe(false);
  });

  it('clears a rejected file selection so a corrected file with the same name can be chosen again', async () => {
    await mount();
    const file = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(file, 'value', { configurable: true, writable: true, value: 'C:\\fakepath\\history.json' });
    mocks.request.mockRejectedValueOnce(new Error('Invalid history timestamp'));
    await upload(source());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Invalid history timestamp');
    expect(file.value).toBe('');
    expect(host.querySelector('.reading-import-preview')).toBeNull();
    await upload(source());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(button('确认收录 1 项').disabled).toBe(false);
  });

  it('retains the reviewed payload after save fails and supports retry', async () => {
    await mount(); await upload(source()); failure = 'Local save failed';
    await click(button('确认收录 1 项'));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Local save failed');
    expect(host.querySelector('.reading-import-preview')).not.toBeNull();
    failure = ''; await click(button('确认收录 1 项'));
    expect(commits()).toHaveLength(2); expect(host.querySelector('.reading-import-preview')).toBeNull();
  });

  it('confirms batch undo separately and reports conflicts without claiming edited items were removed', async () => {
    batches = [batch()]; await mount();
    await click(button('撤销此批次')); await click(button('取消'));
    expect(mocks.request.mock.calls.some(([path]) => path.endsWith('/undo'))).toBe(false);
    await click(button('撤销此批次')); await click(button('确认撤销批次'));
    expect(mocks.request).toHaveBeenCalledWith('/reading/imports/batch-one/undo', 'POST', {});
    expect(host.textContent).toContain('保留 1 项后来修改的内容');
    expect(host.textContent).toContain('已撤销'); expect(onChanged).toHaveBeenCalledOnce();
    expect(Array.from(host.querySelectorAll('button')).some(node => node.textContent === '撤销此批次')).toBe(false);
  });
});
