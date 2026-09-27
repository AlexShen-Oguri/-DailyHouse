import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';

const extension = resolve(import.meta.dirname, '../../extensions/bilibili-reading');
const script = (name: string) => readFileSync(resolve(extension, name), 'utf8');
const id = JSON.parse(script('identity.json')).id;
const job = { id: 'run-a', from: '2026-09-20T16:00:00.000Z', to: '2026-09-27T16:00:00.000Z' };
const url = (n = 1, part = '') => `https://www.bilibili.com/video/BV${String(n).padStart(10, '0')}/${part}`;
const row = (n = 1, viewedAt: string | null = job.to, progress: number | null = 0.1, part = '') => ({ title: `教程 ${n}`, url: url(n, part), viewedAt, progress, notes: '页面证据' });
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
function parser() {
  const context = createContext({ URL, Date });
  runInContext(script('parser.js'), context);
  return context.DailyHouseHistory;
}
afterEach(() => vi.useRealTimers());

describe('Bilibili DOM evidence parsing', () => {
  it('retains exact known progress while unknown and malformed positions stay unknown', () => {
    const p = parser();
    expect(p.progress('看到 00:00 / 10:00')).toBe(0);
    expect(p.progress('看到 02:30 / 10:00')).toBe(0.25);
    expect(p.progress('01:20:00 / 02:00:00')).toBeCloseTo(2 / 3);
    expect(p.progress('已看完')).toBe(1);
    for (const value of ['', '刚刚看过', '看到 02:30', '00:10 / 00:00', '00:61 / 10:00', '11:00 / 10:00', '1234:10 / 999:59']) expect(p.progress(value)).toBeNull();
  });
  it('parses visible local calendar dates with explicit resulting timezones and rejects invalid dates', () => {
    const p = parser(); const now = new Date(2026, 8, 27, 16, 0);
    expect(p.viewedAt('今天 15:05', now)).toBe(new Date(2026, 8, 27, 15, 5).toISOString());
    expect(p.viewedAt('昨天 14:30', now)).toBe(new Date(2026, 8, 26, 14, 30).toISOString());
    expect(p.viewedAt('2026年9月20日 09:10', now)).toBe(new Date(2026, 8, 20, 9, 10).toISOString());
    expect(p.viewedAt('12-31 20:00', new Date(2026, 0, 2, 12))).toBe(new Date(2025, 11, 31, 20).toISOString());
    for (const value of ['2026-02-30 10:00', '今天 24:00', '今天 16:30', '很久以前', '10:30']) expect(p.viewedAt(value, now)).toBeNull();
  });
  it('normalizes video URLs without losing current-part evidence or accepting foreign schemes', () => {
    const p = parser();
    expect(p.canonical(`${url()}?spm_id=abc&p=3`)).toBe(url(1, '?p=3'));
    expect(p.canonical(`${url()}?p=-2`)).toBe(url());
    expect(p.canonical(`/video/BV0000000001/?p=2`)).toBe(url(1, '?p=2'));
    for (const value of ['https://www.bilibili.com.evil.test/video/BV0000000001', 'ftp://www.bilibili.com/video/BV0000000001', 'https://name:pass@www.bilibili.com/video/BV0000000001', 'https://live.bilibili.com/123']) expect(p.canonical(value)).toBeNull();
  });
  it('reads only rendered cards and accepts only visible Bilibili cover hosts', () => {
    const p = parser();
    const card = (visible: boolean, cover: string) => ({
      getClientRects: () => visible ? [{}] : [],
      querySelector: (selector: string) => ({
        '.bili-video-card__title a': { innerText: '设计入门', getAttribute: () => `${url()}?p=2` },
        '.bili-video-card__corner': { innerText: '今天 10:00' },
        '.bili-cover-card__stats': { innerText: '进度未知' },
        '.bili-cover-card__thumbnail img': { getAttribute: () => cover },
      })[selector],
    });
    const rows = p.readCards({ querySelectorAll: () => [card(false, 'https://i0.hdslb.com/hidden.jpg'), card(true, '//i0.hdslb.com/cover.jpg'), card(true, 'https://evil.test/cover.jpg')] }, new Date(2026, 8, 27, 16));
    expect(rows).toHaveLength(2); expect(rows[0]).toMatchObject({ progress: null, url: url(1, '?p=2'), coverUrl: 'https://i0.hdslb.com/cover.jpg' });
    expect(rows[1]).not.toHaveProperty('coverUrl');
  });
});

