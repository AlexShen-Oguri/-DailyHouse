import { loadIdeas, loadIdeasTrash, loadIdeasRemovedIds } from './ideas';
import { loadLearningData, LEARNING_TRASH_MS } from './learning';
import { validateSavedReading } from './reading-lifecycle';
import { canonicalReadingSource, readingCategory } from './reading-import';
import { validateAttachment } from './reading-attachments';
import { PersonalError } from './types';

/** A record snapshot, never a replacement JSON database or an external tool record. */
export interface ProjectedRecord { kind: string; id: string; body: Record<string, unknown> | null; deletedAt?: string; expiresAt?: string }
export const PERSONAL_SYNC_KINDS = ['todo', 'reading', 'readingReport', 'readingSuppression', 'readingExpired', 'idea', 'ideaRemoved', 'learning'] as const;
export const GARDEN_SYNC_KINDS = ['ideaMeta', 'gardenProject'] as const;
export const JOURNAL_SYNC_KINDS = ['journal', 'journalSuppression'] as const;
export const SYNC_KINDS = [...PERSONAL_SYNC_KINDS, ...GARDEN_SYNC_KINDS, ...JOURNAL_SYNC_KINDS] as const;
type JsonObject = Record<string, any>;
const RECOVERY_MS = LEARNING_TRASH_MS;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = () => { throw new PersonalError('同步记录无效，未应用任何记录。', 400); };
function object(value: unknown): JsonObject { if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(); return value as JsonObject; }
function exact(value: unknown, keys: readonly string[]): JsonObject { const result = object(value); if (Object.keys(result).some(key => !keys.includes(key))) return fail(); return result; }
function pick(value: JsonObject, keys: readonly string[]): JsonObject { return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, structuredClone(value[key])])); }
function text(value: unknown, max: number, required = false): asserts value is string { if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(); }
function time(value: unknown): asserts value is string { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail(); }
function integer(value: unknown, min = 1): void { if (!Number.isSafeInteger(value) || Number(value) < min) fail(); }
function date(value: unknown, nullable = false): void { if (nullable && value === null) return; if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(); }
function sourceKey(value: string): void { if (/^(?:file:[a-f0-9]{64}|bilibili:BV[0-9A-Za-z]{10})$/.test(value)) return; url(value, false); if (canonicalReadingSource(value) !== value) fail(); }
function id(value: unknown, isUuid = false): asserts value is string { text(value, 128, true); if (isUuid && !uuid.test(value)) fail(); }
function ideaId(value: unknown): asserts value is string { id(value); if (!uuid.test(value) && !/^legacy-[a-f0-9]{24}$/.test(value)) fail(); }
function bool(value: unknown): void { if (typeof value !== 'boolean') fail(); }
function choice(value: unknown, values: readonly string[]): void { if (!values.includes(value as string)) fail(); }
function list(value: unknown, limit: number): any[] { if (!Array.isArray(value) || value.length > limit) return fail(); return value; }
function unique(values: unknown[]): void { if (new Set(values).size !== values.length) fail(); }
function stable(value: any): string { return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item); }
function url(value: unknown, empty = true): void { text(value, 4096); if (empty && value === '') return; let parsed: URL; try { parsed = new URL(value); } catch { return fail(); } if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) fail(); }
function common(value: JsonObject, maxTitle: number, isUuid = true): void { id(value.id, isUuid); text(value.title, maxTitle, true); time(value.createdAt); time(value.updatedAt); integer(value.revision); }
const todoKeys = ['id', 'title', 'done', 'createdAt', 'dueDate', 'source'];
const readingKeys = ['id', 'title', 'type', 'url', 'notes', 'status', 'category', 'finishedAt', 'sourceKey', 'addedAt', 'updatedAt', 'origin', 'reportSource', 'reportDate', 'coverageDate', 'attachmentMetadata', 'manualCategory'];
const ideaKeys = ['id', 'title', 'status', 'createdAt', 'updatedAt', 'entries'];
const learningKeys = ['id', 'title', 'course', 'goal', 'nextStep', 'nextStepId', 'dueDate', 'status', 'createdAt', 'updatedAt', 'entries'];
const sourceKeys = ['id', 'title', 'body', 'updatedAt', 'sources'];
const projectKeys = ['id', 'title', 'goal', 'mvp', 'acceptance', 'nextStep', 'nextStepId', 'sourceBubbleId', 'sourceSnapshot', 'status', 'createdAt', 'updatedAt', 'todoId', 'finishedAt'];
const journalKeys = ['date', 'timezone', 'title', 'codex', 'life', 'reflection', 'status', 'lifeState', 'createdAt', 'updatedAt', 'editedFields', 'writer'];

