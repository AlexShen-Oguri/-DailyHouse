import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPersonalApp } from '../src/personal/app';
import { ReadingCollectionService, READING_EXTENSION_ID, type CollectionSelector } from '../src/personal/reading-collection';
import { PersonalStore } from '../src/personal/store';
import type { ReadingCategory } from '../src/personal/types';
import { CodexReadingError } from '../src/personal/codex-reading-client';

let directory: string, file: string, store: PersonalStore, service: ReadingCollectionService, now: number;
let server: Server | undefined;
const select = vi.fn<CollectionSelector['select']>();
const pendingResolvers: (() => void)[] = [];
const url = (suffix: string) => 'https://www.bilibili.com/video/BV1xx411c7' + suffix + '/';
const inputItem = (suffix: string, extra: Record<string, unknown> = {}) => ({ title: 'Python 入门教程', url: url(suffix), viewedAt: new Date(now - 60000).toISOString(), progress: 0.1, ...extra });
const coverage = (complete = true) => ({ from: new Date(now - 7 * 86400000).toISOString(), to: new Date(now).toISOString(), complete });
function ready() { const run = service.start({}); const claim = service.claim(run.id, {}); return { ...run, token: claim.token }; }
async function collect(items: ReturnType<typeof inputItem>[], complete = true) {
  const run = ready(); service.submit(run.id, { token: run.token, items, coverage: coverage(complete) }); await service.whenIdle(); return service.state().run!;
}
function deferredSelection() {
  let resolve!: (value: { selected: { index: number; category: ReadingCategory }[] }) => void;
  const promise = new Promise<{ selected: { index: number; category: ReadingCategory }[] }>(done => { resolve = done; });
  pendingResolvers.push(() => resolve({ selected: [] }));
  select.mockImplementationOnce(() => promise); return { resolve };
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'garden-reading-collection-')); file = join(directory, 'runtime', 'collection.json');
  now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
  select.mockReset(); select.mockImplementation(async items => ({ selected: items.map((_, index) => ({ index, category: 'programming_ai' })) }));
  store = new PersonalStore(join(directory, 'personal.json'), undefined, join(directory, 'reports'));
  service = new ReadingCollectionService(file, store, { now: () => now, selector: { select }, extensionPath: join(directory, 'extension') });
});
afterEach(async () => {
  service.close(); for (const resolve of pendingResolvers.splice(0)) resolve(); await service.whenIdle();
  if (server) { const closed = new Promise<void>(resolve => server!.close(() => resolve())); server.closeAllConnections(); await closed; server = undefined; }
  vi.restoreAllMocks(); rmSync(directory, { recursive: true, force: true });
});

