import { categoryNames, suggestLink, typeNames, type ReadingCategory, type ReadingType } from './reading-model';

export type QuickEntry = { title?: string; url?: string; uploadId?: string; type?: ReadingType; category?: ReadingCategory; notes?: string };
export type QuickCandidate = QuickEntry & { index: number; title: string; type: ReadingType; url: string; notes: string; category: ReadingCategory; sourceKey: string; decision: 'import' | 'duplicate' | 'suppressed'; reason: string; attachment?: { name: string; size: number; mime: string } };
export type QuickPreview = { candidates: QuickCandidate[]; counts: { total: number; accepted: number; duplicates: number; suppressed: number } };
export const QUICK_FILE_ACCEPT = '.pdf,.epub,.md,.txt,.url,.webloc,.json,.csv';
export const QUICK_MAX_ITEMS = 30;

export function linkEntries(text: string): QuickEntry[] {
  return text.split(/\r?\n/).map(value => value.trim()).filter(Boolean).map(url => ({ url, ...(suggestLink(url) ?? {}) }));
}

function normalizeEntry(value: unknown): QuickEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-row');
  const row = value as Record<string, unknown>;
  if (typeof row.url !== 'string' || !/^https?:\/\//i.test(row.url)) throw new Error('missing-url');
  const suggestion = suggestLink(row.url);
  return { url: row.url.trim(), ...(typeof row.title === 'string' && row.title.trim() ? { title: row.title.trim() } : suggestion?.title ? { title: suggestion.title } : {}),
    ...(typeof row.notes === 'string' ? { notes: row.notes } : {}), ...(typeof row.type === 'string' && row.type in typeNames ? { type: row.type as ReadingType } : suggestion ? { type: suggestion.type } : {}),
    ...(typeof row.category === 'string' && row.category in categoryNames ? { category: row.category as ReadingCategory } : {}) };
}

// Quoted fields may contain commas, newlines and doubled quotes.
export function readCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') { if (quoted && text[index + 1] === '"') { cell += '"'; index++; } else quoted = !quoted; }
    else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (char === '\n' || char === '\r')) { if (char === '\r' && text[index + 1] === '\n') index++; row.push(cell); if (row.some(value => value.trim())) rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (quoted) throw new Error('invalid-csv');
  row.push(cell); if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

export function parseLinkFile(name: string, raw: string): QuickEntry[] {
  const text = raw.replace(/^\uFEFF/, ''); const extension = name.split('.').pop()?.toLowerCase();
  let values: unknown[];
  if (extension === 'url') {
    const url = /^URL=(.+)$/mi.exec(text)?.[1]?.trim(); values = [{ url, title: name.replace(/\.url$/i, '') }];
  } else if (extension === 'webloc') {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('invalid-webloc');
    const key = Array.from(doc.querySelectorAll('key')).find(element => element.textContent === 'URL');
    values = [{ url: key?.nextElementSibling?.tagName === 'string' ? key.nextElementSibling.textContent : undefined, title: name.replace(/\.webloc$/i, '') }];
  } else if (extension === 'json') {
    const data: unknown = JSON.parse(text); values = Array.isArray(data) ? data : data && typeof data === 'object' && 'items' in data && Array.isArray(data.items) ? data.items : [];
    if (!values.length) throw new Error('invalid-json');
  } else if (extension === 'csv') {
    const rows = readCsv(text); const headers = rows.shift()?.map(value => value.trim().toLowerCase()) ?? [];
    if (!headers.includes('url')) throw new Error('missing-url');
    values = rows.map(row => Object.fromEntries(headers.map((key, index) => [key, row[index] ?? ''])));
  } else throw new Error('unsupported');
  if (!values.length || values.length > QUICK_MAX_ITEMS) throw new Error('count');
  return values.map(normalizeEntry);
}