function sourceProjection(value: JsonObject, depth = 0): JsonObject {
  if (depth > 8) fail();
  const result = pick(value, sourceKeys);
  if (result.sources) result.sources = list(result.sources, 8).map(child => sourceProjection(object(child), depth + 1));
  return result;
}
function retainLocalSource(shared: JsonObject, local?: JsonObject): JsonObject {
  return { ...shared, ...(local?.conversations ? { conversations: local.conversations } : {}), ...(local?.drafts ? { drafts: local.drafts } : {}), ...(shared.sources ? { sources: shared.sources.map((child: JsonObject) => retainLocalSource(child, local?.sources?.find((old: JsonObject) => old.id === child.id))) } : {}) };
}
function validateSource(input: unknown, depth = 0): void {
  if (depth > 8) fail(); const value = exact(input, sourceKeys);
  ideaId(value.id); text(value.title, 200, true); text(value.body, 100000); time(value.updatedAt);
  if (value.sources !== undefined) { const sources = list(value.sources, 8); sources.forEach(child => validateSource(child, depth + 1)); unique(sources.map(child => child.id)); }
}
function bodyProjection(kind: string, input: JsonObject): JsonObject {
  if (kind === 'todo') { const result = pick(input, todoKeys); if (input.source && ['reading', 'learning'].includes(input.source.kind)) result.source = pick(input.source, ['kind', 'id', 'stepId', 'title', 'type', 'url']); else delete result.source; return result; }
  if (kind === 'reading') { const result = pick(input, readingKeys); const attachment = input.attachment || input.attachmentMetadata; if (attachment) result.attachmentMetadata = pick(attachment, ['id', 'name', 'size', 'mime', 'extension']); if (input.classification?.status === 'manual') result.manualCategory = true; return result; }
  if (kind === 'idea') { const result = pick(input, ideaKeys); result.entries = list(input.entries, 5000).map(entry => pick(object(entry), ['id', 'kind', 'content', 'createdAt', 'updatedAt'])); return result; }
  if (kind === 'learning') { const result = pick(input, learningKeys); result.entries = list(input.entries, 5000).map(entry => { const clean = pick(object(entry), ['id', 'kind', 'content', 'links', 'nextStep', 'nextStepId', 'createdAt', 'updatedAt', 'removedAt', 'expiresAt']); clean.links = list(entry.links, 20).map(link => pick(object(link), ['id', 'title', 'url'])); return clean; }); return result; }
  if (kind === 'readingReport') return pick(input, ['status', 'hidden', 'category', 'finishedAt']);
  if (kind === 'ideaMeta') { const result = pick(input, ['id', 'tags', 'pinned', 'sources']); result.sources = list(input.sources, 8).map(child => sourceProjection(object(child))); return result; }
  if (kind === 'gardenProject') { const result = pick(input, projectKeys); result.sourceSnapshot = sourceProjection(object(input.sourceSnapshot)); return result; }
  if (kind === 'journal') return pick(input, journalKeys);
  return structuredClone(input);
}