describe('Codex history collection lifecycle', () => {
  it('preserves a busy conversation link and reports the actionable issue without saving candidates', async () => {
    select.mockImplementationOnce(async (_candidates, options) => {
      await options.onThread?.({ id: 'shared', url: 'codex://threads/shared' });
      throw new CodexReadingError('busy', 'another writer');
    });
    const result = await collect([inputItem('z1')]);
    expect(result).toMatchObject({ status: 'failed', issue: 'codex_busy', threadId: 'shared', conversationUrl: 'codex://threads/shared' });
    expect(result.result).toBeUndefined(); expect(store.reading().items).toHaveLength(0);
    expect(readFileSync(file, 'utf8')).not.toContain('Python');
  });
  it('starts once and keeps browser claim credentials out of public state and saved summaries', () => {
    expect(service.state()).toEqual({ bridge: { connected: false }, run: null, history: [] });
    const first = service.start({}); expect(service.start({})).toEqual(first);
    expect(service.poll({}).job).toEqual({ id: first.id, from: coverage().from, to: coverage().to });
    const claimed = service.claim(first.id, {}); service.progress(first.id, { token: claimed.token, scanned: 21 });
    expect(service.state()).toMatchObject({ bridge: { connected: true }, run: { status: 'reading', scanned: 21 } });
    service.progress(first.id, { token: claimed.token, scanned: 2 }); expect(service.state().run?.scanned).toBe(21);
    expect(service.poll({}).job).toBeNull(); expect(JSON.stringify(service.state())).not.toContain(claimed.token);
    expect(readFileSync(file, 'utf8')).not.toContain(claimed.token); expect(() => service.claim(first.id, {})).toThrow('已被领取');
  });

  it('submits browser evidence immediately, then saves Codex selections with final categories and no review queue', async () => {
    const pending = deferredSelection(); const run = ready();
    const immediate = service.submit(run.id, { token: run.token, items: [inputItem('z1'), inputItem('z2', { title: '值得看看' }), inputItem('z3', { title: '搞笑片段' })], coverage: coverage() });
    expect(immediate).toMatchObject({ status: 'importing', scanned: 3, coverage: { complete: true } });
    expect(immediate.result).toBeUndefined(); expect(store.reading().items).toHaveLength(0);
    expect(() => service.submit(run.id, { token: run.token, items: [], coverage: coverage() })).toThrow('已结束或取消');
    pending.resolve({ selected: [{ index: 0, category: 'technology' }] }); await service.whenIdle();
    expect(service.state().run).toMatchObject({ status: 'completed', scanned: 3, result: { added: 1, skipped: 2 } });
    expect(store.reading().items).toHaveLength(1);
    expect(store.reading().items[0]).toMatchObject({ url: url('z1'), category: 'technology', classification: { status: 'ready', model: 'Codex' } });
    expect(store.readingImports().items).toEqual([]);
    const saved = readFileSync(file, 'utf8'); expect(saved).not.toContain('Python'); expect(saved).not.toContain('bilibili.com');
    expect(saved).not.toContain('review'); expect(service.state().run!.result!.itemIds).toEqual([store.reading().items[0].id]);
  });

  it('passes only known progress below 25% to Codex, using the latest same-source observation', async () => {
    const result = await collect([
      inputItem('z1', { progress: 0 }), inputItem('z2', { title: '没有关键词但实用的内容', progress: 0.2499 }),
      inputItem('z3', { progress: null }), inputItem('z4', { progress: 0.25 }), inputItem('z5', { progress: 1 }),
      inputItem('z6', { viewedAt: new Date(now - 120000).toISOString(), progress: 0.05 }), inputItem('z6', { progress: 0.8 }),
      inputItem('z7', { viewedAt: new Date(now - 120000).toISOString(), progress: 0.05 }), inputItem('z7', { progress: null }),
      inputItem('z8', { progress: 0.1 }), inputItem('z8', { progress: 0.8 }),
      inputItem('z9', { progress: 0.1 }), inputItem('z9', { progress: null }),
      inputItem('a1', { progress: 0.9, viewedAt: new Date(now - 120000).toISOString() }), inputItem('a1', { progress: 0.1 }),
    ]);
    expect(select.mock.calls[0][0].map(item => item.url)).toEqual([url('z1'), url('z2'), url('a1')]);
    expect(result).toMatchObject({ status: 'completed', result: { added: 3, skipped: 12 } });
  });

  it('preserves existing completion, notes, manual categories and removal suppression on repeated reads', async () => {
    const items = [inputItem('z1'), inputItem('z2')]; await collect(items);
    const saved = store.reading().items; store.editReading(saved[0].id, { status: 'done', notes: 'My personal note', category: 'design' }); store.deleteReading(saved[1].id);
    const baseline = structuredClone(store.reading().items); select.mockClear();
    const result = await collect(items);
    expect(result.result).toEqual({ added: 0, skipped: 2, itemIds: [] }); expect(select).not.toHaveBeenCalled();
    expect(store.reading().items).toEqual(baseline); expect(store.readingImports().items).toHaveLength(0);
  });

  it('rechecks duplicate and removal state after Codex finishes, preserving edits made during organization', async () => {
    const pending = deferredSelection(); const run = ready(); const items = [inputItem('z1'), inputItem('z2')];
    service.submit(run.id, { token: run.token, items, coverage: coverage() });
    const added = store.importCuratedReading({ items: items.map(item => ({ ...item, category: 'design' })), coverage: coverage() }).items;
    store.editReading(added[0].id, { notes: 'Edited while Codex worked', status: 'done' }); store.deleteReading(added[1].id);
    const baseline = store.reading().items; pending.resolve({ selected: [{ index: 0, category: 'technology' }, { index: 1, category: 'science' }] }); await service.whenIdle();
    expect(service.state().run?.result).toEqual({ added: 0, skipped: 2, itemIds: [] }); expect(store.reading().items).toEqual(baseline);
  });

  it('cancels an asynchronous Codex selection and ignores its late response without changing the next run', async () => {
    const pending = deferredSelection(); const run = ready();
    service.submit(run.id, { token: run.token, items: [inputItem('z1')], coverage: coverage() });
    const signal = select.mock.calls[0][1].signal!; expect(signal.aborted).toBe(false);
    expect(service.cancel(run.id, {}).status).toBe('cancelled'); expect(signal.aborted).toBe(true);
    const next = service.start({}); pending.resolve({ selected: [{ index: 0, category: 'programming_ai' }] }); await service.whenIdle();
    expect(service.state().run).toMatchObject({ id: next.id, status: 'queued' }); expect(store.reading().items).toHaveLength(0);
    expect(() => service.progress(next.id, { token: run.token, scanned: 1 })).toThrow('已结束或取消');
  });

  it('saves the separate conversation link but ignores late thread callbacks after cancellation', async () => {
    const pending = deferredSelection(); const run = ready(); service.submit(run.id, { token: run.token, items: [inputItem('z1')], coverage: coverage() });
    await select.mock.calls[0][1].onThread!({ id: 'separate-thread', url: 'codex://threads/separate-thread' });
    expect(service.state().run).toMatchObject({ threadId: 'separate-thread', conversationUrl: 'codex://threads/separate-thread' });
    service.cancel(run.id, {}); const next = service.start({});
    await select.mock.calls[0][1].onThread!({ id: 'late-thread', url: 'codex://threads/late-thread' });
    pending.resolve({ selected: [] }); await service.whenIdle();
    expect(service.state().run).toMatchObject({ id: next.id }); expect(service.state().run?.threadId).toBeUndefined();
    expect(service.history().items[1].threadId).toBe('separate-thread');
  });

  it.each([
    { selected: [{ index: 0, category: 'design' }, { index: 0, category: 'life' }] },
    { selected: [{ index: 2, category: 'design' }] },
    { selected: [{ index: -1, category: 'design' }] },
    { selected: [{ index: 0.5, category: 'design' }] },
    { selected: [{ index: 0, category: 'unknown' }] },
    { selected: [{ index: 0, category: 'design' }, null] },
    { selected: 'not-an-array' },
  ])('atomically rejects malformed model selections without saving any content: %j', async response => {
    select.mockResolvedValueOnce(response as any); const result = await collect([inputItem('z1'), inputItem('z2')]);
    expect(result).toMatchObject({ status: 'failed', issue: 'codex_failed' }); expect(result.result).toBeUndefined();
    expect(store.reading().items).toHaveLength(0); expect(store.readingImports().items).toHaveLength(0);
  });

  it('keeps only the five latest summaries and deleting any finished summary preserves all shelf items', async () => {
    const ids: string[] = [];
    for (let i = 1; i <= 7; i++) { const result = await collect([inputItem('z' + i)]); ids.push(result.id); now += 1000; }
    expect(service.history().items.map(run => run.id)).toEqual(ids.slice(2).reverse());
    expect(JSON.parse(readFileSync(file, 'utf8')).runs).toHaveLength(5); expect(service.state().history).toHaveLength(5);
    const baseline = store.reading().items; expect(() => service.clear(ids[4], {})).toThrow('请确认');
    expect(service.clear(ids[4], { confirm: true })).toEqual({ clearedId: ids[4] });
    expect(service.history().items).toHaveLength(4); expect(store.reading().items).toEqual(baseline);
    expect(() => service.clear(ids[0], { confirm: true })).toThrow('不存在');
  });

  it('clears legacy v1 run history on migration while retaining the shelf and never carrying old review counts forward', async () => {
    store.importCuratedReading({ items: [{ ...inputItem('z1'), category: 'design' }], coverage: coverage() }); const baseline = store.reading().items;
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify({ version: 1, run: { id: 'old-run', status: 'completed', result: { added: 1, review: 6, batchId: 'old-batch' } } }));
    const migrated = new ReadingCollectionService(file, store, { now: () => now, selector: { select } });
    expect(migrated.history().items).toEqual([]); expect(migrated.state().run).toBeNull(); expect(store.reading().items).toEqual(baseline);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 2, runs: [] }); expect(readFileSync(file, 'utf8')).not.toContain('old-batch');
  });

  it('rejects overrides, other sites, missing coverage and oversized batches before invoking Codex', () => {
    const run = ready(); const payload = { token: run.token, items: [inputItem('z1')], coverage: coverage() };
    expect(() => service.submit(run.id, { ...payload, acceptedUrls: [url('z1')] })).toThrow('无效字段');
    expect(() => service.submit(run.id, { ...payload, items: [inputItem('z1', { url: 'https://example.org/tutorial' })] })).toThrow('只接收 B 站');
    expect(() => service.submit(run.id, { token: run.token, items: [] })).toThrow('实际读取');
    expect(() => service.submit(run.id, { ...payload, items: Array.from({ length: 1001 }, () => inputItem('z1')) })).toThrow('最多 1000');
    expect(() => service.submit(run.id, { ...payload, issue: 'page_unavailable' })).toThrow('不能标记为完整');
    expect(() => service.submit(run.id, { ...payload, scanned: 0 })).toThrow('数量无效');
    expect(() => service.progress(run.id, { token: '字'.repeat(64), scanned: 1 })).toThrow('凭据已失效');
    expect(store.reading().items).toHaveLength(0); expect(select).not.toHaveBeenCalled(); expect(service.state().run?.status).toBe('reading');
  });

  it('reports partial coverage and login failures honestly, and clearing summaries preserves saved content', async () => {
    const first = ready(); service.submit(first.id, { token: first.token, items: [inputItem('z1')], coverage: coverage(false), issue: 'page_unavailable', scanned: 2 }); await service.whenIdle();
    expect(service.state().run).toMatchObject({ status: 'partial', issue: 'page_unavailable', coverage: { complete: false }, result: { added: 1, skipped: 1 } });
    service.clear(first.id, { confirm: true }); expect(service.state().run).toBeNull(); expect(store.reading().items).toHaveLength(1);
    const second = ready(); expect(service.fail(second.id, { token: second.token, issue: 'needs_login' }).status).toBe('needs_login');
    expect(store.reading().items).toHaveLength(1); expect(store.readingImports().items).toHaveLength(0);
  });

  it('binds complete and partial coverage to the clicked window and rejects records outside it', async () => {
    const run = ready(); const payload = { token: run.token, items: [inputItem('z1')], coverage: coverage() };
    for (const altered of [
      { ...coverage(), to: new Date(now + 1000).toISOString() },
      { ...coverage(), from: new Date(now - 8 * 86400000).toISOString() },
      { ...coverage(), from: new Date(now - 86400000).toISOString() },
    ]) expect(() => service.submit(run.id, { ...payload, coverage: altered })).toThrow('读取窗口一致');
    expect(() => service.submit(run.id, { ...payload, items: [inputItem('z1', { viewedAt: new Date(now - 8 * 86400000).toISOString() })] })).toThrow('覆盖范围内');
    expect(() => service.submit(run.id, { ...payload, items: [inputItem('z1', { viewedAt: new Date(now + 1000).toISOString() })] })).toThrow('覆盖范围内');
    expect(() => service.submit(run.id, { ...payload, coverage: { ...coverage(false), from: new Date(now - 30000).toISOString() } })).toThrow('覆盖范围内');
    service.submit(run.id, { ...payload, coverage: { ...coverage(false), from: new Date(now - 86400000).toISOString() } }); await service.whenIdle();
    expect(service.state().run?.status).toBe('partial');
  });

  it('expires lost browser leases, stale queued jobs and interrupts persisted active runs after restart', () => {
    const first = ready(); now += 120001;
    expect(service.state()).toMatchObject({ bridge: { connected: false }, run: { status: 'failed', issue: 'bridge_disconnected' } });
    expect(() => service.progress(first.id, { token: first.token, scanned: 0 })).toThrow('已结束');
    service.poll({}); service.start({}); now += 120001; expect(service.poll({}).job).toBeNull();
    expect(service.state().run).toMatchObject({ status: 'failed', issue: 'bridge_disconnected' });
    service.start({}); now += 30 * 60000; expect(service.state().run).toMatchObject({ status: 'failed', issue: 'timeout' });
    ready(); const restarted = new ReadingCollectionService(file, store, { now: () => now });
    expect(restarted.state()).toMatchObject({ bridge: { connected: false }, run: { status: 'failed', issue: 'server_restarted' } });
  });

  it('stops a timed-out or closed organization and rejects late successful selections without writing', async () => {
    for (const method of ['timeout', 'close']) {
      const pending = deferredSelection(); const run = ready(); service.submit(run.id, { token: run.token, items: [inputItem('z1')], coverage: coverage() });
      const signal = select.mock.calls.at(-1)![1].signal!;
      if (method === 'timeout') { now += 30 * 60000; service.state(); } else service.close();
      expect(signal.aborted).toBe(true); pending.resolve({ selected: [{ index: 0, category: 'design' }] }); await service.whenIdle();
      expect(service.state().run).toMatchObject({ status: 'failed', issue: method === 'timeout' ? 'timeout' : 'server_restarted' }); expect(store.reading().items).toHaveLength(0);
    }
  });

  it('distinguishes Codex failure from save failure without leaking internal errors or claiming success', async () => {
    select.mockRejectedValueOnce(new Error('private login detail')); const first = await collect([inputItem('z1')]);
    expect(first).toMatchObject({ status: 'failed', issue: 'codex_failed' }); expect(store.reading().items).toHaveLength(0);
    service = new ReadingCollectionService(file, { curatedReadingCandidates: store.curatedReadingCandidates.bind(store), importCuratedReading: () => { throw new Error('private filesystem detail'); } }, { now: () => now, selector: { select } });
    const second = await collect([inputItem('z1')]); expect(second).toMatchObject({ status: 'failed', issue: 'import_failed' });
    expect(second.result).toBeUndefined(); expect(store.reading().items).toHaveLength(0); expect(readFileSync(file, 'utf8')).not.toContain('private');
  });
});

