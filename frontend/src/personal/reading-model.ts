export type ReadingType = 'book' | 'video' | 'course' | 'tutorial' | 'github' | 'article';
export type ReadingStatus = 'unread' | 'reading' | 'done';
export type ReadingItem = { id: string; title: string; type: ReadingType; url: string; notes: string; status: ReadingStatus; addedAt: string; updatedAt: string; origin: 'manual' | 'report'; reportSource?: 'tech' | 'aesthetic'; reportDate?: string; coverageDate?: string; updatedSinceRead?: boolean; pdfUrl?: string };
export type ReadingSource = { id: 'tech' | 'aesthetic'; label: string; path: string; status: 'ready' | 'missing' | 'error'; count: number; message: string };
export type ReadingState = { items: ReadingItem[]; sources: ReadingSource[]; scannedAt: string };
export const typeNames: Record<ReadingType, [string, string]> = { book: ['书籍', 'Book'], video: ['视频', 'Video'], course: ['网课', 'Course'], tutorial: ['教程', 'Tutorial'], github: ['GitHub 项目', 'GitHub project'], article: ['文章 / 报告', 'Article / report'] };
export const statusNames: Record<ReadingStatus, [string, string]> = { unread: ['待开始', 'To start'], reading: ['进行中', 'In progress'], done: ['已完成', 'Finished'] };
export function suggestLink(raw: string): { type: ReadingType; title: string } | null {
  try {
    const url = new URL(raw); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const parts = url.pathname.split('/').filter(Boolean);
    if (host === 'github.com' && parts.length >= 2) return { type: 'github', title: parts.slice(0, 2).join('/') };
    if (host === 'bilibili.com' || host.endsWith('.bilibili.com') || host === 'b23.tv' || host === 'youtube.com' || host === 'youtu.be') return { type: 'video', title: '' };
    if (['coursera.org', 'edx.org', 'udemy.com'].some(domain => host === domain || host.endsWith('.' + domain))) return { type: 'course', title: '' };
    return null;
  } catch { return null; }
}
