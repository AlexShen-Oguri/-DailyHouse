import { canonicalReadingSource } from './reading-import';
import { readingCategory } from './reading-categories';
import { readingNotes, readingTitle, readingType, readingUrl } from './reading';
import { PersonalError, type ReadingAttachment, type ReadingCategory, type ReadingImportCounts, type ReadingType } from './types';
import type { ReadingAttachments } from './reading-attachments';

export interface QuickReadingCandidate {
  index: number; title: string; type: ReadingType; url: string; notes: string; category: ReadingCategory;
  sourceKey: string; uploadId?: string; attachment?: ReadingAttachment; manualCategory: boolean;
  decision: 'import' | 'duplicate' | 'suppressed'; reason: string;
}

function inferType(url: string): ReadingType {
  if (!url) return 'book';
  const host = new URL(url).hostname.toLowerCase();
  if (host === 'github.com' || host === 'www.github.com') return 'github';
  if (/(^|\.)(bilibili\.com|b23\.tv|youtube\.com|youtu\.be)$/.test(host)) return 'video';
  if (/(^|\.)(coursera\.org|edx\.org|udemy\.com)$/.test(host)) return 'course';
  return 'article';
}

export function parseQuickReading(value: unknown, attachments: ReadingAttachments): QuickReadingCandidate[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PersonalError('请求内容必须是一个对象');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => key !== 'items') || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) throw new PersonalError('一次请选择 1–30 项内容导入');
  return body.items.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PersonalError('导入条目无效');
    const row = raw as Record<string, unknown>;
    if (Object.keys(row).some(key => !['url', 'uploadId', 'title', 'type', 'category', 'notes'].includes(key))) throw new PersonalError('导入条目包含不支持的字段');
    const url = readingUrl(row.url);
    if (row.uploadId !== undefined && (typeof row.uploadId !== 'string' || url)) throw new PersonalError('每项请选择链接或本机文件其中一种来源');
    const upload = typeof row.uploadId === 'string' ? attachments.get(row.uploadId) : undefined;
    const type = row.type === undefined ? upload?.type || inferType(url) : readingType(row.type);
    const fallback = upload?.title || (url ? new URL(url).pathname.split('/').filter(Boolean).pop() || new URL(url).hostname : '');
    const title = readingTitle(row.title || fallback);
    if (!url && !upload && type !== 'book') throw new PersonalError('这类内容需要填写链接或选择本机文件');
    const category = readingCategory(row.category);
    return { index, title, type, url, notes: readingNotes(row.notes), category,
      sourceKey: upload ? `file:${upload.attachment.id.split('.')[0]}` : url ? canonicalReadingSource(url) : '',
      ...(upload ? { uploadId: upload.uploadId, attachment: upload.attachment } : {}),
      manualCategory: row.category !== undefined, decision: 'import', reason: '确认后加入书架，再由本机 Qwen 分类。' };
  });
}

export function quickReadingCounts(candidates: QuickReadingCandidate[]): ReadingImportCounts {
  return { total: candidates.length, accepted: candidates.filter(item => item.decision === 'import').length,
    duplicates: candidates.filter(item => item.decision === 'duplicate').length,
    suppressed: candidates.filter(item => item.decision === 'suppressed').length, excluded: 0, review: 0 };
}
