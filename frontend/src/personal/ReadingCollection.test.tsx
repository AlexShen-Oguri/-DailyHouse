// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReadingCollection, { type CollectionRun } from './ReadingCollection';
import { PreferencesProvider } from './Preferences';

const mocks = vi.hoisted(() => ({ request: vi.fn(), onChanged: vi.fn(), onHistory: vi.fn() }));
vi.mock('./api', async original => ({ ...(await original<typeof import('./api')>()), request: mocks.request }));
let root: Root; let host: HTMLDivElement;
let connected: boolean; let run: CollectionRun | null; let writeFailure: string; let statusFailure: string;
const makeRun = (overrides: Partial<CollectionRun> = {}): CollectionRun => ({ id: 'collect:one', status: 'queued', scanned: 0, createdAt: '2026-09-27T14:30:00Z', updatedAt: '2026-09-27T14:30:00Z', ...overrides });
async function mount(english = false) { if (english) localStorage.setItem('dailyhouse-language', 'en'); await act(async () => root.render(<PreferencesProvider><ReadingCollection onChanged={mocks.onChanged} onHistory={mocks.onHistory}><button>Quick import</button></ReadingCollection></PreferencesProvider>)); }
async function click(node: HTMLElement) { await act(async () => node.click()); }
function button(name: string) { const node = [...host.querySelectorAll('button')].find(candidate => (candidate.getAttribute('aria-label') || candidate.textContent?.trim()) === name); if (!node) throw new Error(`Missing button: ${name}`); return node; }
const writes = () => mocks.request.mock.calls.filter(([, method]) => method && method !== 'GET');
beforeEach(() => {
  vi.useFakeTimers(); (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  connected = true; run = null; writeFailure = ''; statusFailure = ''; localStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mocks.request.mockReset(); mocks.onChanged.mockReset().mockResolvedValue(undefined); mocks.onHistory.mockReset();
  mocks.request.mockImplementation(async (path: string, method = 'GET') => {
    if (path === '/reading/collection/setup') return { extensionPath: 'C:\\DailyHouse\\extensions\\bilibili' };
    if (method === 'GET' && path === '/reading/collection') { if (statusFailure) throw new Error(statusFailure); return { bridge: { connected }, run: run ? structuredClone(run) : null }; }
    if (writeFailure) throw new Error(writeFailure);
    if (path === '/reading/collection' && method === 'POST') return (run = makeRun());
    if (path === '/reading/collection/collect%3Aone/cancel') return (run = makeRun({ status: 'cancelled' }));
    if (method === 'DELETE') { run = null; return { removed: true }; }
    throw new Error(`Unexpected ${method} ${path}`);
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.useRealTimers(); });

describe('one-click Bilibili reading', () => {
  it('observes status without starting a collection on page load or idle refresh', async () => {
    await mount(); await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
    expect(writes()).toEqual([]); expect(button('一键读取 B 站历史').disabled).toBe(false);
    expect(host.textContent).not.toContain('读取完成');
  });
  it('opens honest one-time setup when the bridge is offline, then starts after it connects', async () => {
    connected = false; await mount(); await click(button('一键读取 B 站历史'));
    expect(writes()).toEqual([]); expect(host.textContent).toContain('当前没有开始读取'); expect(host.textContent).toContain('C:\\DailyHouse\\extensions\\bilibili'); expect(host.textContent).toContain('edge://extensions');
    expect(document.activeElement?.textContent).toBe('先连接你的浏览器');
    connected = true; await click(button('一键读取 B 站历史'));
    expect(writes()).toEqual([['/reading/collection', 'POST', {}]]); expect(host.textContent).toContain('等待浏览器接单'); expect(host.textContent).not.toContain('先连接你的浏览器'); expect(button('一键读取 B 站历史').disabled).toBe(true);
  });
  it('resumes an existing active run instead of starting another, allows stopping and retrying', async () => {
    run = makeRun({ status: 'reading', scanned: 40 }); await mount();
    expect(button('一键读取 B 站历史').disabled).toBe(true); expect(host.textContent).toContain('已读取 40 条历史'); expect(writes()).toEqual([]);
    await click(button('停止读取')); expect(writes()).toEqual([['/reading/collection/collect%3Aone/cancel', 'POST', {}]]); expect(host.textContent).toContain('已停止本次读取');
    await click(button('重新读取')); expect(writes().at(-1)).toEqual(['/reading/collection', 'POST', {}]);
  });
  it('polls actual results, exposes partial coverage and refreshes the shelf only once per result', async () => {
    await mount(); await click(button('一键读取 B 站历史'));
    run = makeRun({ status: 'partial', scanned: 54, result: { added: 2, updated: 1, review: 3, skipped: 48, batchId: 'batch:one' }, coverage: { from: '2026-09-25T14:30:00Z', to: '2026-09-27T14:30:00Z', complete: false } });
    await act(async () => { await vi.advanceTimersByTimeAsync(2200); });
    expect(host.textContent).toContain('新增 2 项 · 更新 1 项 · 待确认 3 项 · 跳过 48 项'); expect(host.textContent).toContain('仅部分记录'); expect(host.textContent).not.toContain('本次读取完成'); expect(mocks.onChanged).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(16000); }); expect(mocks.onChanged).toHaveBeenCalledOnce();
    await click(button('查看待确认与导入记录')); expect(mocks.onHistory).toHaveBeenCalledOnce();
  });
  it('requires confirmation to clear the terminal status and preserves import records', async () => {
    run = makeRun({ status: 'completed', result: { added: 1, updated: 0, review: 0, skipped: 8 } }); await mount();
    await click(button('清除此条读取状态')); expect(writes()).toEqual([]); expect(host.textContent).toContain('书架内容、导入批次和撤销入口都会保留');
    await click(button('取消')); expect(writes()).toEqual([]);
    await click(button('清除此条读取状态')); await click(button('确认清除状态'));
    expect(writes()).toEqual([['/reading/collection/collect%3Aone', 'DELETE', { confirm: true }]]); expect(host.textContent).not.toContain('本次读取完成'); expect(host.querySelector('#reading-collection-panel')).toBeNull(); expect(document.activeElement).toBe(button('一键读取 B 站历史'));
  });
  it('exposes failed starts and polling loss without claiming success and preserves retry', async () => {
    await mount(); writeFailure = 'Cannot start'; await click(button('一键读取 B 站历史'));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Cannot start'); expect(button('一键读取 B 站历史').disabled).toBe(false);
    writeFailure = ''; await click(button('一键读取 B 站历史')); statusFailure = 'Local service is offline';
    await act(async () => { await vi.advanceTimersByTimeAsync(2200); }); expect(host.querySelector('[role="alert"]')?.textContent).toBe('Local service is offline'); expect(host.textContent).not.toContain('本次读取完成');
  });
  it('explains login recovery in English and keeps a real history-page link', async () => {
    run = makeRun({ status: 'needs_login', issue: 'needs_login' }); await mount(true);
    expect(host.textContent).toContain('Sign in to Bilibili in your browser'); expect(host.textContent).toContain('Sign in in the browser with the extension'); expect(host.querySelector('a')?.href).toBe('https://www.bilibili.com/history'); expect(button('Read Bilibili history now').disabled).toBe(false);
  });
  it('does not clear records when server removal fails', async () => {
    run = makeRun({ status: 'failed', issue: 'read_failed' }); await mount(); await click(button('清除此条读取状态')); writeFailure = 'Could not clear'; await click(button('确认清除状态'));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Could not clear'); expect(host.textContent).toContain('本次读取未完成'); expect(button('确认清除状态').disabled).toBe(false);
  });
});