async function collect(pages: { rows: any[]; end?: string; text?: string }[], stopOnProgress = false, clock: { now?: Date; readDates?: string[]; readTimes?: number[]; hiddenForMs?: number; scrolls?: unknown[] } = {}) {
  vi.useFakeTimers(); vi.setSystemTime(clock.now ?? new Date(job.to));
  const began = Date.now();
  const sent: any[] = []; let index = -1;
  const page = () => pages[Math.min(Math.max(index, 0), pages.length - 1)];
  const context = createContext({
    URL, Date, Map, Set, setTimeout, clearTimeout, setInterval, clearInterval,
    location: { origin: 'https://www.bilibili.com', pathname: '/history' },
    document: { get hidden() { return Date.now() < began + (clock.hiddenForMs ?? 0); }, body: { get innerText() { return page().text ?? ''; } }, documentElement: { scrollHeight: 2000 }, querySelector: () => ({ get innerText() { return page().end ?? ''; }, scrollIntoView: (value: unknown) => clock.scrolls?.push(value) }), querySelectorAll: () => page().rows },
    window: { scrollTo: vi.fn() },
    DailyHouseHistory: { readCards: (_document: any, date: Date) => { clock.readDates?.push(date.toISOString()); clock.readTimes?.push(Date.now()); index++; return page().rows; } },
    chrome: { runtime: { onMessage: { addListener: vi.fn() }, sendMessage: async (message: any) => { sent.push(plain(message)); return message.type === 'ready' ? { job } : stopOnProgress && message.type === 'progress' ? { stop: true } : { ok: true }; } } },
  });
  runInContext(script('content.js'), context);
  await vi.runAllTimersAsync();
  return sent;
}

describe('Bilibili collection window and latest evidence', () => {
  it('waits through hidden-tab loading pauses and brings the next-page sentinel into view', async () => {
    const readTimes: number[] = [], scrolls: unknown[] = [];
    const sent = await collect([{ rows: [row(1)] }, { rows: [row(1), row(2, '2026-09-20T15:59:00.000Z')] }], false, { hiddenForMs: 16000, readTimes, scrolls });
    expect(readTimes[0]).toBe(Date.parse(job.to) + 16000);
    expect(scrolls).toEqual([{ block: 'center', behavior: 'instant' }]);
    expect(sent.find(x => x.type === 'submit')).toMatchObject({ items: [row(1)], coverage: { complete: true } });
    expect(sent.some(x => x.type === 'progress')).toBe(true);
  });
  it('resolves today/yesterday against collection page time even when the job was queued on a previous day', async () => {
    const readDates: string[] = []; const now = new Date('2026-09-28T04:00:30.000Z');
    await collect([{ rows: [], text: '暂无历史记录' }], false, { now, readDates });
    expect(readDates).toEqual([now.toISOString()]); expect(readDates[0]).not.toBe(job.to);
  });
  it('keeps the exact seven-day boundary and excludes older cards', async () => {
    const sent = await collect([{ rows: [row(1, job.from), row(2, '2026-09-20T15:59:00.000Z')] }]);
    expect(sent.find(x => x.type === 'submit')).toMatchObject({ items: [row(1, job.from)], coverage: { from: job.from, to: job.to, complete: true } });
  });
  it('uses the latest viewing across parts even if its progress is unknown or too high', async () => {
    const sent = await collect([{ rows: [row(1, job.to, null, '?p=3'), row(1, '2026-09-26T16:00:00.000Z', 0.01, '?p=1'), row(2, job.to, 0.9), row(2, job.from, 0.02)], end: '没有更多' }]);
    const result = sent.find(x => x.type === 'submit');
    expect(result.items).toEqual([row(1, job.to, null, '?p=3'), row(2, job.to, 0.9)]);
    expect(result).not.toHaveProperty('acceptedUrls');
  });
  it('does not resurrect older progress when an undated same-video row appears later', async () => {
    const sent = await collect([{ rows: [row(1), row(1, null), row(2)], end: '没有更多' }]);
    expect(sent.find(x => x.type === 'submit')).toMatchObject({ items: [row(2)], coverage: { complete: false } });
  });
  it('does not select older progress when newer evidence arrives after the run snapshot', async () => {
    const sent = await collect([{ rows: [row(1, '2026-09-27T16:01:00.000Z', 0.8), row(1, job.from, 0.01), row(2)], end: '没有更多' }]);
    expect(sent.find(x => x.type === 'submit').items).toEqual([row(2)]);
  });
  it('keeps first visible evidence when timestamps tie to the minute', async () => {
    const sent = await collect([{ rows: [row(1, job.to, 0.8), row(1, job.to, 0.02)], end: '没有更多' }]);
    expect(sent.find(x => x.type === 'submit').items[0].progress).toBe(0.8);
  });
  it('marks capped output partial even when the page also shows the end', async () => {
    const sent = await collect([{ rows: Array.from({ length: 1001 }, (_, n) => row(n + 1)), end: '没有更多' }]);
    const result = sent.find(x => x.type === 'submit'); expect(result.items).toHaveLength(1000); expect(result.coverage.complete).toBe(false);
  });
  it('reports login and unparseable dates honestly, while a visibly empty history completes', async () => {
    expect((await collect([{ rows: [], text: '登录后可查看历史记录' }])).find(x => x.type === 'fail')?.issue).toBe('needs_login');
    expect((await collect([{ rows: [row(1, null)], end: '没有更多' }])).find(x => x.type === 'fail')?.issue).toBe('unsupported_page');
    expect((await collect([{ rows: [], text: '暂无历史记录' }])).find(x => x.type === 'submit')).toMatchObject({ items: [], coverage: { complete: true } });
  });
  it('stops without submitting after the bridge cancels the run', async () => {
    const sent = await collect([{ rows: [row()] }], true);
    expect(sent.some(x => x.type === 'progress')).toBe(true); expect(sent.some(x => ['submit', 'fail'].includes(x.type))).toBe(false);
  });
});

