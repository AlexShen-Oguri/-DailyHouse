export type Direction = { title: string; goal: string; mvp: string[]; assumptions: string[]; risks: string[]; acceptance: string[]; firstStep: string };
export type InspirationDraft = { id: string; purpose: 'directions' | 'mvp' | 'feasibility'; context: string; sourceIds: string[]; directions: Direction[]; model: string; createdAt: string; updatedAt: string };
export type InspirationConversation = { id: string; sourceIds: string[]; model: string; messages: { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }[]; createdAt: string; updatedAt: string };
export type Bubble = { id: string; title: string; body: string; tags: string[]; pinned: boolean; status: 'active' | 'archived'; sources: { id: string; title: string; body: string; updatedAt: string }[]; projectId?: string; drafts: InspirationDraft[]; conversations?: InspirationConversation[]; createdAt: string; updatedAt: string; revision: number };
export type InspirationState = { items: Bubble[]; trashCount: number; ai: { configured: boolean; model: string; provider: 'ollama'; message: string; availability?: 'ready' | 'service_unavailable' | 'model_missing' | 'invalid_config' | 'check_failed' } };
export type TrashRecord<T> = { item: T; deletedAt: string; expiresAt: string };
export type Project = { id: string; title: string; goal: string; mvp: string[]; acceptance: string[]; nextStep: string; nextStepId: string; sourceBubbleId: string; sourceSnapshot: { id: string; title: string; body: string; updatedAt: string }; draftId?: string; status: 'active' | 'done' | 'archived'; createdAt: string; updatedAt: string; revision: number; todoId?: string; finishedAt?: string };
export const lines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);
export const tags = (value: string) => [...new Set(value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))];

export async function converse(id: string, body: unknown, signal: AbortSignal): Promise<InspirationConversation> {
  const english = document.documentElement.lang === 'en';
  const response = await fetch(`/api/personal/inspiration/${encodeURIComponent(id)}/conversations`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Accept-Language': english ? 'en' : 'zh-CN' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || (english ? 'Unable to continue this conversation. Your message is kept.' : '这次对话未能完成，你写的内容仍保留。'));
  return data as InspirationConversation;
}

/** The user can cancel a long provider request without discarding their inputs. */
export async function brainstorm(id: string, body: unknown, signal: AbortSignal): Promise<InspirationDraft> {
  const english = document.documentElement.lang === 'en';
  const response = await fetch(`/api/personal/inspiration/${encodeURIComponent(id)}/brainstorm`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Accept-Language': english ? 'en' : 'zh-CN' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || (english ? 'Unable to generate directions. Try again.' : '暂时无法生成方向，请重试。'));
  return data as InspirationDraft;
}

export function localModelName(model: string) { return /qwen/i.test(model) ? 'Qwen' : model || 'AI'; }
