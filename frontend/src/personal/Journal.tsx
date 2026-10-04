import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Trash, ArrowLeft, MagicEdit, Reload, Search } from 'pixelarticons/react';
import { GardenGlyph } from '../components/GardenLife';
import { request } from './api';
import { usePreferences } from './Preferences';
import { Empty, Notice, PageHead } from './shared';
import { journalDay, journalDateLabel, journalFields, type JournalEntry, type JournalSummary } from './journal-model';
import '../styles/journal.css';

const path = (date: string) => `/journal/${encodeURIComponent(date)}`;

function JournalState({ entry }: { entry: Pick<JournalEntry, 'status' | 'lifeState'> }) {
  const { t } = usePreferences();
  const state = { waiting: t('现实活动待补充', 'Life notes pending'), provided: t('已补充现实活动', 'Life notes included'), skipped: t('现实活动未补充', 'Life notes not provided') };
  return <div className="journal-states"><span className={`journal-status is-${entry.status}`}>{entry.status === 'final' ? t('已整理', 'Finalized') : t('初稿', 'Draft')}</span><span>{state[entry.lifeState]}</span></div>;
}

function JournalEditor({ entry, onSaved, onCancel }: { entry?: JournalEntry; onSaved: (entry: JournalEntry) => void; onCancel: () => void }) {
  const { t } = usePreferences();
  const [date, setDate] = useState(entry?.date ?? journalDay());
  const [draft, setDraft] = useState<Pick<JournalEntry, typeof journalFields[number]>>({ title: entry?.title ?? t('工作日记', 'Work journal'), codex: entry?.codex ?? '', life: entry?.life ?? '', reflection: entry?.reflection ?? '', status: entry?.status ?? 'draft', lifeState: entry?.lifeState ?? 'waiting' });
  const [version, setVersion] = useState(entry?.revision ?? 0), [latest, setLatest] = useState<JournalEntry | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const first = useRef<HTMLInputElement>(null), errorRef = useRef<HTMLDivElement>(null), saving = useRef(false);
  useEffect(() => { first.current?.focus(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current || latest) return;
    saving.current = true; setBusy(true); setError('');
    try {
      const changed = entry ? Object.fromEntries(journalFields.filter(key => draft[key] !== entry[key]).map(key => [key, draft[key]])) : draft;
      const saved = await request<JournalEntry>(entry ? path(date) : '/journal', entry ? 'PATCH' : 'POST', entry ? { ...changed, revision: version } : { ...draft, date });
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
      try { const current = await request<JournalEntry>(path(date)); if (current.revision !== version) setLatest(current); } catch { /* Keep the draft when offline or the entry was deleted. */ }
      errorRef.current?.focus();
    } finally { saving.current = false; setBusy(false); }
  }
  return <form className="journal-editor" onSubmit={submit}>
    <fieldset disabled={busy}>
      <div className="journal-form-row"><label>{t('日记日期', 'Journal date')}<input ref={entry ? undefined : first} type="date" value={date} disabled={Boolean(entry)} required onChange={event => { setDate(event.target.value); setLatest(null); setError(''); }} min="1900-01-01" max="9999-12-31"/><small>{t('按纽约日期归档，跨午夜的补充仍属于原来那一天。', 'Filed by New York date. Late additions stay with their original day.')}</small></label><label>{t('标题', 'Title')}<input ref={entry ? first : undefined} value={draft.title} maxLength={160} required onChange={event => setDraft({ ...draft, title: event.target.value })}/></label></div>
      <label>{t('Codex 中的进展', 'Progress in Codex')}<textarea value={draft.codex} rows={8} maxLength={24000} onChange={event => setDraft({ ...draft, codex: event.target.value })}/></label>
      <label>{t('现实中的工作与生活', 'Work and life outside Codex')}<textarea value={draft.life} rows={5} maxLength={24000} onChange={event => setDraft({ ...draft, life: event.target.value, lifeState: event.target.value.trim() ? 'provided' : 'waiting' })}/></label>
      <label>{t('收获与待办', 'Reflections and next steps')}<textarea value={draft.reflection} rows={4} maxLength={12000} onChange={event => setDraft({ ...draft, reflection: event.target.value })}/></label>
      <div className="journal-form-row"><label>{t('现实活动记录', 'Life notes')}<select value={draft.lifeState} onChange={event => setDraft({ ...draft, lifeState: event.target.value as JournalEntry['lifeState'] })}><option value="waiting">{t('等待补充', 'Awaiting additions')}</option><option value="provided">{t('已经补充', 'Included')}</option><option value="skipped">{t('本次不补充', 'Not provided this time')}</option></select></label><label>{t('整理状态', 'Journal status')}<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as JournalEntry['status'] })}><option value="draft">{t('保留初稿', 'Keep as draft')}</option><option value="final">{t('已整理', 'Finalized')}</option></select></label></div>
    </fieldset>
    {error && <div ref={errorRef} tabIndex={-1}><Notice error>{error}</Notice></div>}
    {latest && <div className="journal-conflict"><p>{t('你的草稿已保留。请先核对这一天的新内容。', 'Your draft is kept. Review the new content for this day first.')}</p><details><summary>{t('查看最新版本', 'View latest version')}</summary><p>{latest.title}</p><p className="journal-text">{latest.codex}</p><p className="journal-text">{latest.life}</p><p className="journal-text">{latest.reflection}</p><JournalState entry={latest}/></details>{entry ? <button className="pw-button" type="button" onClick={() => { setVersion(latest.revision); setLatest(null); setError(''); }}>{t('已核对，保存我修改的部分', 'Reviewed: save my changed fields')}</button> : <Link className="pw-button" to={path(latest.date)}>{t('打开已有日记', 'Open existing journal')}</Link>}</div>}
    <div className="journal-actions"><button className="pw-button primary" type="submit" disabled={busy || Boolean(latest) || !draft.title.trim() || ![draft.codex, draft.life, draft.reflection].some(text => text.trim())}>{busy ? t('保存中…', 'Saving…') : t('保存日记', 'Save journal')}</button><button className="pw-button" type="button" disabled={busy} onClick={onCancel}>{t('取消', 'Cancel')}</button></div>
  </form>;
}

