export type Direction = { title: string; goal: string; mvp: string[]; assumptions: string[]; risks: string[]; acceptance: string[]; firstStep: string };
export type InspirationDraft = { id: string; purpose: 'directions' | 'mvp' | 'feasibility'; context: string; sourceIds: string[]; directions: Direction[]; model: string; createdAt: string; updatedAt: string };
export type Bubble = { id: string; title: string; body: string; tags: string[]; pinned: boolean; status: 'active' | 'archived'; sources: { id: string; title: string; body: string; updatedAt: string }[]; projectId?: string; drafts: InspirationDraft[]; createdAt: string; updatedAt: string; revision: number };
export type InspirationState = { items: Bubble[]; trashCount: number; ai: { configured: boolean; model: string; provider: 'ollama'; message: string } };
export type TrashRecord<T> = { item: T; deletedAt: string; expiresAt: string };
export type Project = { id: string; title: string; goal: string; mvp: string[]; acceptance: string[]; nextStep: string; nextStepId: string; sourceBubbleId: string; sourceSnapshot: { id: string; title: string; body: string; updatedAt: string }; draftId?: string; status: 'active' | 'done' | 'archived'; createdAt: string; updatedAt: string; revision: number; todoId?: string; finishedAt?: string };
export const lines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);
export const tags = (value: string) => [...new Set(value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))];

/** The user can cancel a long provider request without discarding their inputs. */
export async function brainstorm(id: string, body: unknown, signal: AbortSignal): Promise<InspirationDraft> {
  const english = document.documentElement.lang === 'en';
  const response = await fetch(`/api/personal/inspiration/${encodeURIComponent(id)}/brainstorm`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Accept-Language': english ? 'en' : 'zh-CN' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || (english ? 'Unable to generate directions. Try again.' : '暂时无法生成方向，请重试。'));
  return data as InspirationDraft;
}
