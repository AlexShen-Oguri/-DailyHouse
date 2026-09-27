import { createHash, randomUUID } from 'node:crypto';
import { PersonalError, type Idea, type IdeaEntry, type IdeaEntryKind, type IdeaStatus, type IdeaSummary, type IdeaTrashEntry } from './types';

const STATUSES: IdeaStatus[] = ['growing', 'parked', 'done'];
const KINDS: IdeaEntryKind[] = ['initial', 'note', 'progress', 'decision', 'question'];
const MAX_CONTENT = 20000;
const MAX_ITEMS = 5000;
export const IDEAS_TRASH_MS = 30 * 24 * 60 * 60 * 1000;

function request(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PersonalError('请求内容必须是一个对象');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !keys.includes(key))) throw new PersonalError('请求包含不支持的字段');
  return body;
}

function title(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) throw new PersonalError('想法标题应为 1–200 个字符');
  return value.trim();
}

function content(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_CONTENT) throw new PersonalError('想法记录应为 1–20000 个字符');
  return value.trim();
}

function kind(value: unknown): IdeaEntryKind {
  if (!KINDS.includes(value as IdeaEntryKind)) throw new PersonalError('请选择有效的记录类型');
  return value as IdeaEntryKind;
}

function status(value: unknown): IdeaStatus {
  if (!STATUSES.includes(value as IdeaStatus)) throw new PersonalError('请选择有效的想法状态');
  return value as IdeaStatus;
}

function checkRevision(idea: Idea, value: unknown): void {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new PersonalError('请提供有效的想法版本');
  if (value !== idea.revision) throw new PersonalError('这个想法已在其他页面更新，请刷新后重试', 409);
}

// Keep append order and latest-update sorting stable even if the clock moves back.
function nextTime(idea: Idea): string { return new Date(Math.max(Date.now(), Date.parse(idea.updatedAt) + 1)).toISOString(); }

function changed(idea: Idea, fields: Partial<Idea>, now = nextTime(idea)): Idea {
  return { ...idea, ...fields, updatedAt: now, revision: idea.revision + 1 };
}

export function fixedIdeaId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new PersonalError('想法关联标识应为有效 UUID');
  return value.toLowerCase();
}

export function createIdea(value: unknown, count: number, id: string = randomUUID()): Idea {
  const body = request(value, ['title', 'content']);
  if (count >= MAX_ITEMS) throw new PersonalError('想法已达到 5000 条，请先删除不需要的想法');
  const now = new Date().toISOString();
  return { id, title: title(body.title), status: 'growing', createdAt: now, updatedAt: now, revision: 1,
    entries: [{ id: randomUUID(), kind: 'initial', content: content(body.content), createdAt: now, updatedAt: now }] };
}

export function updateIdea(idea: Idea, value: unknown): Idea {
  const body = request(value, ['title', 'status', 'revision']);
  checkRevision(idea, body.revision);
  if (!('title' in body) && !('status' in body)) throw new PersonalError('请选择要更新的想法内容');
  return changed(idea, { title: 'title' in body ? title(body.title) : idea.title, status: 'status' in body ? status(body.status) : idea.status });
}

export function checkIdeaDeletion(idea: Idea, value: unknown): void {
  checkRevision(idea, request(value, ['revision']).revision);
}

export function restoreIdeaSnapshot(entry: IdeaTrashEntry, value: unknown, count: number): Idea {
  request(value, []);
  if (Date.parse(entry.expiresAt) <= Date.now()) throw new PersonalError('这个想法已超过 30 天恢复期限', 410);
  if (count >= MAX_ITEMS) throw new PersonalError('想法已达到 5000 条，请先删除不需要的想法');
  return changed(entry.idea, {});
}

export function appendIdeaEntry(idea: Idea, value: unknown): Idea {
  const body = request(value, ['content', 'kind', 'revision']);
  checkRevision(idea, body.revision);
  const entryKind = kind(body.kind);
  if (entryKind === 'initial') throw new PersonalError('初始想法只能在创建时添加');
  if (idea.entries.length >= MAX_ITEMS) throw new PersonalError('这个想法已达到 5000 条记录，请先删除不需要的记录');
  const now = nextTime(idea);
  const entry: IdeaEntry = { id: randomUUID(), kind: entryKind, content: content(body.content), createdAt: now, updatedAt: now };
  return changed(idea, { entries: [...idea.entries, entry] }, now);
}

export function updateIdeaEntry(idea: Idea, id: string, value: unknown): Idea {
  const body = request(value, ['content', 'kind', 'revision']);
  checkRevision(idea, body.revision);
  const entry = idea.entries.find(item => item.id === id);
  if (!entry) throw new PersonalError('这条想法记录不存在', 404);
  const entryKind = 'kind' in body ? kind(body.kind) : entry.kind;
  if ((entry.kind === 'initial') !== (entryKind === 'initial')) throw new PersonalError('不能更改初始想法的记录类型');
  const now = nextTime(idea);
  const updated = { ...entry, content: content(body.content), kind: entryKind, updatedAt: now };
  return changed(idea, { entries: idea.entries.map(item => item.id === id ? updated : item) }, now);
}

export function removeIdeaEntry(idea: Idea, id: string, value: unknown): Idea {
  checkIdeaDeletion(idea, value);
  const entry = idea.entries.find(item => item.id === id);
  if (!entry) throw new PersonalError('这条想法记录不存在', 404);
  if (entry.kind === 'initial') throw new PersonalError('初始记录不能单独删除，可以删除整个想法');
  return changed(idea, { entries: idea.entries.filter(item => item.id !== id) });
}

