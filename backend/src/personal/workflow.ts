import { PersonalError, type WorkflowItem } from './types';

type WorkflowContent = Pick<WorkflowItem, 'title' | 'url' | 'kind' | 'track' | 'status' | 'notes' | 'excerpt' | 'nextAction' | 'resumeAt' | 'question'>;
const KINDS = ['idea', 'video', 'paper', 'course', 'project', 'article'];
const TRACKS = ['coursework', 'aiml', 'swe', 'game', 'quant', 'research', 'other'];
const STATUSES = ['inbox', 'active', 'parked', 'done', 'archived'];
const TEXT_RULES = {
  title: { max: 200, message: '工作流标题应为 1–200 个字符' },
  notes: { max: 12000, message: '工作流笔记应为不超过 12000 个字符的文本' },
  excerpt: { max: 18000, message: '材料摘录应为不超过 18000 个字符的文本' },
  nextAction: { max: 200, message: '下一步行动应为不超过 200 个字符的文本' },
  resumeAt: { max: 200, message: '继续位置应为不超过 200 个字符的文本' },
  question: { max: 2000, message: '当前问题应为不超过 2000 个字符的文本' },
} as const;
const CONTENT_KEYS = [...Object.keys(TEXT_RULES), 'url', 'kind', 'track', 'status'];

export function workflowUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u001f\u007f]/.test(value)) throw new PersonalError('工作流链接应为不超过 2000 个字符且不含凭据的 HTTP 或 HTTPS 地址');
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (!/^https?:\/\//i.test(trimmed) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    // Preserve the entered URL: encoding a long Unicode path could exceed the
    // content limit and would otherwise make a later unmodified edit fail.
    return trimmed;
  } catch { throw new PersonalError('工作流链接应为不超过 2000 个字符且不含凭据的 HTTP 或 HTTPS 地址'); }
}

export function workflowContent(body: Record<string, unknown>, current?: WorkflowItem): WorkflowContent {
  if (Object.keys(body).some(key => !CONTENT_KEYS.includes(key))) throw new PersonalError('请求包含不支持的字段');
  const content: WorkflowContent = current ? {
    title: current.title, url: current.url, kind: current.kind, track: current.track, status: current.status,
    notes: current.notes, excerpt: current.excerpt, nextAction: current.nextAction, resumeAt: current.resumeAt, question: current.question,
  } : { title: '', url: '', kind: 'idea', track: 'other', status: 'inbox', notes: '', excerpt: '', nextAction: '', resumeAt: '', question: '' };
  for (const key of Object.keys(TEXT_RULES) as (keyof typeof TEXT_RULES)[]) {
    if (!(key in body)) continue;
    const value = body[key];
    const { max, message } = TEXT_RULES[key];
    if (typeof value !== 'string' || value.length > max || (key === 'title' && !value.trim())) throw new PersonalError(message);
    content[key] = value.trim();
  }
  if (!content.title) throw new PersonalError(TEXT_RULES.title.message);
  if ('url' in body) content.url = workflowUrl(body.url);
  if ('kind' in body) {
    if (typeof body.kind !== 'string' || !KINDS.includes(body.kind)) throw new PersonalError('请选择有效的工作流类型');
    content.kind = body.kind as WorkflowItem['kind'];
  }
  if ('track' in body) {
    if (typeof body.track !== 'string' || !TRACKS.includes(body.track)) throw new PersonalError('请选择有效的工作流方向');
    content.track = body.track as WorkflowItem['track'];
  }
  if ('status' in body) {
    if (typeof body.status !== 'string' || !STATUSES.includes(body.status)) throw new PersonalError('请选择有效的工作流状态');
    content.status = body.status as WorkflowItem['status'];
  }
  return content;
}
