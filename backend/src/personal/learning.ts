import { randomUUID } from 'node:crypto';
import { PersonalError } from './types';

export type LearningStatus = 'active' | 'paused' | 'done';
export type LearningKind = 'initial' | 'progress' | 'question' | 'milestone' | 'resource';
export type LearningLink = { id: string; title: string; url: string };
export type LearningEntry = { id: string; kind: LearningKind; content: string; links: LearningLink[]; nextStep: string; nextStepId: string; createdAt: string; updatedAt: string; removedAt?: string; expiresAt?: string };
export type LearningPlan = { id: string; title: string; course: string; goal: string; nextStep: string; nextStepId: string; dueDate: string | null; status: LearningStatus; createdAt: string; updatedAt: string; revision: number; entries: LearningEntry[] };
export type LearningTrash = { plan: LearningPlan; removedAt: string; expiresAt: string };
export const LEARNING_TRASH_MS = 30 * 86400_000;
const kinds: LearningKind[] = ['initial', 'progress', 'question', 'milestone', 'resource'];
const statuses: LearningStatus[] = ['active', 'paused', 'done'];
const uid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && /T.*Z$/.test(value);

export function learningBody(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PersonalError('学习请求内容必须是一个对象');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !keys.includes(key))) throw new PersonalError('学习请求包含不支持的字段');
  return body;
}
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new PersonalError(`学习内容长度无效（最多 ${max} 字符）`);
  return value.trim();
}
export function learningDate(value: unknown): string | null {
  if (value === undefined || value === '' || value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new PersonalError('学习计划日期无效');
  return value;
}
function link(value: unknown): LearningLink {
  const body = learningBody(value, ['id', 'title', 'url']);
  const url = text(body.url, 2048, true);
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new PersonalError('资料链接应为完整的 HTTP 或 HTTPS 地址'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new PersonalError('资料链接应为完整的 HTTP 或 HTTPS 地址');
  if (body.id !== undefined && !uid(body.id)) throw new PersonalError('资料链接标识无效');
  return { id: typeof body.id === 'string' ? body.id : randomUUID(), title: text(body.title ?? '', 200) || parsed.hostname.slice(0, 200), url: text(parsed.href, 2048, true) };
}
function links(value: unknown): LearningLink[] {
  if (!Array.isArray(value) || value.length > 20) throw new PersonalError('每条学习记录最多添加 20 个资料链接');
  const result = value.map(link);
  if (new Set(result.map(item => item.id)).size !== result.length) throw new PersonalError('资料链接标识不能重复');
  return result;
}
export function checkLearningRevision(plan: LearningPlan, value: unknown): void {
  if (!Number.isSafeInteger(value) || value !== plan.revision) throw new PersonalError('学习计划已更新，请刷新并核对草稿后重试', 409);
}
function changed(plan: LearningPlan, fields: Partial<LearningPlan>): LearningPlan {
  return { ...plan, ...fields, revision: plan.revision + 1, updatedAt: new Date(Math.max(Date.now(), Date.parse(plan.updatedAt) + 1)).toISOString() };
}
export function createLearning(value: unknown, count: number): LearningPlan {
  const body = learningBody(value, ['title', 'course', 'goal', 'nextStep', 'dueDate']);
  if (count >= 5000) throw new PersonalError('学习计划已达到 5000 条');
  const now = new Date().toISOString();
  const title = text(body.title, 200, true), goal = text(body.goal ?? '', 4000);
  return { id: randomUUID(), title, course: text(body.course ?? '', 200), goal, nextStep: text(body.nextStep ?? '', 200), nextStepId: randomUUID(), dueDate: learningDate(body.dueDate), status: 'active', createdAt: now, updatedAt: now, revision: 1,
    entries: [{ id: randomUUID(), kind: 'initial', content: goal || title, links: [], nextStep: '', nextStepId: randomUUID(), createdAt: now, updatedAt: now }] };
}
export function updateLearning(plan: LearningPlan, value: unknown): LearningPlan {
  const body = learningBody(value, ['revision', 'title', 'course', 'goal', 'nextStep', 'dueDate', 'status']);
  checkLearningRevision(plan, body.revision);
  const fields: Partial<LearningPlan> = {};
  for (const [key, max, required] of [['title', 200, true], ['course', 200, false], ['goal', 4000, false], ['nextStep', 200, false]] as const) if (key in body) fields[key] = text(body[key], max, required);
  if (fields.nextStep !== undefined && fields.nextStep !== plan.nextStep) fields.nextStepId = randomUUID();
  if ('dueDate' in body) fields.dueDate = learningDate(body.dueDate);
  if ('status' in body) { if (!statuses.includes(body.status as LearningStatus)) throw new PersonalError('学习计划状态无效'); fields.status = body.status as LearningStatus; }
  if (!Object.keys(fields).length) throw new PersonalError('请选择要更新的学习内容');
  return changed(plan, fields);
}
export function updateLearningEntry(plan: LearningPlan, value: unknown, entryId?: string): LearningPlan {
  const body = learningBody(value, ['revision', 'kind', 'content', 'links', 'nextStep']);
  checkLearningRevision(plan, body.revision);
  const previous = entryId ? plan.entries.find(item => item.id === entryId && !item.removedAt) : undefined;
  if (entryId && !previous) throw new PersonalError('这条学习记录不存在或已移除', 404);
  const kind = body.kind as LearningKind;
  if (!kinds.includes(kind) || (kind === 'initial' && previous?.kind !== 'initial')) throw new PersonalError('学习记录类型无效');
  const content = text(body.content ?? '', 20000), resources = links(body.links ?? []), nextStep = text(body.nextStep ?? '', 200);
  if (!content && !resources.length) throw new PersonalError('请填写学习记录或添加资料链接');
  if (!previous && plan.entries.length >= 5000) throw new PersonalError('这个计划已达到 5000 条记录');
  if (resources.some(item => plan.entries.some(entry => entry.id !== entryId && entry.links.some(old => old.id === item.id)))) throw new PersonalError('资料链接标识不能复用其他记录');
  const now = new Date(Math.max(Date.now(), Date.parse(plan.updatedAt) + 1)).toISOString();
  const entry: LearningEntry = { id: previous?.id ?? randomUUID(), kind, content, links: resources, nextStep, nextStepId: previous && previous.nextStep === nextStep ? previous.nextStepId : randomUUID(), createdAt: previous?.createdAt ?? now, updatedAt: now };
  return changed(plan, { entries: previous ? plan.entries.map(item => item.id === entryId ? entry : item) : [...plan.entries, entry] });
}
export function removeLearningEntry(plan: LearningPlan, entryId: string, value: unknown): LearningPlan {
  const body = learningBody(value, ['revision', 'confirmed']); checkLearningRevision(plan, body.revision);
  if (body.confirmed !== true) throw new PersonalError('请确认移除学习记录；计划与待办会保留');
  if (!plan.entries.some(item => item.id === entryId && !item.removedAt)) throw new PersonalError('这条学习记录不存在或已移除', 404);
  const removedAt = new Date().toISOString(), expiresAt = new Date(Date.now() + LEARNING_TRASH_MS).toISOString();
  return changed(plan, { entries: plan.entries.map(item => item.id === entryId ? { ...item, removedAt, expiresAt } : item) });
}
export function restoreLearningEntry(plan: LearningPlan, entryId: string, value: unknown): LearningPlan {
  const body = learningBody(value, ['revision']); checkLearningRevision(plan, body.revision);
  const entry = plan.entries.find(item => item.id === entryId && item.removedAt && Date.parse(item.expiresAt!) > Date.now());
  if (!entry) throw new PersonalError('学习记录已不存在或超过 30 天恢复期限', 404);
  const { removedAt: _removed, expiresAt: _expires, ...restored } = entry;
  return changed(plan, { entries: plan.entries.map(item => item.id === entryId ? restored : item) });
}
export function learningDetail(plan: LearningPlan) {
  return { ...structuredClone(plan), entries: structuredClone(plan.entries.filter(item => !item.removedAt)), removedEntries: structuredClone(plan.entries.filter(item => item.removedAt && Date.parse(item.expiresAt!) > Date.now())) };
}
export function learningSummary(plan: LearningPlan) {
  const { entries, ...rest } = plan;
  const active = entries.filter(item => !item.removedAt);
  return { ...structuredClone(rest), entryCount: active.length, preview: active.at(-1)?.content.slice(0, 180) || '' };
}
export function expireLearning(plans: LearningPlan[]): LearningPlan[] {
  return plans.map(plan => ({ ...plan, entries: plan.entries.filter(item => !item.expiresAt || Date.parse(item.expiresAt) > Date.now()) }));
}
export function loadLearningData(saved: Record<string, unknown>): { learningPlans: LearningPlan[]; learningTrash: LearningTrash[] } {
  const invalid = () => { throw new Error('Saved learning plans are invalid; restore a backup before starting.'); };
  const load = (value: unknown): LearningPlan[] => {
    if (!Array.isArray(value) || value.length > 5000) return invalid();
    const seen = new Set<string>();
    for (const plan of value as LearningPlan[]) {
      if (!plan || !uid(plan.id) || seen.has(plan.id) || !statuses.includes(plan.status) || !Number.isSafeInteger(plan.revision) || plan.revision < 1 || !timestamp(plan.createdAt) || !timestamp(plan.updatedAt) || !uid(plan.nextStepId) || !Array.isArray(plan.entries) || plan.entries.length > 5000) return invalid();
      seen.add(plan.id);
      try { text(plan.title, 200, true); text(plan.course, 200); text(plan.goal, 4000); text(plan.nextStep, 200); learningDate(plan.dueDate); } catch { return invalid(); }
      const entryIds = new Set<string>();
      for (const entry of plan.entries) {
        if (!entry || !uid(entry.id) || entryIds.has(entry.id) || !kinds.includes(entry.kind) || !uid(entry.nextStepId) || !timestamp(entry.createdAt) || !timestamp(entry.updatedAt) || Boolean(entry.removedAt) !== Boolean(entry.expiresAt) || (entry.removedAt && (!timestamp(entry.removedAt) || !timestamp(entry.expiresAt)))) return invalid();
        entryIds.add(entry.id);
        try { text(entry.content, 20000); text(entry.nextStep, 200); links(entry.links); if (!entry.links.every(item => uid(item.id)) || (!entry.content && !entry.links.length)) return invalid(); } catch { return invalid(); }
      }
    }
    return structuredClone(value as LearningPlan[]);
  };
  const learningPlans = load(saved.learningPlans ?? []);
  const rawTrash = saved.learningTrash ?? [];
  if (!Array.isArray(rawTrash) || rawTrash.length > 5000) return invalid();
  const learningTrash = rawTrash.map((item: LearningTrash) => {
    if (!item || !timestamp(item.removedAt) || !timestamp(item.expiresAt)) return invalid();
    return { plan: load([item.plan])[0], removedAt: item.removedAt, expiresAt: item.expiresAt };
  });
  const ids = [...learningPlans, ...learningTrash.map(item => item.plan)].map(plan => plan.id);
  if (new Set(ids).size !== ids.length) return invalid();
  return { learningPlans, learningTrash };
}
