import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { createPersonalApp } from '../src/personal/app';
import { bilibiliVideoId, COVER_CACHE_MS, fetchBilibiliCover, validCoverUrl } from '../src/personal/covers';
import { PersonalStore } from '../src/personal/store';
import type { ReadingItem } from '../src/personal/types';

const bvid = 'BV1LitP6GEm5';
const videoUrl = `https://www.bilibili.com/video/${bvid}/?p=2`;
const coverUrl = 'https://i0.hdslb.com/bfs/archive/test-cover.jpg';
const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const metadata = (pic = coverUrl) => jsonResponse({ code: 0, data: { bvid, pic } });
let root: string;
let file: string;
let server: Server | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'garden-covers-'));
  file = join(root, 'personal.json');
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (server) {
    const closing = new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closing;
    server = undefined;
  }
  rmSync(root, { recursive: true, force: true });
});
const makeStore = (request: typeof fetch) => new PersonalStore(file, undefined, join(root, 'reports'), request);
const addVideo = (store: PersonalStore) => store.addReading({ title: 'Video tutorial', type: 'video', url: videoUrl, notes: 'Keep my notes' });

describe('reading video covers', () => {
  it('reads only the fixed public metadata endpoint and normalizes a validated CDN cover to HTTPS', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(metadata(coverUrl.replace('https:', 'http:')));
    expect(await fetchBilibiliCover(bvid, request)).toBe(coverUrl);
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
    expect(options).toMatchObject({ redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json' } });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not resolve arbitrary hosts, shortened links, invalid IDs or unsupported item types', async () => {
    const request = vi.fn<typeof fetch>();
    const store = makeStore(request);
    for (const url of ['https://bilibili.com.evil.example/video/BV1LitP6GEm5', 'http://localhost/video/BV1LitP6GEm5', 'https://b23.tv/example', 'https://www.bilibili.com/video/invalid', 'https://www.bilibili.com:444/video/BV1LitP6GEm5']) {
      const item = store.addReading({ title: 'No public Bili metadata', type: 'video', url });
      expect(await store.readingCover(item.id)).toEqual(item);
      expect(bilibiliVideoId(item)).toBeUndefined();
    }
    const book = store.addReading({ title: 'Book', type: 'book', url: videoUrl });
    expect(await store.readingCover(book.id)).toEqual(book);
    expect(await fetchBilibiliCover('bad-id', request)).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  it('aborts a stalled public metadata request after five seconds', async () => {
    vi.useFakeTimers();
    const request = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    }));
    const pending = fetchBilibiliCover(bvid, request);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBeUndefined();
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('rejects untrusted image URLs, wrong video metadata, redirects and oversized responses', async () => {
    for (const pic of ['https://i0.hdslb.com.evil.example/test.jpg', 'https://localhost/test.jpg', 'https://user:password@i0.hdslb.com/test.jpg', 'https://i0.hdslb.com:444/test.jpg', 'data:image/png,test', 'https://i0.hdslb.com/\ntest.jpg']) {
      expect(validCoverUrl(pic)).toBeUndefined();
      expect(await fetchBilibiliCover(bvid, vi.fn<typeof fetch>().mockResolvedValue(metadata(pic)))).toBeUndefined();
    }
    const invalid = [
      jsonResponse({ code: -404 }), jsonResponse({ code: 0, data: { bvid: 'BV1a6Yx62EH4', pic: coverUrl } }),
      new Response('', { status: 302, headers: { Location: 'http://localhost/private' } }),
      new Response('x'.repeat(512 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }),
      new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': String(512 * 1024 + 1) } }),
    ];
    for (const response of invalid) expect(await fetchBilibiliCover(bvid, vi.fn<typeof fetch>().mockResolvedValue(response))).toBeUndefined();
  });

  it('persists a cached cover across restarts without changing progress, notes or modification time', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => metadata());
    const store = makeStore(request);
    const original = addVideo(store);
    const updated = await store.readingCover(original.id);
    expect(updated).toMatchObject({ ...original, coverUrl });
    expect(updated.coverCheckedAt).toEqual(expect.any(String));
    expect(await makeStore(request).readingCover(original.id)).toEqual(updated);
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(file, 'utf8')).readingItems[0].coverUrl).toBe(coverUrl);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(updated.coverCheckedAt!) + COVER_CACHE_MS + 1);
    await store.readingCover(original.id);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('caches an unavailable cover to avoid repeated failures and keeps an existing cover on a transient failure', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('Bilibili unavailable'));
    const store = makeStore(request);
    const original = addVideo(store);
    const result = await store.readingCover(original.id);
    expect(result.coverUrl).toBeUndefined();
    expect(result.coverCheckedAt).toEqual(expect.any(String));
    expect(result.status).toBe('unread');
    expect(await makeStore(request).readingCover(original.id)).toEqual(result);
    expect(request).toHaveBeenCalledTimes(1);
    const patched = store.editReading(original.id, { coverUrl });
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(patched.coverCheckedAt!) + COVER_CACHE_MS + 1);
    expect((await store.readingCover(original.id)).coverUrl).toBe(coverUrl);
  });

  it('deduplicates in-flight lookups and merges metadata into the latest manual status and notes', async () => {
    let complete!: (response: Response) => void;
    const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const store = makeStore(request);
    const original = addVideo(store);
    const first = store.readingCover(original.id);
    const second = store.readingCover(original.id);
    const edited = store.editReading(original.id, { notes: 'I finished this', status: 'done' });
    complete(metadata());
    const results = await Promise.all([first, second]);
    expect(request).toHaveBeenCalledTimes(1);
    for (const item of results) expect(item).toMatchObject({ ...edited, coverUrl });
    expect(makeStore(request).reading().items[0]).toMatchObject({ ...edited, coverUrl });
  });

  it('never resurrects an item removed during a lookup', async () => {
    let complete!: (response: Response) => void;
    const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const store = makeStore(request);
    const original = addVideo(store);
    const pending = store.readingCover(original.id);
    store.removeReading({ all: true });
    complete(metadata());
    await expect(pending).rejects.toMatchObject({ status: 404 });
    expect(makeStore(request).reading().items).toEqual([]);
  });

  it('ignores delayed results after a URL, type or manually supplied cover changes', async () => {
    for (const edit of [{ url: 'https://www.bilibili.com/video/BV1a6Yx62EH4/' }, { type: 'book' }, { coverUrl: 'https://i1.hdslb.com/bfs/archive/manual.jpg' }]) {
      let complete!: (response: Response) => void;
      const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { complete = resolve; }));
      const store = makeStore(request);
      const original = addVideo(store);
      const pending = store.readingCover(original.id);
      const edited = store.editReading(original.id, edit);
      complete(metadata());
      expect(await pending).toEqual(edited);
    }
  });

  it('accepts validated imported covers, clears stale covers when a URL/type changes, and permits explicit removal', () => {
    const store = makeStore(vi.fn<typeof fetch>());
    const added = store.addReading({ title: 'Imported course', type: 'course', url: videoUrl, coverUrl });
    expect(added).toMatchObject({ coverUrl, coverCheckedAt: expect.any(String) });
    const cleared = store.editReading(added.id, { coverUrl: '' });
    expect(cleared.coverUrl).toBeUndefined();
    expect(cleared.updatedAt).toBe(added.updatedAt);
    store.editReading(added.id, { coverUrl });
    const moved = store.editReading(added.id, { type: 'article' });
    expect(moved.coverUrl).toBeUndefined();
    expect(moved.coverCheckedAt).toBeUndefined();
    expect(() => store.editReading(added.id, { coverUrl })).toThrow('封面');
    expect(() => store.editReading(added.id, { coverCheckedAt: '2026-01-01' })).toThrow();
    expect(() => store.addReading({ title: 'Bad cover', type: 'video', url: videoUrl, coverUrl: 'https://evil.example/test.jpg' })).toThrow('封面');
  });

  it('serves cover metadata and validated imports through the local API', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(metadata());
    const store = makeStore(request);
    const original = addVideo(store);
    server = createPersonalApp(store).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    const url = `http://127.0.0.1:${address.port}/api/personal/reading/${encodeURIComponent(original.id)}`;
    const headers = { 'Content-Type': 'application/json', 'Accept-Language': 'en' };
    const response = await fetch(`${url}/cover`, { method: 'POST', headers, body: '{}' });
    expect(response.status).toBe(200);
    expect(await response.json() as ReadingItem).toMatchObject({ ...original, coverUrl });
    const invalid = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ coverUrl: 'http://localhost/private' }) });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ message: 'Use an HTTPS Bilibili image URL for a supported Bilibili video.' });
    store.deleteReading(original.id);
    expect((await fetch(`${url}/cover`, { method: 'POST', headers, body: '{}' })).status).toBe(404);
  });
});
