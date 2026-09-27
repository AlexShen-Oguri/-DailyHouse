import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPersonalApp } from '../src/personal/app';
import { ReadingCollectionService, READING_EXTENSION_ID } from '../src/personal/reading-collection';
import { PersonalStore } from '../src/personal/store';

let directory: string, file: string, store: PersonalStore, service: ReadingCollectionService, now: number;
let server: Server | undefined;
const enqueue = vi.fn();
const url = (suffix: string) => `https://www.bilibili.com/video/BV1xx411c7${suffix}/`;
const inputItem = (suffix: string, extra: Record<string, unknown> = {}) => ({ title: 'Python 入门教程', url: url(suffix), viewedAt: new Date(now - 60000).toISOString(), progress: 0.1, ...extra });
const coverage = (complete = true) => ({ from: new Date(now - 7 * 86400000).toISOString(), to: new Date(now).toISOString(), complete });
function ready() { const run = service.start({}); const claim = service.claim(run.id, {}); return { ...run, token: claim.token }; }
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'garden-reading-collection-')); file = join(directory, 'runtime', 'collection.json');
  now = Date.now(); enqueue.mockReset();
  store = new PersonalStore(join(directory, 'personal.json'), undefined, join(directory, 'reports'));
  service = new ReadingCollectionService(file, store, { now: () => now, classification: { enqueue }, extensionPath: join(directory, 'extension') });
});
afterEach(async () => {
  if (server) { const closed = new Promise<void>(resolve => server!.close(() => resolve())); server.closeAllConnections(); await closed; server = undefined; }
  rmSync(directory, { recursive: true, force: true });
});

