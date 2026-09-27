import type { ReadingItem } from './types';
import { PersonalError } from './types';

export const COVER_CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_METADATA_BYTES = 512 * 1024;
const VIDEO_TYPES = new Set(['video', 'course', 'tutorial']);

export function bilibiliVideoId(item: Pick<ReadingItem, 'type' | 'url'>): string | undefined {
  if (!VIDEO_TYPES.has(item.type)) return;
  try {
    const url = new URL(item.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !['bilibili.com', 'www.bilibili.com', 'm.bilibili.com'].includes(url.hostname)) return;
    return /^\/video\/(BV[0-9A-Za-z]{10})\/?$/.exec(url.pathname)?.[1];
  } catch { return; }
}

export function validCoverUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com'))) return;
    return url.toString();
  } catch { return; }
}

export function readingCoverInput(value: unknown, item: Pick<ReadingItem, 'type' | 'url'>): string | undefined {
  if (value === '') return;
  const url = validCoverUrl(value);
  if (!url || !bilibiliVideoId(item)) throw new PersonalError('封面需要使用 B站视频对应的 HTTPS 图片链接');
  return url;
}

// Read public metadata only. Never request an item's arbitrary URL, reuse a
// browser session, follow a redirect, or let an unavailable cover block reading.
export async function fetchBilibiliCover(bvid: string, request: typeof fetch = fetch): Promise<string | undefined> {
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await request(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
      headers: { Accept: 'application/json' }, signal: controller.signal, redirect: 'error', credentials: 'omit',
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json') || Number(response.headers.get('content-length')) > MAX_METADATA_BYTES || !response.body) {
      await response.body?.cancel();
      return;
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_METADATA_BYTES) return;
      chunks.push(chunk.value);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || !('code' in parsed) || parsed.code !== 0 || !('data' in parsed) || !parsed.data || typeof parsed.data !== 'object') return;
    const data = parsed.data as Record<string, unknown>;
    if (data.bvid !== bvid || typeof data.pic !== 'string') return;
    return validCoverUrl(data.pic.replace(/^http:\/\//, 'https://'));
  } catch { return; }
  finally {
    clearTimeout(timeout);
    await reader?.cancel().catch(() => {});
  }
}