function validateBody(kind: string, recordId: string, input: unknown): JsonObject {
  const value = object(input);
  if (['todo', 'reading', 'idea', 'learning', 'ideaMeta', 'gardenProject'].includes(kind) && value.id !== recordId) fail();
  if (kind === 'todo') {
    exact(value, todoKeys); id(value.id, true); text(value.title, 200, true); bool(value.done); time(value.createdAt); date(value.dueDate, true);
    if (value.source !== undefined) { const source = exact(value.source, ['kind', 'id', 'title', 'type', 'url', 'stepId']); choice(source.kind, ['reading', 'learning']); id(source.id, source.kind === 'learning'); text(source.title, 300, true); if (source.kind === 'learning') { id(source.stepId, true); if ('type' in source || source.url !== `#/learning/${source.id}`) fail(); } else { url(source.url); choice(source.type, ['book', 'video', 'course', 'tutorial', 'github', 'article']); if ('stepId' in source) fail(); } }
  } else if (kind === 'reading') {
    exact(value, readingKeys); validateSavedReading({ readingItems: [value] });
    if (value.sourceKey !== undefined) {
      text(value.sourceKey, 4096, true);
      if (/^file:[a-f0-9]{64}$/.test(value.sourceKey)) { if (!value.attachmentMetadata || `file:${String(value.attachmentMetadata.id).split('.')[0]}` !== value.sourceKey) fail(); }
      else if (!value.url || canonicalReadingSource(value.url) !== value.sourceKey) fail();
    }
    if (value.attachmentMetadata !== undefined) { const a = exact(value.attachmentMetadata, ['id', 'name', 'size', 'mime', 'extension']); validateAttachment(a); }
    if (value.manualCategory !== undefined) bool(value.manualCategory);
    if (value.reportDate !== undefined) date(value.reportDate); if (value.coverageDate !== undefined) date(value.coverageDate);
    if (value.reportSource !== undefined) choice(value.reportSource, ['tech', 'aesthetic']);
  } else if (kind === 'readingReport') {
    exact(value, ['status', 'hidden', 'category', 'finishedAt']); if (!/^report:(tech|aesthetic):\d{4}-\d{2}-\d{2}$/.test(recordId)) fail(); date(recordId.split(':')[2]);
    validateSavedReading({ readingReports: { [recordId]: { ...value, lastReadVersion: null } } });
  } else if (kind === 'readingSuppression') { exact(value, ['removedAt']); time(value.removedAt); }
  else if (kind === 'readingExpired') { exact(value, ['expiredAt']); time(value.expiredAt); }
  else if (kind === 'idea') {
    exact(value, ideaKeys); list(value.entries, 5000).forEach(entry => exact(entry, ['id', 'kind', 'content', 'createdAt', 'updatedAt'])); loadIdeas({ ideas: [{ ...value, revision: 1 }] });
  } else if (kind === 'ideaRemoved') { exact(value, ['removed']); ideaId(recordId); if (value.removed !== true) fail(); }
  else if (kind === 'learning') {
    exact(value, learningKeys); const linkIds: string[] = [];
    list(value.entries, 5000).forEach(entry => { exact(entry, ['id', 'kind', 'content', 'links', 'nextStep', 'nextStepId', 'createdAt', 'updatedAt', 'removedAt', 'expiresAt']); list(entry.links, 20).forEach(link => { exact(link, ['id', 'title', 'url']); linkIds.push(link.id); }); if (entry.removedAt) { time(entry.removedAt); time(entry.expiresAt); if (Date.parse(entry.expiresAt) - Date.parse(entry.removedAt) !== RECOVERY_MS) fail(); } }); unique(linkIds); loadLearningData({ learningPlans: [{ ...value, revision: 1 }] });
  } else if (kind === 'ideaMeta') {
    exact(value, ['id', 'tags', 'pinned', 'sources']); ideaId(value.id); bool(value.pinned);
    const tags = list(value.tags, 8); tags.forEach(tag => text(tag, 32, true)); unique(tags); const sources = list(value.sources, 8); sources.forEach(source => validateSource(source)); unique(sources.map(source => source.id));
  } else if (kind === 'gardenProject') {
    exact(value, projectKeys); common({ ...value, revision: 1 }, 120); text(value.goal, 2000, true); text(value.nextStep, 200, true); id(value.nextStepId, true); ideaId(value.sourceBubbleId);
    for (const key of ['mvp', 'acceptance']) list(value[key], 12).forEach(item => text(item, 1000, true));
    validateSource(value.sourceSnapshot); choice(value.status, ['active', 'done', 'archived']); if (value.todoId !== undefined) id(value.todoId, true); if (value.finishedAt !== undefined) time(value.finishedAt);
  } else if (kind === 'journal') {
    exact(value, journalKeys); date(recordId); if (value.date !== recordId || value.timezone !== 'America/New_York') fail(); text(value.title, 160, true); text(value.codex, 24000); text(value.life, 24000); text(value.reflection, 12000); if (!(value.codex || value.life || value.reflection)) fail();
    for (const key of ['title', 'codex', 'life', 'reflection']) if (value[key] !== value[key].trim()) fail();
    choice(value.status, ['draft', 'final']); choice(value.lifeState, ['waiting', 'provided', 'skipped']); if (value.lifeState === 'provided' && !value.life) fail(); time(value.createdAt); time(value.updatedAt); choice(value.writer, ['codex', 'manual']); const fields = list(value.editedFields, 6); fields.forEach(field => choice(field, ['title', 'codex', 'life', 'reflection', 'status', 'lifeState'])); unique(fields);
  } else if (kind === 'journalSuppression') { exact(value, ['deleted']); date(recordId); if (value.deleted !== true) fail(); }
  else fail();
  return structuredClone(value);
}

