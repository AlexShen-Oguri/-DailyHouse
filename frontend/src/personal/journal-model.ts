export const journalFields = ['title', 'codex', 'life', 'reflection', 'status', 'lifeState'] as const;
export type JournalField = typeof journalFields[number];
export interface JournalEntry {
  date: string; timezone: 'America/New_York'; title: string; codex: string; life: string; reflection: string;
  status: 'draft' | 'final'; lifeState: 'waiting' | 'provided' | 'skipped';
  createdAt: string; updatedAt: string; revision: number; editedFields: JournalField[]; writer: 'manual' | 'codex';
}
export type JournalSummary = Omit<JournalEntry, 'codex' | 'life' | 'reflection' | 'editedFields'> & { preview: string; deletedAt?: string; expiresAt?: string };
export function journalDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (name: string) => parts.find(item => item.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export const journalDateLabel = (date: string, locale: string) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', dateStyle: 'full' }).format(new Date(`${date}T12:00:00Z`));
