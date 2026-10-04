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
async function mount(english = false, startRequest = 0) { if (english) localStorage.setItem('dailyhouse-language', 'en'); await act(async () => root.render(<PreferencesProvider><ReadingCollection startRequest={startRequest} onChanged={mocks.onChanged} onHistory={mocks.onHistory}><button>Quick import</button></ReadingCollection></PreferencesProvider>)); }
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
    if (method === 'GET' && path === '/reading/collection') { if (statusFailure) throw new Error(statusFailure); return { bridge: { connected }, run: run ? structuredClone(run) : null, history: [] }; }
    if (writeFailure) throw new Error(writeFailure);
    if (path === '/reading/collection' && method === 'POST') return (run = makeRun());
    if (path === '/reading/collection/collect%3Aone/cancel') return (run = makeRun({ status: 'cancelled' }));
    throw new Error(`Unexpected ${method} ${path}`);
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.useRealTimers(); });

describe('one-click Codex reading', () => {
  it('observes status without starting on page load or idle refresh', async () => {
    await mount(); await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
    expect(writes()).toEqual([]); expect(button('一键读取 B 站历史').disabled).toBe(false);
    expect(host.querySelector('#reading-collection-panel')).toBeNull();
  });
  it('explains an offline browser, then starts after it connects', async () => {
    connected = false; await mount(); await click(button('一键读取 B 站历史'));
    expect(writes()).toEqual([]); expect(host.textContent).toContain('当前没有开始读取'); expect(host.textContent).toContain('C:\\DailyHouse\\extensions\\bilibili');
    expect(document.activeElement?.textContent).toBe('先连接你的浏览器');
    connected = true; await click(button('一键读取 B 站历史'));
    expect(writes()).toEqual([['/reading/collection', 'POST', {}]]); expect(host.textContent).toContain('正在打开 B 站历史'); expect(button('一键读取 B 站历史').disabled).toBe(true);
  });
  it('resumes an active run without creating another and allows stopping', async () => {
    run = makeRun({ status: 'reading', scanned: 40 }); await mount();
    expect(button('一键读取 B 站历史').disabled).toBe(true); expect(writes()).toEqual([]);
    await click(button('停止读取')); expect(writes()).toEqual([['/reading/collection/collect%3Aone/cancel', 'POST', {}]]); expect(host.textContent).toContain('已停止读取');
  });
  it('shows an honest partial result without review queues and refreshes the shelf once', async () => {
    await mount(); await click(button('一键读取 B 站历史'));
    run = makeRun({ status: 'partial', scanned: 54, result: { added: 2, skipped: 52, itemIds: ['one', 'two'] }, coverage: { from: '2026-09-25T14:30:00Z', to: '2026-09-27T14:30:00Z', complete: false }, conversationUrl: 'codex://threads/collection-thread' });
    await act(async () => { await vi.advanceTimersByTimeAsync(2200); });
    expect(host.textContent).toContain('新增 2 项，已放入书架'); expect(host.textContent).toContain('只读取了部分历史'); expect(host.textContent).not.toMatch(/待确认|审阅|排除|批次/); expect(mocks.onChanged).toHaveBeenCalledOnce();
    expect(host.querySelector('a[href="codex://threads/collection-thread"]')).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(16000); }); expect(mocks.onChanged).toHaveBeenCalledOnce();
    await click(button('最近读取')); expect(mocks.onHistory).toHaveBeenCalledOnce();
  });
  it('shows the independent Codex conversation during sorting', async () => {
    run = makeRun({ status: 'importing', conversationUrl: 'codex://threads/one' }); await mount();
    expect(host.textContent).toContain('Codex 正在挑选内容、整理分类'); expect(host.querySelector('a')?.href).toBe('codex://threads/one');
  });
  it('exposes failed starts and polling loss without claiming success', async () => {
    await mount(); writeFailure = 'Cannot start'; await click(button('一键读取 B 站历史'));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Cannot start'); expect(button('一键读取 B 站历史').disabled).toBe(false);
    writeFailure = ''; await click(button('一键读取 B 站历史')); statusFailure = 'Local service is offline';
    await act(async () => { await vi.advanceTimersByTimeAsync(2200); }); expect(host.querySelector('[role="alert"]')?.textContent).toBe('Local service is offline'); expect(host.textContent).not.toContain('已放入书架');
  });
  it('explains login recovery in English with a real history link', async () => {
    run = makeRun({ status: 'needs_login', issue: 'needs_login' }); await mount(true);
    expect(host.textContent).toContain('Sign in to Bilibili, then try again.'); expect(host.querySelector('a')?.href).toBe('https://www.bilibili.com/history'); expect(button('Read Bilibili history now').disabled).toBe(false);
  });
  it.each([false, true])('announces shared conversation occupancy with recovery steps and no automatic retry (English: %s)', async english => {
    run = makeRun({ status: 'failed', issue: 'codex_busy', conversationUrl: 'codex://threads/shared' }); await mount(english);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(english ? 'archive and restore' : '归档后恢复');
    expect(host.querySelector('a')?.href).toBe('codex://threads/shared');
    expect(button(english ? 'Read again' : '重新读取').disabled).toBe(false);
    expect(writes()).toEqual([]);
  });
  it('starts one new run when retry is requested from recent readings', async () => {
    run = makeRun({ status: 'failed', issue: 'codex_failed' }); await mount(); expect(writes()).toEqual([]);
    await mount(false, 1); expect(writes()).toEqual([['/reading/collection', 'POST', {}]]);
    await mount(false, 1); expect(writes()).toHaveLength(1);
  });
  it('explains an actual request failure without claiming the user is signed out', async () => {
    run = makeRun({ status: 'failed', issue: 'codex_failed', failure: { code: 'unavailable', reason: 'rpc_-32602' } }); await mount();
    expect(host.textContent).toContain('RPC -32602'); expect(host.textContent).toContain('采集接口需要修复');
    expect(host.textContent).not.toContain('检查 Codex 登录'); expect(writes()).toEqual([]);
  });
  it('shows model usage and connection failures in the selected language', async () => {
    run = makeRun({ status: 'failed', issue: 'codex_failed', failure: { code: 'failed', reason: 'usage_limit' } }); await mount(true);
    expect(host.textContent).toContain('usage limit was reached');
    run = makeRun({ status: 'failed', issue: 'codex_failed', failure: { code: 'unavailable', reason: 'connection_closed' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(16000); }); expect(host.textContent).toContain('connection closed early');
  });
});