/** Reject unknown fields at both the envelope and nested body boundaries. */
export function validateProjectedRecords(input: unknown, allowed: readonly string[] = SYNC_KINDS): ProjectedRecord[] {
  const records = list(input, 50000); const seen = new Set<string>();
  return records.map(raw => {
    const record = exact(raw, ['kind', 'id', 'body', 'deletedAt', 'expiresAt']);
    choice(record.kind, allowed); text(record.id, record.kind === 'readingSuppression' ? 4096 : 128, true);
    if (/\u0000/.test(record.id) || ['__proto__', 'constructor', 'prototype'].includes(record.id)) fail();
    if (['todo', 'learning', 'gardenProject'].includes(record.kind)) id(record.id, true);
    if (['idea', 'ideaRemoved', 'ideaMeta'].includes(record.kind)) ideaId(record.id);
    if (['journal', 'journalSuppression'].includes(record.kind)) date(record.id);
    if (record.kind === 'readingReport') { if (!/^report:(tech|aesthetic):\d{4}-\d{2}-\d{2}$/.test(record.id)) fail(); date(record.id.split(':')[2]); }
    if (record.kind === 'readingSuppression') sourceKey(record.id);
    const key = `${record.kind}\0${record.id}`; if (seen.has(key)) fail(); seen.add(key);
    if (record.deletedAt !== undefined) time(record.deletedAt); if (record.expiresAt !== undefined) { time(record.expiresAt); if (!record.deletedAt || Date.parse(record.expiresAt) - Date.parse(record.deletedAt) !== RECOVERY_MS) fail(); }
    if (record.body === null) { if (record.expiresAt !== undefined) fail(); return structuredClone(record) as ProjectedRecord; }
    if (record.deletedAt !== undefined && !record.expiresAt) fail();
    if (record.deletedAt !== undefined && !['reading', 'idea', 'learning', 'gardenProject', 'journal'].includes(record.kind)) fail();
    return { ...record, body: validateBody(record.kind, record.id, record.body) } as ProjectedRecord;
  });
}
export function validateProjectedRecord(input: unknown): ProjectedRecord { return validateProjectedRecords([input])[0]; }
/** Explicit deletions live beside the owned data, never inferred from a missing file. */
export function loadSyncTombstones(input: unknown, allowed: readonly string[]): ProjectedRecord[] {
  if (input === undefined) return [];
  const records = validateProjectedRecords(input, allowed);
  if (records.some(item => item.body !== null)) fail();
  return records;
}
const recordKey = (item: ProjectedRecord): string => `${item.kind}\0${item.id}`;
function orderedTombstones(values: Iterable<ProjectedRecord>): ProjectedRecord[] {
  return [...values].sort((a, b) => recordKey(a).localeCompare(recordKey(b)));
}
export function withSyncTombstones(records: ProjectedRecord[], input: unknown, allowed: readonly string[]): ProjectedRecord[] {
  const output = new Map(records.map(item => [recordKey(item), item]));
  for (const item of loadSyncTombstones(input, allowed)) {
    // A restored live or recoverable record always wins over an old deletion.
    if (!output.get(recordKey(item))?.body) output.set(recordKey(item), item);
  }
  return [...output.values()];
}
/** Called only during a known application mutation against the in-memory prior data. */
export function trackSyncTombstones(previous: ProjectedRecord[], current: ProjectedRecord[], input: unknown, allowed: readonly string[]): ProjectedRecord[] {
  const tombstones = new Map(loadSyncTombstones(input, allowed).map(item => [recordKey(item), item]));
  const present = new Map(current.map(item => [recordKey(item), item]));
  for (const old of previous) {
    const next = present.get(recordKey(old));
    if (!next) tombstones.set(recordKey(old), old.body === null ? old : { kind: old.kind, id: old.id, body: null, deletedAt: old.deletedAt || new Date().toISOString() });
    else if (next.body === null && old.deletedAt && !tombstones.has(recordKey(old))) tombstones.set(recordKey(old), { kind: old.kind, id: old.id, body: null, deletedAt: old.deletedAt });
  }
  for (const item of current) if (item.body !== null) tombstones.delete(recordKey(item));
  return orderedTombstones(tombstones.values());
}
function rememberAppliedTombstones(data: JsonObject, records: ProjectedRecord[], allowed: readonly string[]): void {
  const tombstones = new Map(loadSyncTombstones(data.syncTombstones, allowed).map(item => [recordKey(item), item]));
  for (const item of records) {
    if (item.body === null) tombstones.set(recordKey(item), item);
    else if (item.expiresAt && Date.parse(item.expiresAt) <= Date.now()) tombstones.set(recordKey(item), { kind: item.kind, id: item.id, body: null, deletedAt: item.deletedAt });
    else tombstones.delete(recordKey(item));
  }
  if (tombstones.size || data.syncTombstones !== undefined) data.syncTombstones = orderedTombstones(tombstones.values());
}
function record(kind: string, value: JsonObject, extra: Partial<ProjectedRecord> = {}): ProjectedRecord {
  const key = kind === 'journal' ? value.date : value.id;
  if (extra.expiresAt && Date.parse(extra.expiresAt) <= Date.now()) return { kind, id: key, body: null, deletedAt: extra.deletedAt };
  if (kind === 'learning') value = { ...value, entries: value.entries.filter((entry: JsonObject) => !entry.expiresAt || Date.parse(entry.expiresAt) > Date.now()) };
  return { kind, id: key, body: bodyProjection(kind, value), ...extra };
}
function scalar(kind: string, key: string, body: JsonObject): ProjectedRecord { return { kind, id: key, body }; }
function replace<T extends JsonObject>(values: T[], key: string, item: T | null, field = 'id'): T[] { return [...values.filter(value => value[field] !== key), ...(item ? [item] : [])]; }
function removeMap(map: JsonObject, key: string): void { delete map[key]; }

