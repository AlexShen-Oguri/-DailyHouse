import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { usePreferences } from './Preferences';
import type { ReadingItem } from './reading-model';

// Only visible cards request metadata, one at a time. A large import must not
// launch a burst of external requests when the shelf is opened.
let coverQueue: Promise<unknown> = Promise.resolve();
function canFetchCover(item: ReadingItem) {
  if (item.origin !== 'manual' || !['video', 'course', 'tutorial'].includes(item.type) || item.coverUrl) return false;
  if (item.coverCheckedAt && Date.now() - Date.parse(item.coverCheckedAt) < 86400000) return false;
  try {
    const url = new URL(item.url);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['bilibili.com', 'www.bilibili.com', 'm.bilibili.com'].includes(url.hostname)
      && /^\/video\/BV[0-9A-Za-z]{10}\/?$/.test(url.pathname);
  } catch { return false; }
}

export default function VideoCover({ item, onCover }: { item: ReadingItem; onCover: (item: ReadingItem) => void }) {
  const { t } = usePreferences();
  const probe = useRef<HTMLDivElement>(null);
  const [failedUrl, setFailedUrl] = useState('');
  const attempted = useRef('');
  const { id, url, type, origin, coverUrl, coverCheckedAt } = item;
  useEffect(() => {
    const identity = `${id}:${url}:${type}`;
    if (!canFetchCover({ ...item, id, url, type, origin, coverUrl, coverCheckedAt }) || attempted.current === identity || !probe.current || !window.IntersectionObserver) return;
    let cancelled = false;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect(); attempted.current = identity;
      coverQueue = coverQueue.catch(() => undefined).then(async () => {
        if (cancelled) { attempted.current = ''; return; }
        try {
          const saved = await request<ReadingItem>(`/reading/${encodeURIComponent(id)}/cover`, 'POST', {});
          if (!cancelled) onCover(saved);
        } catch { /* Missing covers never block reading or change the item. */ }
      });
    }, { rootMargin: '160px' });
    observer.observe(probe.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [id, url, type, origin, coverUrl, coverCheckedAt, onCover]);
  const visible = !!coverUrl && failedUrl !== coverUrl && ['video', 'course', 'tutorial'].includes(type);
  return <div ref={probe} className={visible ? 'reading-video-cover' : 'reading-cover-probe'} aria-hidden={!visible || undefined}>
    {visible && <img src={coverUrl} alt={t(`视频封面：${item.title}`, `Video cover: ${item.title}`)} width={320} height={180} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(coverUrl)}/>}
  </div>;
}