function worker(options: { earlyReady?: boolean; notReady?: boolean; tabFails?: boolean; initial?: any; api?: (path: string, body: any) => Promise<any> } = {}) {
  let state = options.initial; let listener: any;
  const requests: any[] = []; const starts: any[] = []; const earlyReplies: any[] = []; const opened: any[] = [];
  const sender = { id, url: 'https://www.bilibili.com/history', frameId: 0, tab: { id: 17 } };
  const emit = (value: any, source: any = sender) => new Promise(resolve => { listener(value, source, resolve); });
  const event = () => ({ addListener: vi.fn() });
  const context = createContext({ URL, AbortSignal,
    fetch: async (address: string, init: any) => { const path = address.replace('http://127.0.0.1:3456/api/reading-bridge', ''); const body = JSON.parse(init.body); requests.push({ path, body, init }); const value = options.api ? await options.api(path, body) : path === '/poll' ? { job } : path.endsWith('/claim') ? { job, token: 'lease-token' } : { ok: true }; return { ok: true, status: 200, json: async () => value }; },
    chrome: {
      runtime: { id, onMessage: { addListener: (value: any) => { listener = value; } }, onInstalled: event(), onStartup: event() },
      alarms: { get: async () => ({ name: 'exists' }), create: vi.fn(), onAlarm: event() }, action: { onClicked: event() },
      storage: { session: { get: async () => ({ active: state }), set: async (value: any) => { state = value.active; }, remove: async () => { state = undefined; } } },
      tabs: { create: async (value: any) => { opened.push(value); if (options.tabFails) throw new Error('tab unavailable'); if (options.earlyReady) earlyReplies.push(await emit({ type: 'ready' })); return { id: 17 }; }, sendMessage: async (_tab: number, value: any) => { starts.push(value); if (options.notReady) throw new Error('no receiver yet'); } },
    },
  });
  runInContext(script('background.js'), context);
  return { context, requests, starts, earlyReplies, opened, sender, emit, state: () => state, poll: () => runInContext('poll()', context) };
}

