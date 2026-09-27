export type ReadingType = 'book' | 'video' | 'course' | 'tutorial' | 'github' | 'article';
export type ReadingStatus = 'unread' | 'reading' | 'done';
export type ReadingCategory = 'programming' | 'ai' | 'design' | 'science' | 'humanities' | 'language' | 'career' | 'life' | 'other';
export type ReadingItem = { id: string; title: string; type: ReadingType; url: string; notes: string; status: ReadingStatus; category?: ReadingCategory; finishedAt?: string; sourceKey?: string; importBatchId?: string; addedAt: string; updatedAt: string; origin: 'manual' | 'report'; reportSource?: 'tech' | 'aesthetic'; reportDate?: string; coverageDate?: string; updatedSinceRead?: boolean; pdfUrl?: string; coverUrl?: string; coverCheckedAt?: string };
export type ReadingSource = { id: 'tech' | 'aesthetic'; label: string; path: string; status: 'ready' | 'missing' | 'error'; count: number; message: string };
export type ReadingState = { items: ReadingItem[]; sources: ReadingSource[]; scannedAt: string };
export const typeNames: Record<ReadingType, [string, string]> = { book: ['书籍', 'Book'], video: ['视频', 'Video'], course: ['网课', 'Course'], tutorial: ['教程', 'Tutorial'], github: ['GitHub 项目', 'GitHub project'], article: ['文章 / 报告', 'Article / report'] };
export const statusNames: Record<ReadingStatus, [string, string]> = { unread: ['待开始', 'To start'], reading: ['进行中', 'In progress'], done: ['已完成', 'Finished'] };
export const categoryNames: Record<ReadingCategory, [string, string]> = { programming: ['编程', 'Programming'], ai: ['AI', 'AI'], design: ['设计', 'Design'], science: ['自然科学', 'Science'], humanities: ['人文社科', 'Humanities'], language: ['语言', 'Languages'], career: ['效率 / 职业', 'Productivity / Career'], life: ['生活技能', 'Life skills'], other: ['其他 / 待分类', 'Other / Unsorted'] };
export type ShelfKind = 'all' | 'book' | 'video' | 'course' | 'github' | 'article' | 'tech' | 'aesthetic';
export const shelfKinds: { id: ShelfKind; label: [string, string] }[] = [
  { id: 'all', label: ['全部', 'All'] }, { id: 'book', label: ['书籍', 'Books'] }, { id: 'video', label: ['视频', 'Videos'] },
  { id: 'course', label: ['课程 / 教程', 'Courses / Tutorials'] }, { id: 'github', label: ['GitHub', 'GitHub'] },
  { id: 'article', label: ['文章', 'Articles'] }, { id: 'tech', label: ['科技早报', 'Tech digest'] }, { id: 'aesthetic', label: ['审美图鉴', 'Aesthetic atlas'] },
];
export function matchesKind(item: ReadingItem, kind: ShelfKind) {
  if (kind === 'all') return true;
  if (kind === 'tech' || kind === 'aesthetic') return item.origin === 'report' && item.reportSource === kind;
  return item.origin !== 'report' && (kind === 'course' ? item.type === 'course' || item.type === 'tutorial' : item.type === kind);
}
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