export function ideaSummary(idea: Idea): IdeaSummary {
  const { entries, ...summary } = idea;
  return { ...summary, preview: entries.at(-1)!.content.replace(/\s+/g, ' ').slice(0, 180), entryCount: entries.length };
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function savedIdeas(value: unknown): Idea[] {
  const invalid = () => { throw new Error('Personal workbench idea data is invalid; restore its backup before starting.'); };
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return invalid();
  const ids = new Set<string>();
  for (const idea of value) {
    if (!record(idea) || typeof idea.id !== 'string' || !idea.id || ids.has(idea.id) || typeof idea.title !== 'string' || !idea.title.trim() || idea.title.length > 200 || !STATUSES.includes(idea.status as IdeaStatus) || !Number.isSafeInteger(idea.revision) || (idea.revision as number) < 1 || !timestamp(idea.createdAt) || !timestamp(idea.updatedAt) || !Array.isArray(idea.entries) || !idea.entries.length || idea.entries.length > MAX_ITEMS) return invalid();
    ids.add(idea.id);
    const entryIds = new Set<string>();
    for (const [index, entry] of idea.entries.entries()) {
      if (!record(entry) || typeof entry.id !== 'string' || !entry.id || entryIds.has(entry.id) || !KINDS.includes(entry.kind as IdeaEntryKind) || (entry.kind === 'initial') !== (index === 0) || typeof entry.content !== 'string' || !entry.content.trim() || entry.content.length > MAX_CONTENT || !timestamp(entry.createdAt) || !timestamp(entry.updatedAt)) return invalid();
      entryIds.add(entry.id);
    }
  }
  return structuredClone(value as Idea[]);
}

function migrateWorkflow(value: unknown): Idea[] {
  if (!Array.isArray(value)) return [];
  return value.filter(record).map((legacy, index) => {
    const rawTitle = typeof legacy.title === 'string' && legacy.title.trim() ? legacy.title.trim() : `旧想法 ${index + 1}`;
    const pieces: string[] = rawTitle.length > 200 ? [`原始标题：${rawTitle}`] : [];
    for (const [key, label] of [['notes', '笔记'], ['excerpt', '摘录'], ['nextAction', '下一步'], ['resumeAt', '继续位置'], ['question', '问题'], ['url', '来源'], ['track', '方向'], ['kind', '类型']] as const) {
      if (typeof legacy[key] === 'string' && legacy[key].trim()) pieces.push(`${label}：${legacy[key]}`);
    }
    const text = pieces.join('\n\n') || rawTitle;
    const id = `legacy-${createHash('sha256').update(`${index}:${JSON.stringify(legacy)}`).digest('hex').slice(0, 24)}`;
    if (!timestamp(legacy.createdAt) || !timestamp(legacy.updatedAt)) throw new Error('Legacy workbench idea timestamps are invalid; restore its backup before starting.');
    const createdAt = legacy.createdAt;
    const updatedAt = legacy.updatedAt;
    const entries: IdeaEntry[] = [];
    for (let offset = 0; offset < text.length; offset += MAX_CONTENT) {
      const chunk = text.slice(offset, offset + MAX_CONTENT);
      if (chunk.trim()) entries.push({ id: `${id}-${entries.length}`, kind: entries.length ? 'note' : 'initial', content: chunk, createdAt, updatedAt });
    }
    return { id, title: rawTitle.slice(0, 200), status: legacy.status === 'done' ? 'done' : legacy.status === 'parked' || legacy.status === 'archived' ? 'parked' : 'growing', createdAt, updatedAt, revision: 1, entries };
  });
}

export function loadIdeas(saved: Record<string, unknown>): Idea[] {
  // Once present (including []), this field wins over retained legacy data so a
  // deleted imported idea cannot return on the next restart.
  return Object.hasOwn(saved, 'ideas') ? savedIdeas(saved.ideas) : migrateWorkflow(saved.workflowItems);
}

export function loadIdeasTrash(saved: Record<string, unknown>): IdeaTrashEntry[] {
  if (!Object.hasOwn(saved, 'ideasTrash')) return [];
  const invalid = () => { throw new Error('Personal workbench idea trash is invalid; restore its backup before starting.'); };
  if (!Array.isArray(saved.ideasTrash)) return invalid();
  const ids = new Set<string>();
  for (const entry of saved.ideasTrash) {
    if (!record(entry) || !timestamp(entry.deletedAt) || !timestamp(entry.expiresAt) || Date.parse(entry.expiresAt) <= Date.parse(entry.deletedAt)) return invalid();
    const idea = savedIdeas([entry.idea])[0];
    if (ids.has(idea.id)) return invalid();
    ids.add(idea.id);
  }
  return structuredClone(saved.ideasTrash as IdeaTrashEntry[]);
}

export function loadIdeasRemovedIds(saved: Record<string, unknown>, trash: IdeaTrashEntry[]): string[] {
  const value = Object.hasOwn(saved, 'ideasRemovedIds') ? saved.ideasRemovedIds : [];
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id.trim() || id.length > 500)) throw new Error('Personal workbench deleted idea IDs are invalid; restore its backup before starting.');
  return [...new Set([...value as string[], ...trash.map(entry => entry.idea.id)])];
}
