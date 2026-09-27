import { useState, type ReactNode, type FormEvent } from 'react';
import '../styles/reading-todos.css';
import { Plus } from 'pixelarticons/react';
import { localDay, request } from './api';
import { useWorkspace } from './Workspace';
import { usePreferences } from './Preferences';
export function PageHead({ title, description, children }: { title: string; description: string; children?: ReactNode }) { return <header className="pw-page-head"><div><h1>{title}</h1><p>{description}</p></div>{children}</header>; }
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) { return <p className={`pw-notice${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{children}</p>; }
export function Empty({ title, children }: { title: string; children?: ReactNode }) { return <div className="pw-empty"><span className="pw-sprout" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M11 21V11H7V9H3V3h6v2h3v4h1V7h3V5h5v6h-3v2h-5v8z" fill="currentColor"/><path d="M7 22h10v2H7z" fill="#9a7345"/></svg></span><h3>{title}</h3>{children && <div>{children}</div>}</div>; }
export function AddTodo({ compact = false }: { compact?: boolean }) {
  const { t } = usePreferences();
  const { refresh } = useWorkspace(); const [title, setTitle] = useState(''); const [dueDate, setDueDate] = useState(localDay()); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  async function submit(event: FormEvent) { event.preventDefault(); if (!title.trim() || busy) return; setBusy(true); setMessage(''); try { await request('/todos', 'POST', { title: title.trim(), dueDate: dueDate || null }); setTitle(''); await refresh(); } catch (err) { setMessage(err instanceof Error ? err.message : t('未能添加待办，请重试。', 'Could not add the task. Please try again.')); } finally { setBusy(false); } }
  return <><form className={`pw-add${compact ? ' is-compact' : ''}`} onSubmit={submit}><label className="pw-grow"><span className="pw-sr-only">{t('待办事项', 'Task')}</span><input aria-label={t('待办事项', 'Task')} placeholder={t('记下一件想完成的小事…', 'One small thing you want to do…')} value={title} onChange={e => setTitle(e.target.value)} maxLength={180} required /></label>{!compact && <label className="pw-due"><span className="pw-sr-only">{t('计划日期', 'Planned date')}</span><input aria-label={t('计划日期', 'Planned date')} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></label>}<button className="pw-button primary" type="submit" disabled={busy || !title.trim()}><Plus width={18} height={18}/>{busy ? t('添加中…', 'Adding…') : t('添加待办', 'Add task')}</button></form>{message && <Notice error>{message}</Notice>}</>;
}
export { TodoRows } from './TodoRows';
