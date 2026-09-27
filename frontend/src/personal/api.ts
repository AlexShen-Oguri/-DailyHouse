export type TodoSource =
  | { kind: 'reading'; id: string; title: string; type: import('./reading-model').ReadingType; url: string; available?: boolean }
  | { kind: 'project_action'; id: string; projectId: string; title: string; url: string; available: boolean; linked: boolean; acceptance: string; status: 'active' | 'blocked' | 'paused' | 'done'; result: string; reason: string; revision: number };
export type Todo = { id: string; title: string; done: boolean; createdAt: string; dueDate: string | null; source?: TodoSource };
export type Note = { path: string; title: string; modifiedAt: string; size: number };
export type CalendarEvent = { id: string; title: string; start: string; end: string; allDay: boolean; location: string };
export type Settings = { vaultPath: string; calendarFile: string; calendarConfigured: boolean; calendarUrlConfigured: boolean; animationEnabled: boolean; readingTechPath: string; readingAestheticPath: string };
export type Workspace = {
  settings: Settings;
  todos: Todo[];
  vault: { status: string; name: string; notes: Note[]; lastReadAt: string | null; message: string };
  calendar: { status: string; events: CalendarEvent[]; updatedAt: string | null; message: string; provider?: 'file' | 'google' | 'apple'; range?: { from: string; to: string; days: number } };
  finance: { status: string; provider: string; message: string; accounts: unknown[]; transactions: unknown[] };
};
export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 25000);
  try {
    const english = document.documentElement.lang === 'en';
    const response = await fetch(`/api/personal${path}`, { method, signal: controller.signal, headers: { 'Content-Type': 'application/json', 'Accept-Language': english ? 'en' : 'zh-CN' }, ...(body === undefined && method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || (english ? 'Unable to load. Please try again.' : '读取失败，请稍后重试。'));
    return data as T;
  } catch (error) {
    const english = document.documentElement.lang === 'en';
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error(english ? 'This is taking too long. Check the source and try again.' : '读取超时，请检查来源后重试。');
    if (error instanceof TypeError) throw new Error(english ? 'The local service is unavailable. Open DailyHouse using your desktop shortcut.' : '本地服务没有响应，请双击桌面的启动入口。');
    throw error;
  } finally { window.clearTimeout(timer); }
}
export const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const dateLabel = (value?: string | null, locale = 'zh-CN') => value ? new Date(value).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : locale.startsWith('en') ? 'Not read yet' : '尚未读取';
