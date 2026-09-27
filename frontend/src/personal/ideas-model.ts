import { useEffect, useState } from 'react';

export type IdeaStatus = 'growing' | 'parked' | 'done';
export type IdeaEntryKind = 'initial' | 'note' | 'progress' | 'decision' | 'question';
export type IdeaEntry = { id: string; kind: IdeaEntryKind; content: string; createdAt: string; updatedAt: string };
export type Idea = { id: string; title: string; status: IdeaStatus; createdAt: string; updatedAt: string; revision: number; entries: IdeaEntry[] };
export type IdeaSummary = Omit<Idea, 'entries'> & { preview: string; entryCount: number };
export type IdeaTrashSummary = IdeaSummary & { deletedAt: string; expiresAt: string };

export const ideaStatusNames: Record<IdeaStatus, [string, string]> = {
  growing: ['酝酿中', 'Growing'], parked: ['暂时搁置', 'On hold'], done: ['已成形', 'Developed'],
};
export const ideaKindNames: Record<IdeaEntryKind, [string, string]> = {
  initial: ['最初的想法', 'The first thought'], note: ['补充想法', 'Thought'], progress: ['进展', 'Progress'], decision: ['决定', 'Decision'], question: ['待想清的问题', 'Open question'],
};
export const entryKinds: Exclude<IdeaEntryKind, 'initial'>[] = ['note', 'progress', 'decision', 'question'];
export const newIdeaDraft = { title: '', content: '' };
export const detailIdeaDraft = { title: '', status: '', content: '', kind: 'note', editingId: '', editContent: '', editKind: 'note' };

// Keep drafts available across route changes even when browser storage is blocked.
const memoryDrafts = new Map<string, Record<string, string>>();
const draftEvent = 'dailyhouse-idea-draft-settled';
export function useIdeaDraft<T extends Record<string, string>>(key: string, initial: T) {
  const [snapshot] = useState(() => {
    let stored: unknown = memoryDrafts.get(key);
    let available = true;
    try { const raw = sessionStorage.getItem(key); if (raw && !stored) stored = JSON.parse(raw); }
    catch { available = false; }
    const value = { ...initial };
    if (stored && typeof stored === 'object') for (const field of Object.keys(initial)) {
      const candidate = (stored as Record<string, unknown>)[field];
      if (typeof candidate === 'string') (value as Record<string, string>)[field] = candidate;
    }
    return { value, available };
  });
  const [draft, setValue] = useState<T>(snapshot.value);
  const [storageAvailable, setStorageAvailable] = useState(snapshot.available);
  const dirty = Object.keys(initial).some(field => draft[field] !== initial[field]);
  function setDraft(next: T) {
    memoryDrafts.set(key, next);
    setValue(next);
    try { sessionStorage.setItem(key, JSON.stringify(next)); setStorageAvailable(true); }
    catch { setStorageAvailable(false); }
  }
  function clearDraft() {
    memoryDrafts.delete(key); setValue({ ...initial });
    try { sessionStorage.removeItem(key); } catch { setStorageAvailable(false); }
  }
  // A request may finish after navigating away. Clear only the fields it saved,
  // and never overwrite a newer draft started while that request was pending.
  function settleDraft(expected: Partial<T>, replacement: Partial<T> | null) {
    let current = memoryDrafts.get(key);
    try { if (!current) { const raw = sessionStorage.getItem(key); if (raw) current = JSON.parse(raw); } } catch { /* In-memory draft remains usable. */ }
    current ||= { ...initial };
    if (!Object.keys(expected).every(field => current?.[field] === expected[field])) return;
    const next = replacement === null ? { ...initial } : { ...current, ...replacement };
    let available = true;
    if (replacement === null) memoryDrafts.delete(key); else memoryDrafts.set(key, next);
    try { if (replacement === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(next)); } catch { available = false; }
    window.dispatchEvent(new CustomEvent(draftEvent, { detail: { key, value: next, available } }));
  }
  useEffect(() => {
    const settled = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: T; available: boolean }>).detail;
      if (detail.key === key) { setValue(detail.value); setStorageAvailable(detail.available); }
    };
    window.addEventListener(draftEvent, settled);
    return () => window.removeEventListener(draftEvent, settled);
  }, [key]);
  useEffect(() => {
    if (storageAvailable || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [storageAvailable, dirty]);
  return { draft, setDraft, clearDraft, settleDraft, storageAvailable, dirty };
}

export function ideaDate(value: string, locale: string) {
  return new Date(value).toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
