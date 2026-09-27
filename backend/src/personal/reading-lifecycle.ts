import { createHash } from 'node:crypto';
import { readingNotes, readingStatus, readingTitle, readingType, readingUrl } from './reading';
import { canonicalReadingSource, classifyReading, readingCategory } from './reading-import';
import { validCoverUrl } from './covers';
import type { ReadingItem } from './types';
import { validateAttachment } from './reading-attachments';

export const READING_TRASH_MS = 30 * 24 * 60 * 60 * 1000;
export const READING_IMPORT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function presentedReadingItem(item: ReadingItem): ReadingItem {
  const legacyDirection = /^来源：B站历史（[^\r\n]+），方向：(编程|AI|设计)。$/mu.exec(item.notes)?.[1];
  const legacyCategory = legacyDirection === '编程' || legacyDirection === 'AI' ? 'programming_ai' : legacyDirection === '设计' ? 'design' : undefined;
  return {
    ...item,
    category: readingCategory(item.category || legacyCategory || classifyReading(item.title).category),
    ...(item.url ? { sourceKey: item.sourceKey || canonicalReadingSource(item.url) } : {}),
    ...(item.attachment ? { attachment: { ...item.attachment,
      url: `/api/personal/reading/${encodeURIComponent(item.id)}/attachment`,
      downloadUrl: `/api/personal/reading/${encodeURIComponent(item.id)}/attachment?download=1`,
    } } : {}),
  };
}

export function readingFingerprint(item: ReadingItem): string {
  // Cover enrichment is metadata. It must not block an undo or change progress.
  return createHash('sha256').update(JSON.stringify([
    item.id, item.title, item.type, item.url, item.notes, item.status,
    item.category, item.finishedAt || '', item.sourceKey || '', item.importBatchId || '', item.updatedAt,
    ...(item.attachment ? [item.attachment.id] : []),
  ])).digest('hex');
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function timestamp(value: unknown): boolean { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function assertItem(value: unknown): void {
  if (!record(value) || typeof value.id !== 'string' || !value.id || value.id.length > 128 || !['manual', 'report'].includes(String(value.origin)) || !timestamp(value.addedAt) || !timestamp(value.updatedAt)) throw new Error();
  readingTitle(value.title);
  readingType(value.type);
  readingStatus(value.status);
  if (typeof value.url !== 'string' || typeof value.notes !== 'string') throw new Error();
  readingUrl(value.url);
  readingNotes(value.notes);
  if ('category' in value) readingCategory(value.category);
  if ('finishedAt' in value && !timestamp(value.finishedAt)) throw new Error();
  for (const key of ['sourceKey', 'importBatchId']) if (key in value && (typeof value[key] !== 'string' || !value[key])) throw new Error();
  if ('coverUrl' in value && !validCoverUrl(value.coverUrl)) throw new Error();
  if ('attachment' in value) validateAttachment(value.attachment);
  if ('classification' in value) {
    if (!record(value.classification) || !['pending', 'ready', 'review', 'failed', 'manual'].includes(String(value.classification.status))) throw new Error();
    for (const key of ['model', 'reason', 'message']) if (key in value.classification && (typeof value.classification[key] !== 'string' || value.classification[key].length > 240)) throw new Error();
    if ('confidence' in value.classification && !['high', 'medium', 'low'].includes(String(value.classification.confidence))) throw new Error();
    if ('suggestedCategory' in value.classification) readingCategory(value.classification.suggestedCategory);
  }
}

export function validateSavedReading(value: Record<string, unknown>): void {
  try {
    if ('readingWorkflowVersion' in value && value.readingWorkflowVersion !== 1 && value.readingWorkflowVersion !== 2) throw new Error();
    if ('readingItems' in value) {
      if (!Array.isArray(value.readingItems)) throw new Error();
      value.readingItems.forEach(assertItem);
      if (new Set(value.readingItems.map(item => item.id)).size !== value.readingItems.length) throw new Error();
    }
    if ('readingReports' in value) {
      if (!record(value.readingReports)) throw new Error();
      for (const state of Object.values(value.readingReports)) {
        if (!record(state) || (state.lastReadVersion !== null && typeof state.lastReadVersion !== 'string')) throw new Error();
        readingStatus(state.status);
        if ('category' in state) readingCategory(state.category);
        if ('finishedAt' in state && !timestamp(state.finishedAt)) throw new Error();
        if ('hidden' in state && typeof state.hidden !== 'boolean') throw new Error();
      }
    }
    if ('readingTrash' in value) {
      if (!Array.isArray(value.readingTrash)) throw new Error();
      for (const entry of value.readingTrash) {
        if (!record(entry) || !timestamp(entry.deletedAt) || !timestamp(entry.expiresAt) || typeof entry.batchId !== 'string') throw new Error();
        assertItem(entry.item);
      }
    }
    for (const key of ['readingSuppressions', 'readingRevisions', 'readingExpiredIds']) if (key in value && !record(value[key])) throw new Error();
    if (record(value.readingSuppressions) && Object.values(value.readingSuppressions).some(item => !timestamp(item))) throw new Error();
    if (record(value.readingExpiredIds) && Object.values(value.readingExpiredIds).some(item => !timestamp(item))) throw new Error();
    if (record(value.readingRevisions) && Object.values(value.readingRevisions).some(item => !Number.isSafeInteger(item) || Number(item) < 0)) throw new Error();
    if ('readingImports' in value) {
      if (!Array.isArray(value.readingImports)) throw new Error();
      for (const batch of value.readingImports) {
        if (!record(batch) || typeof batch.id !== 'string' || !timestamp(batch.createdAt) || !Array.isArray(batch.itemIds) || !Array.isArray(batch.candidates) || !record(batch.fingerprints) || !record(batch.revisions) || !record(batch.counts)) throw new Error();
      }
    }
  } catch {
    throw new Error('Personal workbench reading data is invalid; restore its backup before starting.');
  }
}