describe('daily admission and offline catch-up', () => {
  it('does nothing before New York 10:00, waits for a real bridge and admits only one attempt', () => {
    now = Date.parse('2026-10-03T13:59:59Z');
    expect(service.daily({})).toMatchObject({ date: '2026-10-03', outcome: 'before_time', run: null });
    now = Date.parse('2026-10-03T21:00:00Z');
    expect(service.daily({})).toMatchObject({ outcome: 'waiting_browser', run: null });
    expect(service.history().items).toHaveLength(0);
    service.poll({}); const started = service.daily({});
    expect(started).toMatchObject({ outcome: 'started', run: { status: 'queued' } });
    expect(service.daily({})).toMatchObject({ outcome: 'already_started', run: { id: started.run!.id } });
    expect(service.history().items).toHaveLength(1);
  });
  it('survives service restart, cancellation and summary removal without another automatic attempt', () => {
    now = Date.parse('2026-10-03T14:00:00Z'); service.poll({});
    const first = service.daily({}).run!; service.cancel(first.id, {}); service.clear(first.id, { confirm: true });
    service = new ReadingCollectionService(file, store, { now: () => now, selector: { select } });
    service.poll({}); expect(service.daily({})).toMatchObject({ outcome: 'already_started', run: null });
    expect(service.history().items).toHaveLength(0);
    now = Date.parse('2026-10-04T13:59:59Z'); expect(service.daily({}).outcome).toBe('before_time');
    now += 1000; service.poll({}); expect(service.daily({}).outcome).toBe('started');
    expect(readFileSync(file, 'utf8')).not.toContain('Python');
  });
  it('manual reads after 10:00 satisfy the day, while the manual button can still retry', () => {
    now = Date.parse('2026-10-03T14:01:00Z');
    const first = service.start({}); service.cancel(first.id, {});
    expect(service.daily({})).toMatchObject({ outcome: 'already_started', run: { id: first.id, status: 'cancelled' } });
    const retry = service.start({}); expect(retry.id).not.toBe(first.id);
    expect(service.daily({}).outcome).toBe('already_started');
  });
  it('catches the latest missed day before the following 10:00, without replaying every missed date', () => {
    now = Date.parse('2026-10-05T12:00:00Z'); service.poll({});
    const result = service.daily({ catchUp: true });
    expect(result).toMatchObject({ date: '2026-10-04', outcome: 'started' });
    expect(service.daily({ catchUp: true }).outcome).toBe('already_started');
    expect(service.daily({}).outcome).toBe('before_time');
    expect(service.history().items).toHaveLength(1);
    now = Date.parse('2026-10-05T14:00:00Z'); service.cancel(result.run!.id, {}); service.poll({});
    expect(service.daily({})).toMatchObject({ date: '2026-10-05', outcome: 'started' });
  });
  it('respects winter 10:00 and the New York date boundary', () => {
    now = Date.parse('2026-01-03T14:59:59Z'); expect(service.daily({}).outcome).toBe('before_time');
    now += 1000; service.poll({}); const first = service.daily({}); expect(first.outcome).toBe('started');
    service.cancel(first.run!.id, {});
    now = Date.parse('2026-01-04T03:00:00Z'); expect(service.daily({})).toMatchObject({ date: '2026-01-03', outcome: 'already_started' });
  });
  it('follows an active pre-10:00 manual read, then permits the day’s later collection', async () => {
    now = Date.parse('2026-10-03T13:59:00Z'); const active = ready();
    now += 60000;
    expect(service.daily({})).toMatchObject({ outcome: 'active', run: { id: active.id } });
    service.fail(active.id, { token: active.token, issue: 'needs_login' });
    expect(service.dailyState().outcome).toBe('due');
    expect(service.daily({}).outcome).toBe('started');
    expect(service.daily({}).outcome).toBe('already_started');
  });
  it('adopts a verified legacy summary and rejects caller-controlled dates or invalid saved admission', () => {
    now = Date.parse('2026-10-03T14:01:00Z'); const first = service.start({}); service.cancel(first.id, {});
    const saved = JSON.parse(readFileSync(file, 'utf8')); delete saved.dailyAttempt; writeFileSync(file, JSON.stringify(saved));
    service = new ReadingCollectionService(file, store, { now: () => now });
    expect(service.daily({})).toMatchObject({ outcome: 'already_started', run: { id: first.id } });
    expect(JSON.parse(readFileSync(file, 'utf8')).dailyAttempt).toEqual({ date: '2026-10-03', runId: first.id });
    expect(() => service.daily({ date: '2000-01-01' })).toThrow('无效字段');
    saved.dailyAttempt = { date: 'bad', runId: first.id }; writeFileSync(file, JSON.stringify(saved));
    expect(() => new ReadingCollectionService(file, store)).toThrow('Daily collection status is invalid');
  });
});

