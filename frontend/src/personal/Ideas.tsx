import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Close, Plus, Search, Trash } from 'pixelarticons/react';
import { request } from './api';
import { usePreferences } from './Preferences';
import { Empty, Notice, PageHead } from './shared';
import { ideaDate, ideaStatusNames, newIdeaDraft, useIdeaDraft, type Idea, type IdeaStatus, type IdeaSummary, type IdeaTrashSummary } from './ideas-model';
import InspirationBoard from './InspirationBoard';
import { GardenLife } from '../components/GardenLife';
import '../styles/pastoral-workspace.css';
import '../styles/ideas.css';

export default function Ideas() {
  const { t, locale } = usePreferences();
  const navigate = useNavigate();
  const { draft, setDraft, settleDraft, storageAvailable, dirty } = useIdeaDraft('dailyhouse-idea-draft:new', newIdeaDraft);
  const [items, setItems] = useState<IdeaSummary[]>([]);
  const [trashItems, setTrashItems] = useState<IdeaTrashSummary[]>([]);
  const [view, setView] = useState<'ideas' | 'trash'>('ideas');
  const [presentation, setPresentation] = useState<'list' | 'garden'>(() => { try { return localStorage.getItem('dailyhouse-ideas-view') === 'list' ? 'list' : 'garden'; } catch { return 'garden'; } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState('');
  const [purge, setPurge] = useState<IdeaTrashSummary | null>(null);
  const [open, setOpen] = useState(dirty);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const titleInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const trashButton = useRef<HTMLButtonElement>(null);
  const generation = useRef(0); const confirmPanel = useRef<HTMLElement>(null);
  const saving = useRef(false);
  const alive = useRef(true);
  async function load(target = view) {
    const run = ++generation.current;
    setLoading(true); setError('');
    try {
      if (target === 'trash') {
        const data = await request<{ items: IdeaTrashSummary[] }>('/ideas/trash');
        if (alive.current && run === generation.current) setTrashItems(data.items);
      } else {
        const data = await request<{ items: IdeaSummary[] }>('/ideas');
        if (alive.current && run === generation.current) setItems(data.items);
      }
    }
    catch (err) { if (alive.current && run === generation.current) setError((err as Error).message); }
    finally { if (alive.current && run === generation.current) setLoading(false); }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => { if (open) titleInput.current?.focus(); }, [open]);
  useEffect(() => { if (purge) confirmPanel.current?.focus(); }, [purge]);
  async function create(event: FormEvent) {
    event.preventDefault(); if (saving.current || !draft.title.trim() || !draft.content.trim()) return;
    saving.current = true; setBusy(true); setError('');
    try {
      const idea = await request<Idea>('/ideas', 'POST', { title: draft.title.trim(), content: draft.content.trim() });
      settleDraft(draft, null); if (alive.current) navigate(`/ideas/${encodeURIComponent(idea.id)}`);
    } catch (err) { if (alive.current) setError((err as Error).message); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  function switchView(next: 'ideas' | 'trash') { if (busy || next === view) return; setView(next); setSearch(''); setStatus('all'); setFeedback(''); void load(next); }
  async function restore(item: IdeaTrashSummary) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setRestoring(item.id); setError(''); setFeedback('');
    try {
      await request<Idea>(`/ideas/${encodeURIComponent(item.id)}/restore`, 'POST');
      if (alive.current) { await load('trash'); if (alive.current) { setFeedback(t(`“${item.title}”已恢复到想法列表。`, `“${item.title}” is back in your ideas.`)); window.setTimeout(() => trashButton.current?.focus(), 0); } }
    } catch (err) { if (alive.current) setError((err as Error).message); }
    finally { saving.current = false; if (alive.current) { setBusy(false); setRestoring(''); } }
  }
  async function permanentlyDelete() {
    if (saving.current || !purge) return;
    saving.current = true; setBusy(true); setError('');
    try { await request(`/ideas/trash/${encodeURIComponent(purge.id)}`, 'DELETE', { deletedAt: purge.deletedAt }); setPurge(null); await load('trash'); setFeedback(t('想法与时间线已永久删除。', 'The idea and its timeline were permanently deleted.')); }
    catch (err) { setError((err as Error).message); } finally { saving.current = false; setBusy(false); }
  }
  const sourceItems = view === 'trash' ? trashItems : items;
  const visible = sourceItems.filter(item => (status === 'all' || item.status === status) && `${item.title} ${item.preview}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <div className="pw-page ideas-page">
    <PageHead title={t('灵感库', 'Idea garden')} description={t('先记下一点，让想法相遇，再慢慢长成作品。', 'Capture a thought, let ideas meet, and give them room to grow.')}>
      <button ref={addButton} className="pw-button primary" disabled={busy} onClick={() => { setOpen(true); titleInput.current?.focus(); }}><Plus width={18}/>{t('新建想法', 'New idea')}</button>
    </PageHead>
    <div className="idea-garden-border" aria-hidden="true"><span/><GardenLife variant="planter"/><span/></div>{error && <Notice error>{error} <button className="pw-text-button" disabled={busy || loading} onClick={() => void load()}>{t('重新读取', 'Retry loading')}</button></Notice>}
    {feedback && <Notice>{feedback}</Notice>}
    {!storageAvailable && dirty && <Notice>{t('浏览器暂时不能保存草稿。切换页面仍会保留，请在关闭或刷新前保存。', 'Draft storage is unavailable. Your draft survives page navigation; save it before closing or refreshing this tab.')}</Notice>}
    {open && <section className="pw-paper idea-new" aria-labelledby="idea-new-title">
      <div className="pw-section-head"><h2 id="idea-new-title">{t('记下新的想法', 'Capture a new idea')}</h2><button className="pw-icon-button" aria-label={t('收起新建表单', 'Close new idea form')} disabled={busy} onClick={() => { setOpen(false); addButton.current?.focus(); }}><Close width={19}/></button></div>
      <form onSubmit={create}>
        <label>{t('想法标题', 'Idea title')}<input ref={titleInput} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} maxLength={200} required disabled={busy} placeholder={t('给这一点灵感起个名字', 'Give this thought a name')}/></label>
        <label>{t('最初的想法', 'The first thought')}<textarea value={draft.content} onChange={event => setDraft({ ...draft, content: event.target.value })} maxLength={20000} rows={4} required disabled={busy} placeholder={t('哪怕只有一句话，也可以从这里开始。', 'Even a single sentence is a place to begin.')}/></label>
        <div className="idea-actions"><button className="pw-button primary" disabled={busy || !draft.title.trim() || !draft.content.trim()}>{busy ? t('创建中…', 'Creating…') : t('创建并打开', 'Create & open')}</button><small>{t('创建后进入这个想法的专属时间线。', 'Continue on this idea’s own timeline.')}</small></div>
      </form>
    </section>}
    <div className="idea-library-nav"><div className="idea-view-tabs" role="group" aria-label={t('想法视图', 'Idea view')}><button className="pw-text-button" aria-pressed={view === 'ideas'} disabled={busy} onClick={() => switchView('ideas')}>{t('所有灵感', 'All ideas')}</button><button ref={trashButton} className="pw-text-button" aria-pressed={view === 'trash'} disabled={busy} onClick={() => switchView('trash')}><Trash width={17}/>{t('回收站', 'Recycle bin')}</button></div><Link className="pw-text-button" to="/projects">{t('项目库', 'Project library')} <ArrowRight width={17}/></Link></div>
    {view === 'ideas' && <div className="idea-presentation-switch" role="group" aria-label={t('灵感排列方式', 'Idea layout')}>{(['garden', 'list'] as const).map(value => <button key={value} className={`pw-button${presentation === value ? ' primary' : ''}`} aria-pressed={presentation === value} disabled={busy} onClick={() => { setPresentation(value); try { localStorage.setItem('dailyhouse-ideas-view', value); } catch { /* Keep this visit's choice. */ } }}>{value === 'garden' ? t('气泡园 · 融合灵感', 'Bubbles · combine ideas') : t('时间线列表', 'Timeline list')}</button>)}</div>}
    {view === 'trash' && <p className="idea-trash-hint">{t('删除的想法和完整时间线保留 30 天，期间可以恢复。到期后无法恢复。', 'Deleted ideas and their complete timelines can be restored for 30 days. After that they cannot be recovered.')}</p>}
    {purge && <section ref={confirmPanel} tabIndex={-1} className="idea-delete-confirm" aria-label={t('确认永久删除想法', 'Confirm permanent idea deletion')}><h3>{t(`永久删除“${purge.title}”？`, `Permanently delete “${purge.title}”?`)}</h3><p>{t('这条想法、完整时间线与 AI 对话将无法恢复。已衍生的融合快照与外部项目保留。', 'The idea, its full timeline and AI conversations cannot be restored. Existing fusion snapshots and external projects stay.')}</p><div className="idea-actions"><button className="pw-button idea-danger-button" disabled={busy} onClick={() => void permanentlyDelete()}>{t('确认永久删除', 'Permanently delete')}</button><button className="pw-text-button" disabled={busy} onClick={() => setPurge(null)}>{t('取消', 'Cancel')}</button></div></section>}
    <section className="idea-shelf" aria-label={view === 'trash' ? t('想法回收站', 'Idea recycle bin') : t('想法列表', 'Idea list')}>
      <div className="idea-filters"><label className="pw-search"><Search width={18}/><input aria-label={t('搜索想法', 'Search ideas')} placeholder={t('搜索标题或最新片段', 'Search titles or latest thoughts')} value={search} onChange={event => setSearch(event.target.value)}/></label>
        <label><span className="pw-sr-only">{t('筛选想法状态', 'Filter idea status')}</span><select aria-label={t('筛选想法状态', 'Filter idea status')} value={status} onChange={event => setStatus(event.target.value)}><option value="all">{t('全部状态', 'All statuses')}</option>{Object.entries(ideaStatusNames).map(([key, names]) => <option key={key} value={key}>{t(...names)}</option>)}</select></label>
        <button className="pw-text-button" disabled={loading || busy} onClick={() => void load()}>{t('刷新', 'Refresh')}</button>
      </div>
      {loading ? <p className="pw-loading" role="status">{t('正在打开想法本…', 'Opening your ideas…')}</p> : error && !sourceItems.length ? <p className="idea-load-hint">{t('未能读取想法，请重试。你的草稿仍在。', 'Could not load your ideas. Retry when ready; your draft is kept.')}</p> : !visible.length ? <Empty title={sourceItems.length ? t('没有匹配的想法', 'No matching ideas') : view === 'trash' ? t('回收站是空的', 'The recycle bin is empty') : t('留住一闪而过的念头', 'Keep that passing thought')}><p>{sourceItems.length ? t('换个关键词，或查看全部状态。', 'Try another search or show all statuses.') : view === 'trash' ? t('删除的想法会暂时保留在这里。', 'Deleted ideas will stay here temporarily.') : t('新建一个想法，之后每次补充都会留在它自己的时间线上。', 'Create an idea, then build on it one update at a time.')}</p></Empty> : <>
        <p className="idea-count">{t(`${visible.length} 个想法`, `${visible.length} ideas`)}</p>
        {view === 'ideas' && presentation === 'garden' ? <InspirationBoard visibleIds={visible.map(item => item.id)} mode="garden" refreshKey={visible.map(item => `${item.id}:${item.revision}:${item.updatedAt}`).join(',')} onChanged={() => load('ideas')}/> : <ul className="idea-list">{visible.map(item => <li key={item.id}>{view === 'trash' ? <div className="idea-trash-row"><div className="idea-list-main"><div className="idea-list-title"><h2>{item.title}</h2></div><p className="idea-preview">{item.preview}</p><div className="idea-meta"><span>{t('删除于 ', 'Deleted ')}<time dateTime={(item as IdeaTrashSummary).deletedAt}>{ideaDate((item as IdeaTrashSummary).deletedAt, locale)}</time></span><span>{t('可恢复至 ', 'Restore before ')}<time dateTime={(item as IdeaTrashSummary).expiresAt}>{ideaDate((item as IdeaTrashSummary).expiresAt, locale)}</time></span><span>{t(`${item.entryCount} 条记录`, `${item.entryCount} entries`)}</span></div></div><button className="pw-button" disabled={busy || loading} aria-label={t(`恢复想法：${item.title}`, `Restore idea: ${item.title}`)} onClick={() => void restore(item as IdeaTrashSummary)}>{restoring === item.id ? t('恢复中…', 'Restoring…') : t('恢复想法', 'Restore idea')}</button><button className="pw-text-button idea-danger" disabled={busy || loading} onClick={() => setPurge(item as IdeaTrashSummary)}>{t('永久删除', 'Delete permanently')}</button></div> : <Link className="idea-list-link" to={`/ideas/${encodeURIComponent(item.id)}`} onClick={event => { if (busy) event.preventDefault(); }} aria-disabled={busy || undefined}>
          <div className="idea-list-main"><div className="idea-list-title"><h2>{item.title}</h2><span className="idea-status">{t(...ideaStatusNames[item.status as IdeaStatus])}</span></div><p className="idea-preview">{item.preview}</p><div className="idea-meta"><span>{t(`${Math.max(0, item.entryCount - 1)} 次更新`, `${Math.max(0, item.entryCount - 1)} updates`)}</span><span>{t('最后更新 ', 'Updated ')}<time dateTime={item.updatedAt}>{ideaDate(item.updatedAt, locale)}</time></span></div></div><ArrowRight width={22} aria-hidden="true"/>
        </Link>}</li>)}</ul>}
      </>}
    </section>
  </div>;
}