describe('manual history collection lifecycle', () => {
  it('starts once, offers only an unclaimed job, and keeps claim credentials outside status and disk', () => {
    expect(service.state()).toEqual({ bridge: { connected: false }, run: null });
    const first = service.start({}); expect(service.start({})).toEqual(first);
    expect(service.poll({}).job).toEqual({ id: first.id, from: coverage().from, to: coverage().to });
  });

  it('supports cancellation, rejects stale callbacks, and permits a new explicit retry', () => {
    const run = ready();
    service.progress(run.id, { token: run.token, scanned: 21 });
    expect(service.state()).toMatchObject({ bridge: { connected: true }, run: { status: 'reading', scanned: 21 } });
    expect(service.poll({}).job).toBeNull();
    expect(JSON.stringify(service.state())).not.toContain(run.token);
    expect(readFileSync(file, 'utf8')).not.toContain(run.token);
    expect(() => service.claim(run.id, {})).toThrow('已被领取');
    expect(() => service.clear(run.id, { confirm: true })).toThrow('请先取消');
    expect(service.cancel(run.id, {}).status).toBe('cancelled');
    expect(() => service.submit(run.id, { token: run.token, items: [], coverage: coverage() })).toThrow('已结束或取消');
    const next = ready(); expect(next.id).not.toBe(run.id);
    expect(() => service.progress(next.id, { token: run.token, scanned: 1 })).toThrow('凭据已失效');
    expect(() => service.progress(next.id, { token: '字'.repeat(64), scanned: 1 })).toThrow('凭据已失效');
    expect(store.readingImports().items).toHaveLength(0);
  });

  it('imports with the existing time/progress/education rules and does not reuse an older low playback position', () => {
    const run = ready();
    const result = service.submit(run.id, { token: run.token, items: [
      inputItem('z1'), inputItem('z2', { title: '值得看看', progress: 0.1 }), inputItem('z3', { progress: null }),
      inputItem('z4', { progress: 0.25 }), inputItem('z5', { title: 'Python 搞笑整活合集' }),
      inputItem('z7', { viewedAt: new Date(now - 120000).toISOString(), progress: 0.05 }), inputItem('z7', { progress: 0.8 }),
    ], coverage: coverage() });
    expect(result).toMatchObject({ status: 'completed', scanned: 7, result: { added: 1, updated: 0, review: 2, skipped: 4 } });
    expect(store.reading().items).toHaveLength(1);
    expect(store.reading().items[0]).toMatchObject({ url: url('z1'), classification: { status: 'pending' } });
    expect(enqueue).toHaveBeenCalledWith([store.reading().items[0].id]);
    const saved = readFileSync(file, 'utf8'); expect(saved).not.toContain('Python'); expect(saved).not.toContain('bilibili.com');
    expect(() => service.submit(run.id, { token: run.token, items: [], coverage: coverage() })).toThrow('已结束或取消');
  });

  it('retains completion, notes, categories and removal suppression and avoids duplicate review/no-change batches', () => {
    const items = [inputItem('z1'), inputItem('z2'), inputItem('z3', { title: '值得看看' })];
    const first = ready(); service.submit(first.id, { token: first.token, items, coverage: coverage() });
    const saved = store.reading().items;
    store.editReading(saved[0].id, { status: 'done', notes: 'My personal note', category: 'design' });
    store.deleteReading(saved[1].id);
    const second = ready();
    const result = service.submit(second.id, { token: second.token, items, coverage: coverage() });
    expect(result.result).toEqual({ added: 0, updated: 0, review: 0, skipped: 3 });
    expect(store.readingImports().items).toHaveLength(1);
    expect(store.reading().items[0]).toMatchObject({ status: 'done', notes: 'My personal note', category: 'design' });
    const third = ready();
    const changedItems = [inputItem('z3', { title: '值得再看看' })];
    expect(service.submit(third.id, { token: third.token, items: changedItems, coverage: coverage() }).result?.review).toBe(1);
    expect(store.readingImports().items).toHaveLength(2);
  });

  it('rejects overrides, other sites, missing coverage and oversized batches before importing', () => {
    const run = ready();
    const payload = { token: run.token, items: [inputItem('z1')], coverage: coverage() };
    expect(() => service.submit(run.id, { ...payload, acceptedUrls: [url('z1')] })).toThrow('无效字段');
    expect(() => service.submit(run.id, { ...payload, items: [inputItem('z1', { url: 'https://example.org/tutorial' })] })).toThrow('只接收 B 站');
    expect(() => service.submit(run.id, { token: run.token, items: [] })).toThrow('实际读取');
    expect(() => service.submit(run.id, { ...payload, items: Array.from({ length: 1001 }, () => inputItem('z1')) })).toThrow('最多 1000');
    expect(() => service.submit(run.id, { ...payload, issue: 'page_unavailable' })).toThrow('不能标记为完整');
    expect(() => service.submit(run.id, { ...payload, scanned: 0 })).toThrow('数量无效');
    expect(store.readingImports().items).toHaveLength(0);
    expect(service.state().run?.status).toBe('reading');
  });

  it('reports partial evidence and login failure honestly; clearing status preserves imported items and audit', () => {
    const first = ready();
    const result = service.submit(first.id, { token: first.token, items: [inputItem('z1')], coverage: coverage(false), issue: 'page_unavailable', scanned: 2 });
    expect(result).toMatchObject({ status: 'partial', issue: 'page_unavailable', coverage: { complete: false }, result: { added: 1 } });
    expect(() => service.clear(first.id, {})).toThrow('请确认');
    service.clear(first.id, { confirm: true });
    expect(service.state().run).toBeNull(); expect(store.reading().items).toHaveLength(1); expect(store.readingImports().items).toHaveLength(1);
    const second = ready(); expect(service.fail(second.id, { token: second.token, issue: 'needs_login' }).status).toBe('needs_login');
    expect(store.readingImports().items).toHaveLength(1);
    expect(() => service.clear(first.id, { confirm: true })).toThrow('不存在');
  });

  it('binds complete and partial coverage to the clicked time window and rejects records outside it', () => {
    const run = ready();
    const payload = { token: run.token, items: [inputItem('z1')], coverage: coverage() };
    for (const altered of [
      { ...coverage(), to: new Date(now + 1000).toISOString() },
      { ...coverage(), from: new Date(now - 8 * 86400000).toISOString() },
      { ...coverage(), from: new Date(now - 86400000).toISOString() },
    ]) expect(() => service.submit(run.id, { ...payload, coverage: altered })).toThrow('读取窗口一致');
    expect(() => service.submit(run.id, { ...payload, items: [inputItem('z1', { viewedAt: new Date(now - 8 * 86400000).toISOString() })] })).toThrow('覆盖范围内');
    expect(() => service.submit(run.id, { ...payload, items: [inputItem('z1', { viewedAt: new Date(now + 1000).toISOString() })] })).toThrow('覆盖范围内');
    expect(() => service.submit(run.id, { ...payload, coverage: { ...coverage(false), from: new Date(now - 30000).toISOString() } })).toThrow('覆盖范围内');
    expect(store.readingImports().items).toHaveLength(0);
    expect(service.submit(run.id, { ...payload, coverage: { ...coverage(false), from: new Date(now - 86400000).toISOString() } }).status).toBe('partial');
  });

  it('fails a queued run when the previously connected browser stops polling', () => {
    service.poll({}); service.start({}); now += 120001;
    expect(service.poll({}).job).toBeNull();
    expect(service.state()).toMatchObject({ bridge: { connected: true }, run: { status: 'failed', issue: 'bridge_disconnected' } });
  });

  it('expires lost browser leases, queued jobs, and interrupts runs across a server restart', () => {
    const first = ready(); now += 120001;
    expect(service.state()).toMatchObject({ bridge: { connected: false }, run: { status: 'failed', issue: 'bridge_disconnected' } });
    expect(() => service.progress(first.id, { token: first.token, scanned: 0 })).toThrow('已结束');
    service.start({}); now += 30 * 60000;
    expect(service.state().run).toMatchObject({ status: 'failed', issue: 'timeout' });
    ready();
    const restarted = new ReadingCollectionService(file, store, { now: () => now });
    expect(restarted.state()).toMatchObject({ bridge: { connected: false }, run: { status: 'failed', issue: 'server_restarted' } });
  });

  it('keeps saved content if local classification cannot queue and records the independent issue', () => {
    enqueue.mockImplementation(() => { throw new Error('private classifier detail'); });
    const run = ready();
    expect(service.submit(run.id, { token: run.token, items: [inputItem('z1')], coverage: coverage() })).toMatchObject({ status: 'completed', issue: 'classification_pending', result: { added: 1 } });
    expect(store.reading().items).toHaveLength(1);
    expect(readFileSync(file, 'utf8')).not.toContain('private');
  });

  it('records import failure without leaking errors or falsely claiming success', () => {
    service = new ReadingCollectionService(file, {
      previewReadingImport: store.previewReadingImport.bind(store), readingImports: store.readingImports.bind(store),
      importReading: () => { throw new Error('private filesystem detail'); },
    }, { now: () => now, classification: { enqueue } });
    const run = ready();
    expect(service.submit(run.id, { token: run.token, items: [inputItem('z1')], coverage: coverage() })).toMatchObject({ status: 'failed', issue: 'import_failed' });
    expect(store.reading().items).toHaveLength(0); expect(enqueue).not.toHaveBeenCalled();
    expect(readFileSync(file, 'utf8')).not.toContain('private');
  });
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
});