export function projectPersonal(data: JsonObject): ProjectedRecord[] {
  const readings = new Set([...data.readingItems, ...data.readingTrash.map((entry: JsonObject) => entry.item)].map((item: JsonObject) => item.id));
  const ideas = new Set([...data.ideas, ...data.ideasTrash.map((entry: JsonObject) => entry.idea)].map((item: JsonObject) => item.id));
  return withSyncTombstones([
    ...data.todos.filter((item: JsonObject) => item.source?.kind !== 'project_action').map((item: JsonObject) => record('todo', item)),
    ...data.readingItems.map((item: JsonObject) => record('reading', item)),
    ...data.readingTrash.map((entry: JsonObject) => record('reading', entry.item, { deletedAt: entry.deletedAt, expiresAt: entry.expiresAt })),
    ...Object.entries(data.readingReports).map(([key, value]) => scalar('readingReport', key, bodyProjection('readingReport', object(value)))),
    ...Object.entries(data.readingSuppressions).map(([key, value]) => scalar('readingSuppression', key, { removedAt: value })),
    ...Object.entries(data.readingExpiredIds).map(([key, value]) => scalar('readingExpired', key, { expiredAt: value })),
    ...Object.entries(data.readingExpiredIds).filter(([key]) => !readings.has(key)).map(([key, value]) => ({ kind: 'reading', id: key, body: null, deletedAt: value as string })),
    ...data.ideas.map((item: JsonObject) => record('idea', item)), ...data.ideasTrash.map((entry: JsonObject) => record('idea', entry.idea, { deletedAt: entry.deletedAt, expiresAt: entry.expiresAt })),
    ...data.ideasRemovedIds.map((key: string) => scalar('ideaRemoved', key, { removed: true })),
    ...data.ideasRemovedIds.filter((key: string) => !ideas.has(key)).map((key: string) => ({ kind: 'idea', id: key, body: null })),
    ...data.learningPlans.map((item: JsonObject) => record('learning', item)), ...data.learningTrash.map((entry: JsonObject) => record('learning', entry.plan, { deletedAt: entry.removedAt, expiresAt: entry.expiresAt })),
  ], data.syncTombstones, PERSONAL_SYNC_KINDS);
}
/** No absent-record deletion, attachments cleanup, project commands or local settings mutation. */
export function applyPersonal<T extends JsonObject>(data: T, input: unknown): T {
  const records = validateProjectedRecords(input, PERSONAL_SYNC_KINDS); const next: JsonObject = structuredClone(data);
  const previousRecords = new Map(projectPersonal(data).map(value => [`${value.kind}\0${value.id}`, value]));
  for (const item of records) {
    if (stable(previousRecords.get(`${item.kind}\0${item.id}`)) === stable(item)) continue;
    const body = item.body as JsonObject | null;
    if (item.kind === 'todo') {
      if (next.todos.some((todo: JsonObject) => todo.id === item.id && todo.source?.kind === 'project_action')) throw new PersonalError('设备专属项目待办不能由同步覆盖。', 409);
      next.todos = replace(next.todos, item.id, body);
    } else if (item.kind === 'reading') {
      const previous = next.readingItems.find((value: JsonObject) => value.id === item.id) || next.readingTrash.find((entry: JsonObject) => entry.item.id === item.id)?.item;
      const removedSource = (body || previous)?.sourceKey || ((body || previous)?.url ? canonicalReadingSource((body || previous).url) : '');
      if ((item.deletedAt || !body) && removedSource) next.readingSuppressions[removedSource] = item.deletedAt || next.readingSuppressions[removedSource] || new Date().toISOString();
      next.readingItems = replace(next.readingItems, item.id, null); next.readingTrash = next.readingTrash.filter((entry: JsonObject) => entry.item.id !== item.id);
      if (body) {
        const { attachmentMetadata, manualCategory, ...fields } = body;
        if (previous?.attachment && (!attachmentMetadata || previous.attachment.id !== attachmentMetadata.id)) throw new PersonalError('附件身份与本机副本不同，请先核对这条资料。', 409);
        const value = { ...(previous || {}), ...fields, ...(attachmentMetadata ? { attachmentMetadata } : {}), ...(manualCategory ? { classification: { status: 'manual' } } : {}) };
        if (!attachmentMetadata) delete value.attachmentMetadata;
        if (!manualCategory && value.classification?.status === 'manual') delete value.classification;
        // An unavailable remote copy must never become a fabricated local attachment route.
        if (!previous?.attachment) delete value.attachment;
        if (item.deletedAt && Date.parse(item.expiresAt!) > Date.now()) next.readingTrash.push({ item: value, deletedAt: item.deletedAt, expiresAt: item.expiresAt, batchId: `sync:${item.id}`, ...(value.origin === 'report' ? { reportState: { status: value.status, category: value.category, ...(value.finishedAt ? { finishedAt: value.finishedAt } : {}), lastReadVersion: next.readingReports[item.id]?.lastReadVersion ?? null } } : {}) });
        else if (!item.deletedAt) next.readingItems.push(value);
        else next.readingExpiredIds[item.id] = item.expiresAt;
      } else next.readingExpiredIds[item.id] = next.readingExpiredIds[item.id] || item.deletedAt || new Date().toISOString();
      if ((item.deletedAt || !body) && /^report:(tech|aesthetic):/.test(item.id)) next.readingReports[item.id] = { ...(next.readingReports[item.id] || { status: body?.status || previous?.status || 'unread', lastReadVersion: null }), hidden: true };
      next.readingRevisions[item.id] = (next.readingRevisions[item.id] || 0) + 1;
    } else if (item.kind === 'readingReport') { if (body) next.readingReports[item.id] = { ...body, lastReadVersion: next.readingReports[item.id]?.lastReadVersion ?? null }; else removeMap(next.readingReports, item.id); }
    else if (item.kind === 'readingSuppression') { if (body) next.readingSuppressions[item.id] = body.removedAt; else removeMap(next.readingSuppressions, item.id); }
    else if (item.kind === 'readingExpired') { if (body) next.readingExpiredIds[item.id] = body.expiredAt; else removeMap(next.readingExpiredIds, item.id); }
    else if (item.kind === 'idea') {
      const old = next.ideas.find((value: JsonObject) => value.id === item.id) || next.ideasTrash.find((entry: JsonObject) => entry.idea.id === item.id)?.idea;
      const value = body ? { ...body, revision: (old?.revision || 0) + 1 } : null;
      next.ideas = replace(next.ideas, item.id, null); next.ideasTrash = next.ideasTrash.filter((entry: JsonObject) => entry.idea.id !== item.id);
      if (value && !item.deletedAt) next.ideas.push(value);
      else { if (!next.ideasRemovedIds.includes(item.id)) next.ideasRemovedIds.push(item.id); if (value && Date.parse(item.expiresAt!) > Date.now()) next.ideasTrash.push({ idea: value, deletedAt: item.deletedAt, expiresAt: item.expiresAt }); }
    } else if (item.kind === 'ideaRemoved') { next.ideasRemovedIds = next.ideasRemovedIds.filter((key: string) => key !== item.id); if (body) next.ideasRemovedIds.push(item.id); }
    else if (item.kind === 'learning') {
      const old = next.learningPlans.find((value: JsonObject) => value.id === item.id) || next.learningTrash.find((entry: JsonObject) => entry.plan.id === item.id)?.plan;
      const value = body ? { ...body, revision: (old?.revision || 0) + 1 } : null;
      next.learningPlans = replace(next.learningPlans, item.id, null); next.learningTrash = next.learningTrash.filter((entry: JsonObject) => entry.plan.id !== item.id);
      if (value && !item.deletedAt) next.learningPlans.push(value); else if (value && Date.parse(item.expiresAt!) > Date.now()) next.learningTrash.push({ plan: value, removedAt: item.deletedAt, expiresAt: item.expiresAt });
    }
  }
  const seenSources = new Map<string, string>();
  const touchedSources = new Set(records.filter(item => item.kind === 'reading' && item.body?.url).map(item => canonicalReadingSource(item.body!.url as string)));
  // A reviewed canonical item can coexist with another identity's recoverable
  // notes. Only duplicate live shelf entries would obscure the canonical item.
  for (const value of next.readingItems) {
    const key = value.sourceKey || (value.url ? canonicalReadingSource(value.url) : ''); if (!key) continue;
    if (touchedSources.has(key) && seenSources.has(key) && seenSources.get(key) !== value.id) throw new PersonalError('相同来源已有另一条书架记录，请先核对并合并；本机内容未改动。', 409);
    seenSources.set(key, value.id);
  }
  if (next.todos.length > 5000 || next.readingItems.length > 5000) fail();
  validateSavedReading(next); loadIdeas(next); loadIdeasTrash(next); loadIdeasRemovedIds(next, next.ideasTrash); loadLearningData(next);
  rememberAppliedTombstones(next, records, PERSONAL_SYNC_KINDS);
  return next as T;
}