describe('extension worker handoff, lifecycle and scope', () => {
  it('recovers if content-ready arrives before active state is saved', async () => {
    const w = worker({ earlyReady: true }); await w.poll();
    expect(w.opened).toEqual([{ url: 'https://www.bilibili.com/history', active: true }]);
    expect(w.earlyReplies).toEqual([{ stop: true }]); expect(w.starts).toEqual([{ type: 'start', job }]);
    expect(await w.emit({ type: 'ready' })).toEqual({ job });
    expect(w.state().token).toBe('lease-token'); expect(await w.emit({ type: 'ready' })).not.toHaveProperty('token');
  });
  it('lets document-idle claim its saved job when immediate start had no receiver', async () => {
    const w = worker({ notReady: true }); await w.poll(); expect(await w.emit({ type: 'ready' })).toEqual({ job });
    expect(w.requests.some(x => x.path.endsWith('/fail'))).toBe(false);
  });
  it('reports inability to create a tab after claiming instead of silently leaving a lease', async () => {
    const w = worker({ tabFails: true }); await w.poll();
    expect(w.requests.at(-1)).toMatchObject({ path: '/run-a/fail', body: { token: 'lease-token', issue: 'page_unavailable' } }); expect(w.state()).toBeUndefined();
  });
  it('coalesces overlapping alarm polls into a single claim', async () => {
    let release!: (value: any) => void;
    const w = worker({ api: async path => path === '/poll' ? new Promise(resolve => { release = resolve; }) : { job, token: 'lease-token' } });
    const first = w.poll(); await w.poll(); release({ job }); await first;
    expect(w.requests.map(x => x.path)).toEqual(['/poll', '/run-a/claim']); expect(w.starts).toHaveLength(1);
  });
  it('does not clear a newer active run when an old submit acknowledgment arrives late', async () => {
    let release!: (value: any) => void;
    let entered!: () => void; const fetched = new Promise<void>(resolve => { entered = resolve; });
    const w = worker({ initial: { id: job.id, job, token: 'old-lease', tabId: 17 }, api: async () => new Promise(resolve => { release = resolve; entered(); }) });
    const pending = w.emit({ type: 'submit', id: job.id, items: [], scanned: 0, coverage: { from: job.from, to: job.to, complete: true } });
    await fetched;
    await runInContext("chrome.storage.session.set({ active: { id: 'run-new', tabId: 19 } })", w.context);
    release({ ok: true }); await pending; expect(w.state().id).toBe('run-new');
  });
  it('restores an active run after worker shutdown and excludes content-script selection overrides', async () => {
    const w = worker({ initial: { id: job.id, job, token: 'saved-lease', tabId: 17 } });
    expect(await w.emit({ type: 'ready' })).toEqual({ job });
    await w.emit({ type: 'submit', id: job.id, items: [row()], scanned: 1, coverage: { from: job.from, to: job.to, complete: true }, acceptedUrls: [url()], cookie: 'untrusted' });
    expect(w.requests[0].body).toEqual({ token: 'saved-lease', items: [row()], scanned: 1, coverage: { from: job.from, to: job.to, complete: true } }); expect(w.state()).toBeUndefined();
  });
  it('rejects other extensions, tabs, frames, paths and stale run IDs before network access', async () => {
    const w = worker({ initial: { id: job.id, job, token: 'saved-lease', tabId: 17 } });
    for (const sender of [{ ...w.sender, id: 'other' }, { ...w.sender, tab: { id: 18 } }, { ...w.sender, frameId: 1 }, { ...w.sender, url: 'https://www.bilibili.com/video/BV0000000001' }, { ...w.sender, url: 'https://evil.test/history' }]) expect(await w.emit({ type: 'progress', id: job.id, scanned: 1 }, sender)).toEqual({ stop: true });
    expect(await w.emit({ type: 'progress', id: 'stale', scanned: 1 })).toEqual({ stop: true }); expect(w.requests).toHaveLength(0);
  });
  it('sends only fixed local POSTs, without cookies or redirected destinations', async () => {
    const w = worker(); await w.poll();
    for (const request of w.requests) expect(request.init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-DailyHouse-Extension': id } });
    const manifest = JSON.parse(script('manifest.json'));
    expect(manifest.permissions).toEqual(['alarms', 'storage']); expect(manifest.host_permissions).toEqual(['https://www.bilibili.com/*', 'http://127.0.0.1/*']);
    expect(manifest.content_scripts[0].all_frames).toBe(false); expect(manifest).not.toHaveProperty('externally_connectable');
  });
});
