import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QuickReadingImport from './QuickReadingImport';
import LocalPathPicker from './LocalPathPicker';
import ReadingClassification from './ReadingClassification';
import type { ReadingItem } from './reading-model';
import type { QuickEntry } from './quick-reading-model';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./api', async original => ({ ...(await original<typeof import('./api')>()), request: mocks.request }));
const onImported = vi.fn(async () => {}); const onClose = vi.fn(); const onBusy = vi.fn();
let host: HTMLDivElement; let root: Root; let applyFailure = false; let fetchMock: ReturnType<typeof vi.fn>;
function button(name: string) { const node = [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === name || item.getAttribute('aria-label') === name); if (!node) throw new Error(`Missing button ${name}`); return node; }
async function click(node: HTMLElement) { await act(async () => node.click()); }
async function change(node: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value')!.set!.call(node, value); node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }); }
async function mount() { await act(async () => root.render(<QuickReadingImport onClose={onClose} onImported={onImported} onBusy={onBusy}/>)); }
async function upload(files: File[]) { const node = host.querySelector<HTMLInputElement>('input[type="file"]')!; Object.defineProperty(node, 'files', { value: files, configurable: true }); await act(async () => node.dispatchEvent(new Event('change', { bubbles: true }))); }
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mocks.request.mockReset(); onImported.mockClear(); onClose.mockClear(); onBusy.mockClear(); applyFailure = false;
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ uploadId: 'upload-one', title: 'A local lesson', type: 'article' }) })); vi.stubGlobal('fetch', fetchMock);
  mocks.request.mockImplementation(async (path: string, _method: string, payload?: { items: QuickEntry[] }) => {
    if (path.endsWith('/preview')) {
      const candidates = payload!.items.map((item, index) => ({ ...item, title: item.title || 'A useful article', type: item.type || 'article', url: item.url || '', notes: item.notes || '', category: item.category || 'other', index, sourceKey: item.url || item.uploadId, decision: item.url?.includes('duplicate') ? 'duplicate' : 'import', reason: 'Already saved' }));
      return { candidates, counts: { total: candidates.length, accepted: candidates.filter(item => item.decision === 'import').length, duplicates: candidates.filter(item => item.decision === 'duplicate').length, suppressed: 0 } };
    }
    if (path.endsWith('/apply')) { if (applyFailure) throw new Error('Could not save this batch'); return { items: payload!.items }; }
    return {};
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('quick reading import', () => {
  it('skips duplicates automatically and saves edited categories without another review step', async () => {
    await mount(); await change(host.querySelector('textarea')!, 'https://example.com/article\nhttps://example.com/duplicate'); await click(button('继续'));
    expect(host.textContent).toContain('已在书架'); expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    await change(host.querySelector<HTMLSelectElement>('select[aria-label="分类：1"]')!, 'design');
    expect(button('收进书架（1）').disabled).toBe(false); await click(button('收进书架（1）'));
    expect(mocks.request).toHaveBeenCalledWith('/reading/quick-import/apply', 'POST', { items: [expect.objectContaining({ url: 'https://example.com/article', category: 'design' })] });
    expect(onImported).toHaveBeenCalledWith(1);
  });
  it('uses the browser multi-file input, stages a document, and removes its staged copy on cancel', async () => {
    await mount(); await click(button('选本机文件')); const node = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(node.multiple).toBe(true); expect(node.accept).toContain('.pdf');
    const file = new File(['Document text'], 'lesson.txt', { type: 'text/plain' }); await upload([file]);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('filename=lesson.txt'), expect.objectContaining({ method: 'POST', body: file }));
    expect(mocks.request).toHaveBeenCalledWith('/reading/quick-import/preview', 'POST', { items: [expect.objectContaining({ uploadId: 'upload-one' })] });
    expect(mocks.request.mock.calls.some(([path]) => path.endsWith('/apply'))).toBe(false);
    await click(button('取消本次导入')); expect(onClose).toHaveBeenCalledOnce();
    await act(async () => root.render(<div/>)); expect(mocks.request).toHaveBeenCalledWith('/reading/quick-import/uploads/upload-one', 'DELETE');
  });
  it('reads JSON link lists locally without uploading the list as a document', async () => {
    await mount(); await click(button('选本机文件')); const file = new File([], 'saved.json'); Object.defineProperty(file, 'text', { value: async () => '{"items":[{"url":"https://github.com/a/b","title":"My project"}]}' });
    await upload([file]); expect(fetchMock).not.toHaveBeenCalled(); expect(host.textContent).toContain('My project');
  });
  it('keeps a failed import preview available for retry and leaves automatic classification unset', async () => {
    await mount(); await change(host.querySelector('textarea')!, 'https://example.com/article'); await click(button('继续')); applyFailure = true;
    await click(button('收进书架（1）')); expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not save'); expect(onImported).not.toHaveBeenCalled();
    applyFailure = false; await click(button('收进书架（1）'));
    const body = mocks.request.mock.calls.filter(([path]) => path.endsWith('/apply'))[1][2]; expect(body.items[0].category).toBeUndefined(); expect(onImported).toHaveBeenCalledOnce();
  });
  it('rejects oversized text before upload and supports a book with no URL', async () => {
    await mount(); await click(button('选本机文件')); const file = new File([], 'large.txt'); Object.defineProperty(file, 'size', { value: 3 * 1024 * 1024 }); await upload([file]);
    expect(fetchMock).not.toHaveBeenCalled(); expect(host.textContent).toContain('超过 2 MB');
    await click(button('记一本书')); await change(host.querySelector('input')!, 'The Design of Everyday Things'); await click(button('继续'));
    await click(button('收进书架（1）')); expect(onImported).toHaveBeenCalledWith(1);
  });
});

describe('local source picker', () => {
  it('returns a selected path without silently saving settings and leaves it untouched on cancellation', async () => {
    const changePath = vi.fn(); const error = vi.fn(); fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ cancelled: true }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ path: 'C:\\fixtures\\semester.ics' }) });
    await act(async () => root.render(<LocalPathPicker kind="calendar" label="Calendar file" value="old.ics" onChange={changePath} onError={error}/>));
    await click(button('选择文件')); expect(changePath).not.toHaveBeenCalled(); await click(button('选择文件')); expect(changePath).toHaveBeenCalledWith('C:\\fixtures\\semester.ics');
    expect(mocks.request).not.toHaveBeenCalled(); expect(fetchMock.mock.calls[0][1].body).toBe('{"kind":"calendar"}');
  });
});

describe('reading classification feedback', () => {
  it('allows failed sorting to retry and does not expose legacy review prompts', async () => {
    const changed = vi.fn(async () => {}); const item: ReadingItem = { id: 'one', title: 'A lesson', type: 'article', url: 'https://example.com', notes: '', status: 'unread', origin: 'manual', addedAt: '', updatedAt: '', classification: { status: 'failed', message: 'Model unavailable' } };
    await act(async () => root.render(<ReadingClassification item={item} onChanged={changed}/>)); await click(button('重试分类'));
    expect(mocks.request).toHaveBeenCalledWith('/reading/one/classify', 'POST', {});
    await act(async () => root.render(<ReadingClassification item={{ ...item, classification: { status: 'review', suggestedCategory: 'design', confidence: 'low' } }} onChanged={changed}/>));
    expect(host.textContent).not.toMatch(/确认|建议|待分类/); expect(mocks.request.mock.calls.some(([, method]) => method === 'PATCH')).toBe(false);
  });
});