it('keeps only the safe Codex failure code and reason in the recent summary', async () => {
  select.mockRejectedValueOnce(new CodexReadingError('failed', 'private upstream context', 'usage_limit'));
  const result = await collect([inputItem('z1')]);
  expect(result).toMatchObject({ status: 'failed', issue: 'codex_failed', failure: { code: 'failed', reason: 'usage_limit' } });
  expect(result.result).toBeUndefined(); expect(store.reading().items).toHaveLength(0);
  const persisted = readFileSync(file, 'utf8'); expect(persisted).toContain('usage_limit'); expect(persisted).not.toContain('private');
});

describe('bridge origin and API isolation', () => {
  const headers = { Origin: `chrome-extension://${READING_EXTENSION_ID}`, 'X-DailyHouse-Extension': READING_EXTENSION_ID, 'Content-Type': 'application/json' };
  async function listen() {
    server = createPersonalApp(store, undefined, 3456, undefined, { collection: service }).listen(0, '127.0.0.1'); await once(server, 'listening');
    return `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  }
  it('requires both exact extension Origin and header, while keeping personal routes inaccessible to the extension', async () => {
    const base = await listen();
    for (const other of [
      { 'Content-Type': 'application/json' }, { ...headers, Origin: 'https://www.bilibili.com' },
      { ...headers, Origin: `chrome-extension://${'a'.repeat(32)}` }, { ...headers, 'X-DailyHouse-Extension': 'other' },
      { ...headers, Origin: '' },
    ]) expect((await fetch(`${base}/reading-bridge/poll`, { method: 'POST', headers: other, body: '{}' })).status, JSON.stringify(other)).toBe(403);
    // Node fetch normalizes Host, so use the HTTP client for the DNS-rebinding case.
    const foreignHost = await new Promise<number>(resolve => {
      const req = request(`${base}/reading-bridge/poll`, { method: 'POST', headers: { ...headers, Host: 'foreign.example' } }, response => { response.resume(); response.once('end', () => resolve(response.statusCode!)); });
      req.end('{}');
    });
    expect(foreignHost).toBe(403);
    expect(service.state().bridge.connected).toBe(false);
    const poll = await fetch(`${base}/reading-bridge/poll`, { method: 'POST', headers, body: '{}' });
    expect(poll.status).toBe(200); expect(await poll.json()).toEqual({ job: null });
    expect(poll.headers.get('access-control-allow-origin')).toBe(headers.Origin);
    expect((await fetch(`${base}/personal/reading`, { headers })).status).toBe(403);
    expect((await fetch(`${base}/personal/reading/collection/setup`, { headers })).status).toBe(403);
    expect((await fetch(`${base}/personal/reading/collection/daily`, { method: 'POST', headers, body: '{}' })).status).toBe(403);
    expect((await fetch(`${base}/reading-bridge/no-such-endpoint`, { method: 'POST', headers, body: '{}' })).status).toBe(404);
  });

  it('handles preflight, rejects other request formats, and exposes cancel/delete only to the local shelf', async () => {
    const base = await listen();
    const preflight = await fetch(`${base}/reading-bridge/poll`, { method: 'OPTIONS', headers: { Origin: headers.Origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-dailyhouse-extension' } });
    expect(preflight.status).toBe(204); expect(preflight.headers.get('access-control-allow-methods')).toBe('POST,OPTIONS');
    expect((await fetch(`${base}/reading-bridge/poll`, { method: 'OPTIONS', headers: { Origin: 'https://foreign.example' } })).status).toBe(403);
    expect((await fetch(`${base}/reading-bridge/poll`, { headers })).status).toBe(405);
    expect((await fetch(`${base}/reading-bridge/poll`, { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415);
    expect((await fetch(`${base}/reading-bridge/poll`, { method: 'POST', headers, body: JSON.stringify({ extra: 'x'.repeat(4 * 1024 * 1024) }) })).status).toBe(413);
    const shelfHeaders = { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3456' };
    const start = await fetch(`${base}/personal/reading/collection`, { method: 'POST', headers: shelfHeaders, body: '{}' }); expect(start.status).toBe(200);
    const run = await start.json() as { id: string };
    const claim = await fetch(`${base}/reading-bridge/${run.id}/claim`, { method: 'POST', headers, body: '{}' }); expect(claim.status).toBe(200);
    expect((await fetch(`${base}/personal/reading/collection/${run.id}`, { method: 'DELETE', headers: shelfHeaders, body: '{"confirm":true}' })).status).toBe(409);
    expect((await fetch(`${base}/personal/reading/collection/${run.id}/cancel`, { method: 'POST', headers: shelfHeaders, body: '{}' })).status).toBe(200);
    expect((await fetch(`${base}/personal/reading/collection/${run.id}`, { method: 'DELETE', headers: shelfHeaders, body: '{"confirm":true}' })).status).toBe(200);
    expect((await fetch(`${base}/personal/reading/collection/setup`, { headers: shelfHeaders })).status).toBe(200);
    expect(existsSync(join(directory, 'personal.json'))).toBe(false);
  });
  it('scheduled requests use the same protected daily admission and cannot start twice', async () => {
    now = Date.parse('2026-10-03T14:01:00Z'); const base = await listen();
    const shelfHeaders = { 'Content-Type': 'application/json' };
    const daily = `${base}/personal/reading/collection/daily`;
    expect(await (await fetch(daily)).json()).toMatchObject({ outcome: 'waiting_browser' });
    service.poll({});
    const responses = await Promise.all([1, 2].map(() => fetch(daily, { method: 'POST', headers: shelfHeaders, body: '{}' }).then(response => response.json())));
    expect(responses.map(result => result.outcome).sort()).toEqual(['already_started', 'started']);
    expect(responses[0].run.id).toBe(responses[1].run.id); expect(service.history().items).toHaveLength(1);
    expect((await fetch(daily, { method: 'POST', headers: { ...shelfHeaders, Origin: 'https://foreign.example' }, body: '{}' })).status).toBe(403);
    expect((await fetch(daily, { method: 'POST', headers: shelfHeaders, body: '{"date":"2000-01-01"}' })).status).toBe(400);
  });
});