export function projectGarden(data: JsonObject): ProjectedRecord[] {
  const present = new Set([...data.projects, ...data.projectTrash.map((entry: JsonObject) => entry.item)].map((item: JsonObject) => item.id));
  return withSyncTombstones([...data.metadata.map((item: JsonObject) => record('ideaMeta', item)), ...data.projects.map((item: JsonObject) => record('gardenProject', item)), ...data.projectTrash.map((entry: JsonObject) => record('gardenProject', entry.item, { deletedAt: entry.deletedAt, expiresAt: entry.expiresAt })), ...data.expiredIds.filter((key: string) => !present.has(key)).map((key: string) => ({ kind: 'gardenProject', id: key, body: null }))], data.syncTombstones, GARDEN_SYNC_KINDS);
}
export function applyGarden<T extends JsonObject>(data: T, input: unknown): T {
  const records = validateProjectedRecords(input, GARDEN_SYNC_KINDS); const next: JsonObject = structuredClone(data);
  const previousRecords = new Map(projectGarden(data).map(value => [`${value.kind}\0${value.id}`, value]));
  for (const item of records) {
    if (stable(previousRecords.get(`${item.kind}\0${item.id}`)) === stable(item)) continue;
    const body = item.body as JsonObject | null;
    if (item.kind === 'ideaMeta') {
      const previous = next.metadata.find((value: JsonObject) => value.id === item.id);
      next.metadata = replace(next.metadata, item.id, body ? { ...(previous || { drafts: [], conversations: [] }), ...body, sources: body.sources.map((source: JsonObject) => retainLocalSource(source, previous?.sources?.find((old: JsonObject) => old.id === source.id))), revision: (previous?.revision || 0) + 1 } : null);
    } else {
      const previous = next.projects.find((value: JsonObject) => value.id === item.id) || next.projectTrash.find((entry: JsonObject) => entry.item.id === item.id)?.item;
      next.projects = replace(next.projects, item.id, null); next.projectTrash = next.projectTrash.filter((entry: JsonObject) => entry.item.id !== item.id);
      if (body) {
        const sourceSnapshot = retainLocalSource(body.sourceSnapshot, previous?.sourceSnapshot);
        const value = { ...(previous || {}), ...body, sourceSnapshot, revision: (previous?.revision || 0) + 1 };
        if (!item.deletedAt) next.projects.push(value); else if (Date.parse(item.expiresAt!) > Date.now()) next.projectTrash.push({ item: value, deletedAt: item.deletedAt, expiresAt: item.expiresAt }); else if (!next.expiredIds.includes(item.id)) next.expiredIds.push(item.id);
      } else if (!next.expiredIds.includes(item.id)) next.expiredIds.push(item.id);
    }
  }
  if (next.metadata.length > 5000 || next.projects.length + next.projectTrash.length > 2000) fail();
  unique([...next.metadata, ...next.projects, ...next.projectTrash.map((entry: JsonObject) => entry.item)].map((value: JsonObject) => value.id));
  rememberAppliedTombstones(next, records, GARDEN_SYNC_KINDS);
  return next as T;
}