export default function JournalPage() {
  const { t, locale, language } = usePreferences();
  const navigate = useNavigate(), [params, setParams] = useSearchParams();
  const trash = params.get('trash') === '1';
  const [items, setItems] = useState<JournalSummary[]>([]), [total, setTotal] = useState(0);
  const [q, setQ] = useState(''), [month, setMonth] = useState(''), [filter, setFilter] = useState({ q: '', month: '' });
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [creating, setCreating] = useState(false);
  const generation = useRef(0), addButton = useRef<HTMLButtonElement>(null), restoring = useRef(false);
  const load = useCallback(async () => {
    const token = ++generation.current; setLoading(true); setError('');
    try {
      const query = new URLSearchParams(filter).toString();
      const result = await request<{ items: JournalSummary[]; total?: number }>(trash ? '/journal/trash' : `/journal?${query}`);
      if (token === generation.current) { setItems(result.items); setTotal(result.total ?? result.items.length); }
    } catch (err) { if (token === generation.current) setError((err as Error).message); }
    finally { if (token === generation.current) setLoading(false); }
  }, [trash, filter, language]);
  useEffect(() => { setItems([]); void load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => { if (creating) return; const refresh = () => void load(); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, [creating, load]);
  async function restore(item: JournalSummary) {
    if (restoring.current) return; restoring.current = true; setBusy(true); setError('');
    try { const saved = await request<JournalEntry>(`${path(item.date)}/restore`, 'POST', { revision: item.revision }); navigate(path(saved.date)); }
    catch (err) { setError((err as Error).message); }
    finally { restoring.current = false; setBusy(false); }
  }
  return <div className="pw-page journal-page">
    <PageHead title={t('工作日记', 'Work journal')} description={t('给做过的事，留下一页。', 'A page for what you did today.')}><button ref={addButton} className="pw-button primary" disabled={busy || creating} onClick={() => setCreating(true)}><Plus width={18} aria-hidden="true"/>{t('写日记', 'Write a journal')}</button></PageHead>
    <div className="journal-intro"><span className="journal-book" aria-hidden="true"><GardenGlyph name="journal" size={40}/></span><div><strong>{t('一天一页，慢慢积累', 'One day, one page')}</strong><p>{t('Codex 的进展、现实中的小事，都留在这里。每天 23:30 在固定对话整理，补充后更新同一页。', 'Keep your Codex progress and everyday life here. Summaries are prepared in the same chat at 23:30; additions update the same page.')}</p><small>{t('纽约日期 · 本机保存', 'New York dates · Stored locally')}</small></div></div>
    {creating && <section className="pw-paper journal-sheet" aria-labelledby="journal-new"><h2 id="journal-new">{t('写下这一天', 'Write about this day')}</h2><JournalEditor onSaved={entry => navigate(path(entry.date))} onCancel={() => { setCreating(false); addButton.current?.focus(); }}/></section>}
    <div className="journal-tabs" role="group" aria-label={t('日记视图', 'Journal view')}><button className="pw-text-button" aria-pressed={!trash} disabled={busy} onClick={() => setParams({})}>{t('我的日记', 'My journal')}</button><button className="pw-text-button" aria-pressed={trash} disabled={busy} onClick={() => setParams({ trash: '1' })}><Trash width={17} aria-hidden="true"/>{t('回收站', 'Recycle bin')}</button><button className="pw-text-button journal-refresh" disabled={busy || loading} onClick={() => void load()}><Reload width={17} aria-hidden="true"/>{t('刷新', 'Refresh')}</button></div>
    {!trash && <form className="journal-filters" onSubmit={event => { event.preventDefault(); setFilter({ q, month }); }}><label className="journal-search">{t('搜索日记', 'Search journal')}<input type="search" value={q} maxLength={200} placeholder={t('标题、进展或生活片段', 'Title, progress, or life notes')} onChange={event => setQ(event.target.value)}/></label><label>{t('月份', 'Month')}<input type="month" value={month} onChange={event => setMonth(event.target.value)}/></label><button className="pw-button" type="submit"><Search width={17} aria-hidden="true"/>{t('查找', 'Search')}</button>{(filter.q || filter.month) && <button className="pw-text-button" type="button" onClick={() => { setQ(''); setMonth(''); setFilter({ q: '', month: '' }); }}>{t('查看全部', 'Show all')}</button>}</form>}
    {error && <Notice error>{error} <button className="pw-text-button" onClick={() => void load()}>{t('重试', 'Try again')}</button></Notice>}
    {loading ? <p role="status" className="pw-loading">{t('翻开日记…', 'Opening your journal…')}</p> : <><p className="journal-count">{trash ? t('移除的日记保留 30 天，自动任务不会重新创建。', 'Removed entries can be restored for 30 days. Automation will not recreate them.') : t(`已记录 ${total} 天`, `${total} ${total === 1 ? 'day' : 'days'} recorded`)}</p>{!items.length ? <Empty title={trash ? t('回收站是空的', 'The recycle bin is empty') : filter.q || filter.month ? t('没有找到这段记录', 'No matching entries') : t('从第一篇日记开始', 'Start with your first page')}><p>{trash ? t('恢复后会回到原来的日期。', 'Restored entries return to their original date.') : t('可以自己写，也可以让 Codex 的每日总结写入这里。', 'Write a page yourself, or keep your daily Codex summaries here.')}</p></Empty> : <div className="journal-grid">{items.map(item => <article className="journal-card" key={item.date}><div className="journal-card-date"><time dateTime={item.date}>{journalDateLabel(item.date, locale)}</time><GardenGlyph name="journal" size={22}/></div>{trash ? <h2>{item.title}</h2> : <h2><Link to={path(item.date)}>{item.title}</Link></h2>}<JournalState entry={item}/><p className="journal-preview">{item.preview}</p>{trash ? <div className="journal-card-foot"><small>{t('可恢复至', 'Restore until')} {new Date(item.expiresAt!).toLocaleDateString(locale)}</small><button className="pw-button" disabled={busy} onClick={() => void restore(item)}>{t('恢复并打开', 'Restore and open')}</button></div> : <Link className="journal-open" to={path(item.date)}>{t('翻开这一天', 'Open this day')} <span aria-hidden="true">→</span></Link>}</article>)}</div>}</>}
  </div>;
}

export function JournalDetailPage() {
  const { date = '' } = useParams(), navigate = useNavigate();
  const { t, locale, language } = usePreferences();
  const [entry, setEntry] = useState<JournalEntry | null>(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [editing, setEditing] = useState(false), [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false);
  const generation = useRef(0), removing = useRef(false), editButton = useRef<HTMLButtonElement>(null), deleteButton = useRef<HTMLButtonElement>(null), confirmation = useRef<HTMLDivElement>(null), returnEditFocus = useRef(false), returnDeleteFocus = useRef(false);
  const load = useCallback(async () => {
    const token = ++generation.current; setLoading(true); setError('');
    try { const result = await request<JournalEntry>(path(date)); if (token === generation.current) setEntry(result); }
    catch (err) { if (token === generation.current) setError((err as Error).message); }
    finally { if (token === generation.current) setLoading(false); }
  }, [date, language]);
  useEffect(() => { setEntry(null); setEditing(false); setConfirming(false); void load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => { if (editing || confirming) return; const refresh = () => void load(); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, [editing, confirming, load]);
  useEffect(() => { if (confirming) confirmation.current?.focus(); }, [confirming]);
  useEffect(() => { if (!editing && returnEditFocus.current) { editButton.current?.focus(); returnEditFocus.current = false; } }, [editing]);
  useEffect(() => { if (!confirming && returnDeleteFocus.current) { deleteButton.current?.focus(); returnDeleteFocus.current = false; } }, [confirming]);
  async function remove() {
    if (!entry || removing.current) return; removing.current = true; setBusy(true); setError('');
    try { await request(path(date), 'DELETE', { revision: entry.revision, confirmed: true }); navigate('/journal?trash=1'); }
    catch (err) { const message = (err as Error).message; setConfirming(false); await load(); setError(message); }
    finally { removing.current = false; setBusy(false); }
  }
  return <div className="pw-page journal-page">
    <Link className="journal-back" to="/journal"><ArrowLeft width={18} aria-hidden="true"/>{t('返回工作日记', 'Back to work journal')}</Link>
    {error && <Notice error>{error} <button className="pw-text-button" disabled={loading || busy} onClick={() => void load()}>{t('重新读取', 'Retry loading')}</button></Notice>}
    {loading && !entry ? <p role="status" className="pw-loading">{t('翻开这一天…', 'Opening this day…')}</p> : entry && <article className="pw-paper journal-sheet">
      <header className="journal-entry-head"><div><time dateTime={date}>{journalDateLabel(date, locale)}</time><h1>{entry.title}</h1><JournalState entry={entry}/></div><GardenGlyph name="journal" size={44}/></header>
      {editing ? <JournalEditor entry={entry} onSaved={saved => { setEntry(saved); returnEditFocus.current = true; setEditing(false); setError(''); }} onCancel={() => { returnEditFocus.current = true; setEditing(false); }}/> : <>
        <div className="journal-entry-tools"><span>{t('纽约日期 · 本机保存', 'New York date · Stored locally')}</span><button ref={editButton} className="pw-button" disabled={busy} onClick={() => setEditing(true)}><MagicEdit width={18} aria-hidden="true"/>{t('编辑日记', 'Edit journal')}</button></div>
        <section className="journal-section"><h2>{t('Codex 中的进展', 'Progress in Codex')}</h2>{entry.codex ? <p className="journal-text">{entry.codex}</p> : <p className="journal-placeholder">{t('这一天没有记录 Codex 进展。', 'No Codex progress was recorded for this day.')}</p>}</section>
        <section className="journal-section"><h2>{t('现实中的工作与生活', 'Work and life outside Codex')}</h2>{entry.life ? <p className="journal-text">{entry.life}</p> : <p className="journal-placeholder">{entry.lifeState === 'waiting' ? t('待补充。可以在原来的 Codex 对话里告诉我，也可以直接编辑这一页。', 'Awaiting additions. Reply in the original Codex chat, or edit this page.') : t('本次未补充现实活动。', 'Life notes were not provided this time.')}</p>}</section>
        <section className="journal-section"><h2>{t('收获与待办', 'Reflections and next steps')}</h2>{entry.reflection ? <p className="journal-text">{entry.reflection}</p> : <p className="journal-placeholder">{t('暂无记录。', 'No notes yet.')}</p>}</section>
        <footer className="journal-entry-foot"><small>{t('最后更新', 'Last updated')} {new Date(entry.updatedAt).toLocaleString(locale)}{entry.editedFields.length ? ` · ${t('网页上的修改会保留', 'Edits made here are protected')}` : ''}</small><button ref={deleteButton} className="pw-text-button journal-danger" disabled={busy || confirming} onClick={() => setConfirming(true)}><Trash width={17} aria-hidden="true"/>{t('删除这篇日记', 'Delete this entry')}</button></footer>
        {confirming && <div ref={confirmation} tabIndex={-1} className="journal-confirm" role="alert"><h3>{t('删除这一天的日记？', 'Delete this day’s entry?')}</h3><p>{t('仅移除小院中的这一篇日记，30 天内可恢复。Codex 聊天、项目、书架和其他日期的日记都会保留；自动任务不会重新创建它。', 'Only this DailyHouse journal entry is removed, with 30 days to restore it. Codex chats, projects, shelf items and other dates stay. Automation will not recreate this entry.')}</p><div className="journal-actions"><button className="pw-button" disabled={busy} onClick={() => { returnDeleteFocus.current = true; setConfirming(false); }}>{t('保留日记', 'Keep entry')}</button><button className="pw-button journal-danger" disabled={busy} onClick={() => void remove()}>{busy ? t('删除中…', 'Deleting…') : t('确认删除日记', 'Confirm deletion')}</button></div></div>}
      </>}
    </article>}
  </div>;
}
