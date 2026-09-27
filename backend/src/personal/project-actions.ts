import { createHash, randomUUID } from 'node:crypto';
import { PersonalError, type PersonalTodo, type ProjectNextAction, type ProjectActionStatus } from './types';

export interface ActionProject {
  id: string;
  title: string;
  threads: { id: string; title: string; url: string }[];
}
const statuses = ['active', 'blocked', 'paused', 'done'];
export function actionFields(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new PersonalError('请求包含无效字段');
  return value as Record<string, unknown>;
}
function text(value: unknown, limit: number, message: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit || /\u0000/.test(value)) throw new PersonalError(message);
  return value.trim();
}
export function actionDate(value: unknown): string | null {
  if (value === null || value === '' || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new PersonalError('到期日期无效');
  return value;
}
function selectedThread(value: unknown, project: ActionProject): ProjectNextAction['thread'] {
  if (value === null || value === undefined || value === '') return undefined;
  const thread = project.threads.find(item => item.id === value);
  if (!thread) throw new PersonalError('请选择这个项目已读取的对话，或刷新项目后重试');
  return { id: thread.id, title: thread.title, url: `codex://threads/${encodeURIComponent(thread.id)}` };
}
export function actionRevision(value: unknown, current: ProjectNextAction): void {
  if (!Number.isSafeInteger(value) || value !== current.revision) throw new PersonalError('下一步行动已变化，请刷新后重试', 409);
}
export function projectActionRequest(value: unknown) {
  const body = actionFields(value, ['title', 'acceptance', 'threadId', 'dueDate', 'requestId']);
  if ('requestId' in body && (typeof body.requestId !== 'string' || !/^[A-Za-z0-9-]{16,100}$/.test(body.requestId))) throw new PersonalError('行动请求标识无效');
  if (body.threadId !== undefined && body.threadId !== null && typeof body.threadId !== 'string') throw new PersonalError('请选择这个项目已读取的对话，或刷新项目后重试');
  const title = text(body.title, 200, '行动标题应为 1–200 个字符');
  const acceptance = text(body.acceptance, 2000, '请填写验收条件（最多 2000 字符）');
  const dueDate = actionDate(body.dueDate);
  return { title, acceptance, dueDate, threadId: (body.threadId || null) as string | null, requestId: body.requestId as string | undefined,
    requestFingerprint: createHash('sha256').update(JSON.stringify([title, acceptance, body.threadId || null, dueDate])).digest('hex') };
}
export function createProjectAction(project: ActionProject, value: unknown): ProjectNextAction {
  const body = projectActionRequest(value);
  const now = new Date().toISOString();
  const action: ProjectNextAction = {
    id: randomUUID(), projectId: project.id, projectTitle: project.title,
    title: body.title, acceptance: body.acceptance,
    thread: selectedThread(body.threadId, project), dueDate: body.dueDate,
    status: 'active', reason: '', result: '', createdAt: now, updatedAt: now, revision: 1, completions: [],
    ...(body.requestId ? { requestId: body.requestId as string } : {}),
  };
  if (action.requestId) action.requestFingerprint = body.requestFingerprint;
  return action;
}
export function updateProjectAction(current: ProjectNextAction, value: unknown, project: ActionProject): ProjectNextAction {
  const body = actionFields(value, ['revision', 'title', 'acceptance', 'threadId', 'dueDate', 'status', 'reason', 'result']);
  actionRevision(body.revision, current);
  const next = structuredClone(current);
  if ('title' in body) next.title = text(body.title, 200, '行动标题应为 1–200 个字符');
  if ('acceptance' in body) next.acceptance = text(body.acceptance, 2000, '请填写验收条件（最多 2000 字符）');
  if ('threadId' in body) next.thread = selectedThread(body.threadId, project);
  if ('dueDate' in body) next.dueDate = actionDate(body.dueDate);
  if ('status' in body) {
    if (typeof body.status !== 'string' || !statuses.includes(body.status)) throw new PersonalError('行动状态无效');
    next.status = body.status as ProjectActionStatus;
  }
  if (next.status === 'blocked' || next.status === 'paused') {
    next.reason = text('reason' in body ? body.reason : next.reason, 2000, '请填写暂停或受阻的原因（最多 2000 字符）');
  } else {
    if ('reason' in body && body.reason !== '') throw new PersonalError('只有暂停或受阻的行动可以填写原因');
    next.reason = '';
  }
  const now = new Date().toISOString();
  if (next.status === 'done' && current.status !== 'done') {
    next.result = text(body.result, 4000, '请记录本次完成结果（最多 4000 字符）');
    next.completedAt = now;
    next.currentResultId = randomUUID();
    next.completions.push({ id: next.currentResultId, result: next.result, completedAt: now });
  } else if ('result' in body) {
    // Accepted evidence is immutable. Reopen and complete again to add a new result.
    if (body.result !== current.result) throw new PersonalError('完成结果已保留；请重新打开行动后记录新的完成结果');
  }
  if (next.status !== 'done') delete next.completedAt;
  next.projectTitle = project.title;
  next.revision++;
  next.updatedAt = now;
  return next;
}
export function actionTodoSource(action: ProjectNextAction, available: boolean): NonNullable<PersonalTodo['source']> {
  return { kind: 'project_action', id: action.id, projectId: action.projectId, title: action.projectTitle, url: action.thread?.url || '', available, linked: true, acceptance: action.acceptance, status: action.status, result: action.result, reason: action.reason, revision: action.revision };
}
export function loadProjectActions(value: unknown): ProjectNextAction[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => !item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.projectId !== 'string' || typeof item.title !== 'string' || typeof item.acceptance !== 'string' || !statuses.includes(item.status) || !Number.isSafeInteger(item.revision) || item.revision < 1 || !Array.isArray(item.completions) || item.completions.some((entry: any) => typeof entry?.result !== 'string' || typeof entry?.completedAt !== 'string')) || new Set(value.map(item => item.id)).size !== value.length) throw new Error('Project action data is invalid. Restore a backup before starting.');
  return (value as ProjectNextAction[]).map(action => {
    const completions = action.completions.map((entry, index) => ({ ...entry, id: entry.id || createHash('sha256').update(JSON.stringify([action.id, index, entry.completedAt, entry.result])).digest('hex').slice(0, 32) }));
    const currentResultId = action.currentResultId || [...completions].reverse().find(entry => action.result && entry.result === action.result)?.id;
    return { ...action, completions, ...(currentResultId ? { currentResultId } : {}) };
  });
}