export function projectJournal(data: JsonObject): ProjectedRecord[] {
  const present = new Set([...data.entries, ...data.trash.map((entry: JsonObject) => entry.entry)].map((item: JsonObject) => item.date));
  return withSyncTombstones([...data.entries.map((item: JsonObject) => record('journal', item)), ...data.trash.map((entry: JsonObject) => record('journal', entry.entry, { deletedAt: entry.deletedAt, expiresAt: entry.expiresAt })), ...data.deletedDates.map((key: string) => scalar('journalSuppression', key, { deleted: true })), ...data.deletedDates.filter((key: string) => !present.has(key)).map((key: string) => ({ kind: 'journal', id: key, body: null }))], data.syncTombstones, JOURNAL_SYNC_KINDS);
}
export function applyJournal<T extends JsonObject>(data: T, input: unknown): T {
  const records = validateProjectedRecords(input, JOURNAL_SYNC_KINDS); const next: JsonObject = structuredClone(data);
  const previousRecords = new Map(projectJournal(data).map(value => [`${value.kind}\0${value.id}`, value]));
  for (const item of records) {
    if (stable(previousRecords.get(`${item.kind}\0${item.id}`)) === stable(item)) continue;
    const body = item.body as JsonObject | null;
    if (item.kind === 'journal') {
      next.entries = replace(next.entries, item.id, null, 'date'); next.trash = next.trash.filter((entry: JsonObject) => entry.entry.date !== item.id);
      if (body || !next.deletedDates.includes(item.id)) next.revisions[item.id] = Math.max(1, (next.revisions[item.id] || 0) + 1);
      const value = body ? { ...body, revision: next.revisions[item.id] } : null;
      if (value && !item.deletedAt) { next.entries.push(value); next.deletedDates = next.deletedDates.filter((key: string) => key !== item.id); }
      else { if (!next.deletedDates.includes(item.id)) next.deletedDates.push(item.id); if (value && Date.parse(item.expiresAt!) > Date.now()) next.trash.push({ entry: value, deletedAt: item.deletedAt, expiresAt: item.expiresAt }); }
    } else if (body) { if (!next.entries.some((entry: JsonObject) => entry.date === item.id)) { if (!next.deletedDates.includes(item.id)) next.deletedDates.push(item.id); next.revisions[item.id] = Math.max(1, next.revisions[item.id] || 0); } }
    else next.deletedDates = next.deletedDates.filter((key: string) => key !== item.id);
  }
  if (next.entries.length + next.trash.length > 50000) fail();
  const values = [...next.entries, ...next.trash.map((entry: JsonObject) => entry.entry)]; unique(values.map((value: JsonObject) => value.date)); unique(next.deletedDates);
  for (const value of values) if (next.revisions[value.date] !== value.revision) fail();
  for (const key of next.deletedDates) { date(key); integer(next.revisions[key]); }
  if (next.entries.some((entry: JsonObject) => next.deletedDates.includes(entry.date)) || next.trash.some((entry: JsonObject) => !next.deletedDates.includes(entry.entry.date))) fail();
  rememberAppliedTombstones(next, records, JOURNAL_SYNC_KINDS);
  return next as T;
}
