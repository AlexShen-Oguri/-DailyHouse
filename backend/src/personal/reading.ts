import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { withinRoot } from './files';
import { PersonalError, type PersonalSettings, type ReadingItem, type ReadingSource, type ReadingStatus, type ReadingType, type ReportReadingState, type ReportSourceId } from './types';

export const READING_TYPES: ReadingType[] = ['book', 'video', 'course', 'tutorial', 'github', 'article'];
export const READING_STATUSES: ReadingStatus[] = ['unread', 'reading', 'done'];

export function readingType(value: unknown): ReadingType {
  if (typeof value !== 'string' || !READING_TYPES.includes(value as ReadingType)) throw new PersonalError('请选择有效的阅读类型');
  return value as ReadingType;
}

export function readingStatus(value: unknown): ReadingStatus {
  if (typeof value !== 'string' || !READING_STATUSES.includes(value as ReadingStatus)) throw new PersonalError('请选择有效的阅读状态');
  return value as ReadingStatus;
}

export function readingTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 300) throw new PersonalError('阅读标题应为 1–300 个字符');
  return value.trim();
}

export function readingNotes(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > 10000) throw new PersonalError('阅读笔记不能超过 10000 个字符');
  return value.trim();
}

export function readingUrl(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) throw new PersonalError('请填写有效的 HTTP 或 HTTPS 链接');
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.toString();
  } catch { throw new PersonalError('请填写有效的 HTTP 或 HTTPS 链接'); }
}

interface DiscoveredReport { item: ReadingItem; filePath: string; version: string }
const SOURCE_DEFINITIONS: { id: ReportSourceId; label: string; setting: 'readingTechPath' | 'readingAestheticPath'; filename: RegExp }[] = [
  { id: 'tech', label: '每日 AI 科技早报', setting: 'readingTechPath', filename: /^(\d{4}-\d{2}-\d{2})_AI科技早报\.pdf$/u },
  { id: 'aesthetic', label: '每日审美图鉴', setting: 'readingAestheticPath', filename: /^(\d{4}-\d{2}-\d{2})_每日审美图鉴\.pdf$/u },
];

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function discoverReadingReports(settings: Pick<PersonalSettings, 'readingTechPath' | 'readingAestheticPath'>, states: Record<string, ReportReadingState> = {}) {
  const reports: DiscoveredReport[] = [];
  const sources: ReadingSource[] = [];
  for (const definition of SOURCE_DEFINITIONS) {
    const source: ReadingSource = { id: definition.id, label: definition.label, path: settings[definition.setting], status: 'ready', count: 0, message: '只读取此文件夹根目录中的正式 PDF，不生成或修改汇报。' };
    sources.push(source);
    let root: string;
    let filenames: string[];
    try {
      const info = lstatSync(source.path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe source directory');
      root = realpathSync(source.path);
      filenames = readdirSync(root);
    } catch (error) {
      source.status = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? 'missing' : 'error';
      source.message = source.status === 'missing' ? '尚未找到汇报文件夹，请检查路径。' : '汇报文件夹无法读取，或路径是符号链接。';
      continue;
    }
    for (const filename of filenames) {
      const match = definition.filename.exec(filename);
      if (!match || !validDate(match[1])) continue;
      try {
        const filePath = join(root, filename);
        const info = lstatSync(filePath);
        if (!info.isFile() || info.isSymbolicLink() || info.size === 0 || !withinRoot(root, realpathSync(filePath))) continue;
        const reportDate = match[1];
        const id = `report:${definition.id}:${reportDate}`;
        const saved = states[id];
        const version = `${info.size}:${info.mtimeMs}`;
        const status = saved?.status || 'unread';
        const item: ReadingItem = {
          id, title: `${definition.label} · ${reportDate}`, type: 'article', url: '', notes: '', status,
          category: saved?.category || (definition.id === 'tech' ? 'ai' : 'design'),
          ...(saved?.finishedAt && status === 'done' ? { finishedAt: saved.finishedAt } : {}),
          addedAt: (info.birthtimeMs > 0 ? info.birthtime : info.mtime).toISOString(),
          updatedAt: info.mtime.toISOString(), origin: 'report', reportSource: definition.id, reportDate,
          ...(definition.id === 'tech' ? { coverageDate: reportDate } : {}),
          updatedSinceRead: Boolean(saved?.lastReadVersion && saved.lastReadVersion !== version),
          pdfUrl: `/api/personal/reading/${encodeURIComponent(id)}/pdf`,
        };
        reports.push({ item, filePath, version });
        source.count++;
      } catch { /* Ignore files still being written or removed by the report workflow. */ }
    }
  }
  reports.sort((a, b) => b.item.reportDate!.localeCompare(a.item.reportDate!) || a.item.id.localeCompare(b.item.id));
  return { reports, sources, scannedAt: new Date().toISOString() };
}

export function findReadingReport(settings: Pick<PersonalSettings, 'readingTechPath' | 'readingAestheticPath'>, states: Record<string, ReportReadingState>, id: string): DiscoveredReport {
  if (!/^report:(tech|aesthetic):\d{4}-\d{2}-\d{2}$/.test(id)) throw new PersonalError('汇报不存在或已经移走', 404);
  const report = discoverReadingReports(settings, states).reports.find(candidate => candidate.item.id === id);
  if (!report) throw new PersonalError('汇报不存在或已经移走', 404);
  return report;
}
