// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoCover from './VideoCover';
import type { ReadingItem } from './reading-model';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./api', () => ({ request: mocks.request }));

const video = (id: string, overrides: Partial<ReadingItem> = {}): ReadingItem => ({
  id, title: `Video ${id}`, type: 'video', url: 'https://www.bilibili.com/video/BV1a6Yx62EH4/',
  notes: '', status: 'unread', origin: 'manual', addedAt: '2026-09-26T10:00:00Z', updatedAt: '2026-09-26T10:00:00Z', ...overrides,
});
type Observer = { callback: IntersectionObserverCallback; options?: IntersectionObserverInit; disconnect: ReturnType<typeof vi.fn>; observe: ReturnType<typeof vi.fn> };
let observers: Observer[];
let host: HTMLDivElement;
let root: Root;
const onCover = vi.fn();
async function intersect(index: number, isIntersecting = true) {
  await act(async () => { observers[index].callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver); });
}
async function render(items: ReadingItem[]) {
  await act(async () => { root.render(<>{items.map(item => <VideoCover key={item.id} item={item} onCover={onCover}/>)}</>); });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  observers = []; mocks.request.mockReset(); onCover.mockReset();
  vi.stubGlobal('IntersectionObserver', class {
    disconnect = vi.fn(); observe = vi.fn();
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { observers.push({ callback, options, disconnect: this.disconnect, observe: this.observe }); }
  });
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); vi.unstubAllGlobals(); });

describe('video cover display and metadata queue', () => {
  it('renders a known cover lazily without sending a referrer, and removes broken images without removing the card', async () => {
    await render([video('one', { coverUrl: 'https://i0.hdslb.com/bfs/archive/cover.jpg' })]);
    const image = host.querySelector('img')!;
    expect(image.getAttribute('src')).toBe('https://i0.hdslb.com/bfs/archive/cover.jpg');
    expect(image.getAttribute('alt')).toBe('视频封面：Video one');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('decoding')).toBe('async');
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect([image.width, image.height]).toEqual([320, 180]);
    expect(observers).toHaveLength(0);
    expect(mocks.request).not.toHaveBeenCalled();
    await act(async () => { image.dispatchEvent(new Event('error')); });
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.reading-cover-probe')?.getAttribute('aria-hidden')).toBe('true');
    await render([video('one', { coverUrl: 'https://i0.hdslb.com/bfs/archive/replacement.jpg' })]);
    expect(host.querySelector('img')?.getAttribute('src')).toContain('replacement.jpg');
  });

  it('waits until a card is near the viewport and resolves one metadata request at a time', async () => {
    let finishFirst!: (item: ReadingItem) => void;
    const first = video('first'); const second = video('second');
    mocks.request.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; })).mockResolvedValueOnce({ ...second, coverUrl: 'https://i0.hdslb.com/bfs/archive/second.jpg' });
    await render([first, second]);
    expect(observers.map(observer => observer.options?.rootMargin)).toEqual(['160px', '160px']);
    expect(mocks.request).not.toHaveBeenCalled();
    await intersect(0, false);
    expect(mocks.request).not.toHaveBeenCalled();
    await intersect(0);
    await intersect(1);
    expect(mocks.request.mock.calls).toEqual([['/reading/first/cover', 'POST', {}]]);
    expect(observers.every(observer => observer.disconnect.mock.calls.length > 0)).toBe(true);
    await act(async () => { finishFirst({ ...first, coverUrl: 'https://i0.hdslb.com/bfs/archive/first.jpg' }); });
    expect(mocks.request.mock.calls).toEqual([['/reading/first/cover', 'POST', {}], ['/reading/second/cover', 'POST', {}]]);
    expect(onCover.mock.calls.map(([saved]) => saved.id)).toEqual(['first', 'second']);
  });

  it('skips a queued card removed before its request starts and ignores an in-flight response after unmount', async () => {
    let finishFirst!: (item: ReadingItem) => void;
    mocks.request.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
    await render([video('first'), video('second')]);
    await intersect(0); await intersect(1);
    await render([]);
    await act(async () => { finishFirst(video('first', { coverUrl: 'https://i0.hdslb.com/bfs/archive/first.jpg' })); });
    expect(mocks.request.mock.calls).toEqual([['/reading/first/cover', 'POST', {}]]);
    expect(onCover).not.toHaveBeenCalled();
  });

  it('does not request unsupported links, non-video items, report sources or recently checked covers', async () => {
    await render([
      video('external', { url: 'https://example.com/tutorial' }),
      video('lookalike', { url: 'https://www.bilibili.com.example.com/video/BV1a6Yx62EH4/' }),
      video('insecure', { url: 'http://www.bilibili.com/video/BV1a6Yx62EH4/' }),
      video('credentials', { url: 'https://name:secret@www.bilibili.com/video/BV1a6Yx62EH4/' }),
      video('book', { type: 'book' }),
      video('report', { origin: 'report' }),
      video('cached-miss', { coverCheckedAt: new Date().toISOString() }),
    ]);
    expect(observers).toHaveLength(0);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('keeps the queue usable after a metadata error and permits checking an expired miss', async () => {
    const expired = video('expired', { coverCheckedAt: new Date(Date.now() - 86400001).toISOString() });
    mocks.request.mockRejectedValueOnce(new Error('Metadata unavailable')).mockResolvedValueOnce({ ...expired, coverCheckedAt: new Date().toISOString() });
    await render([video('broken'), expired]);
    await intersect(0); await intersect(1);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(onCover).toHaveBeenCalledTimes(1);
    expect(onCover.mock.calls[0][0].id).toBe('expired');
    expect(host.querySelector('img')).toBeNull();
  });
});
