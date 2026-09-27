import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { BookOpen, Check, Close, Folder, Plus, Search, ArrowRight, Play, Code, Article, Image, Grid3x3, Trash }  from 'pixelarticons/react';
import { dateLabel, request } from './api';
import { usePreferences } from './Preferences';
import { useWorkspace } from './Workspace';
import { Empty, Notice, PageHead } from './shared';
import VideoCover from './VideoCover';
import ReadingTrash from './ReadingTrash';
import ReadingImports from './ReadingImports';
import { categoryNames, matchesKind, shelfKinds, statusNames, suggestLink, typeNames, type ReadingCategory, type ReadingItem, type ReadingState, type ReadingStatus, type ReadingType, type ShelfKind } from './reading-model';
import '../styles/reading.css';

type Draft = { title: string; type: ReadingType; category: ReadingCategory; url: string; notes: string };
type Removal = { scope: 'one' | 'selected' | 'all'; items: ReadingItem[] };
const blank = (): Draft => ({ title: '', type: 'book', category: 'other', url: '', notes: '' });
export default function ReadingPage() {
  const { language, locale, t } = usePreferences(); const { data, refresh } = useWorkspace();
  const [shelf, setShelf] = useState<ReadingState | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [search, setSearch] = useState(''); const [kind, setKind] = useState<ShelfKind>('all'); const [status, setStatus] = useState('active');
  const [category, setCategory] = useState('all'); const [view, setView] = useState<'shelf' | 'trash' | 'imports'>('shelf'); const [panelBusy, setPanelBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank); const [editing, setEditing] = useState<string | null>(null); const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(''); const [removal, setRemoval] = useState<Removal | null>(null); const [feedback, setFeedback] = useState('');
  const [selecting, setSelecting] = useState(false); const [selected, setSelected] = useState<Set<string>>(new Set());
  const [completing, setCompleting] = useState<Set<string>>(new Set());
  const completionTimers = useRef(new Map<string, number>());
  const progressFilter = useRef<HTMLButtonElement>(null); const selectAll = useRef<HTMLInputElement>(null);
  const removalHeading = useRef<HTMLHeadingElement>(null); const bulkButton = useRef<HTMLButtonElement>(null);
  const removalTrigger = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef<HTMLElement | null>(null);
  const completionHadFocus = useRef(new Set<string>());
  const [techPath, setTechPath] = useState(''); const [aestheticPath, setAestheticPath] = useState(''); const requestVersion = useRef(0);
  const applyCover = useCallback((saved: ReadingItem) => {
    // Metadata can finish after a status edit or deletion. It must never replace
    // the user's newer fields, resurrect a row, or attach to a changed link.
    setShelf(previous => previous ? { ...previous, items: previous.items.map(row => row.id === saved.id && row.url === saved.url && row.type === saved.type && (!row.coverCheckedAt || !saved.coverCheckedAt || row.coverCheckedAt <= saved.coverCheckedAt) ? { ...row, coverUrl: saved.coverUrl, coverCheckedAt: saved.coverCheckedAt } : row) } : previous);
  }, []);
  useEffect(() => { setTechPath(data?.settings.readingTechPath ?? ''); }, [data?.settings.readingTechPath]);
  useEffect(() => { setAestheticPath(data?.settings.readingAestheticPath ?? ''); }, [data?.settings.readingAestheticPath]);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    try { const next = await request<ReadingState>('/reading'); if (version === requestVersion.current) { setShelf(next); setError(''); } }
    catch (err) { if (version === requestVersion.current) setError((err as Error).message); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }, [language]);
  useEffect(() => { void load(); const onFocus = () => { if (!document.hidden) void load(); }; window.addEventListener('focus', onFocus); const timer = window.setInterval(onFocus, 60000); return () => { requestVersion.current++; clearInterval(timer); window.removeEventListener('focus', onFocus); }; }, [load]);
  useEffect(() => () => { completionTimers.current.forEach(timer => clearTimeout(timer)); }, []);
  useEffect(() => { setSelected(new Set()); setRemoval(null); }, [search, kind, status, category, view]);
  useEffect(() => { if (removal) removalHeading.current?.focus(); }, [removal]);
  useEffect(() => {
    if (!busy && !removal && pendingFocus.current) {
      const target = pendingFocus.current; pendingFocus.current = null;
      if (target.isConnected && !target.matches(':disabled')) target.focus(); else progressFilter.current?.focus();
    }
  }, [busy, removal]);
  useEffect(() => { setFeedback(''); setError(''); }, [language]);
  const items = useMemo(() => (shelf?.items ?? []).filter(item => matchesKind(item, kind) && (category === 'all' || (item.category ?? 'other') === category) && (completing.has(item.id) || (status === 'active' ? item.status !== 'done' : item.status === status)) && `${item.title} ${item.notes} ${item.url}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [shelf, kind, status, category, search, completing]);
  const selectable = items.filter(item => !completing.has(item.id));
  const selectedItems = selectable.filter(item => selected.has(item.id));
  const allSelected = selectable.length > 0 && selectedItems.length === selectable.length;
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = selectedItems.length > 0 && !allSelected; }, [selectedItems.length, allSelected, selecting]);
  const finished = shelf?.items.filter(item => item.status === 'done').length ?? 0;
  const kindIcons = { all: Grid3x3, book: BookOpen, video: Play, course: BookOpen, github: Code, article: Article, tech: Code, aesthetic: Image };
  function showShelf(nextStatus: string) { setView('shelf'); setStatus(nextStatus); setFormOpen(false); }
  function showPanel(nextView: 'trash' | 'imports') { setView(nextView); setFormOpen(false); }
  const pending = shelf?.items.filter(item => item.status !== 'done').length ?? 0;
  const beginEdit = (item?: ReadingItem) => { if (busy || panelBusy) return; setView('shelf'); setDraft(item ? { title: item.title, type: item.type, category: item.category ?? 'other', url: item.url, notes: item.notes } : blank()); setEditing(item?.id ?? null); setFormOpen(true); setFeedback(''); };
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy('save'); setError(''); setFeedback('');
    try { await request(editing ? `/reading/${encodeURIComponent(editing)}` : '/reading', editing ? 'PATCH' : 'POST', { ...draft, title: draft.title.trim(), url: draft.url.trim(), notes: draft.notes.trim() }); setFormOpen(false); setEditing(null); setDraft(blank()); await load(); setFeedback(t('已放回书架。', 'Saved to your shelf.')); }
    catch (err) { setError((err as Error).message); } finally { setBusy(''); }
  }
  async function changeStatus(item: ReadingItem, next: ReadingStatus) {
    if (busy || completing.has(item.id)) return;
    setBusy(item.id); setError(''); setFeedback(''); requestVersion.current++;
    if (document.activeElement?.closest('[data-reading-id]')?.getAttribute('data-reading-id') === item.id) completionHadFocus.current.add(item.id);
    try {
      const saved = await request<ReadingItem>(`/reading/${encodeURIComponent(item.id)}`, 'PATCH', { status: next });
      requestVersion.current++;
      if (next === 'done') {
        setCompleting(previous => new Set(previous).add(item.id));
        const reduced = data?.settings.animationEnabled === false || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        // A fallback also finishes the transition when animations are interrupted or the tab is hidden.
        completionTimers.current.set(item.id, window.setTimeout(() => finishCompletion(item.id), reduced ? 400 : 1500));
        setFeedback(t(`已完成「${item.title}」。可在“已完成”中回看。`, `Finished “${item.title}”. Find it under Finished.`));
      } else {
        if (status !== 'active' && status !== next && completionHadFocus.current.has(item.id)) pendingFocus.current = progressFilter.current;
        completionHadFocus.current.delete(item.id);
      }
      setSelected(previous => { const nextSelection = new Set(previous); nextSelection.delete(item.id); return nextSelection; });
      setShelf(previous => previous ? { ...previous, items: previous.items.map(row => row.id === item.id ? { ...row, ...saved } : row) } : previous);
    }
    catch (err) { completionHadFocus.current.delete(item.id); setError((err as Error).message); } finally { setBusy(''); }
  }
  function finishCompletion(id: string) {
    clearTimeout(completionTimers.current.get(id)); completionTimers.current.delete(id);
    if (document.activeElement?.closest('[data-reading-id]')?.getAttribute('data-reading-id') === id || (completionHadFocus.current.has(id) && document.activeElement === document.body)) progressFilter.current?.focus();
    completionHadFocus.current.delete(id);
    setCompleting(previous => { const next = new Set(previous); next.delete(id); return next; });
  }
  function askRemoval(scope: Removal['scope'], targets: ReadingItem[]) {
    if (busy || !targets.length) return;
    removalTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRemoval({ scope, items: [...targets] }); setError(''); setFeedback('');
  }
  function cancelRemoval() { pendingFocus.current = removalTrigger.current; setRemoval(null); }
  async function remove() {
    if (busy || !removal) return;
    setBusy('remove'); setError(''); requestVersion.current++;
    try {
      // Even "all" uses the reviewed snapshot, so a newly discovered report is never removed unseen.
      const result = await request<{ removedIds: string[] }>('/reading/remove', 'POST', { ids: removal.items.map(item => item.id) });
      requestVersion.current++;
      const removed = new Set(result.removedIds);
      setShelf(previous => previous ? { ...previous, items: previous.items.filter(item => !removed.has(item.id)) } : previous);
      setSelected(previous => new Set([...previous].filter(id => !removed.has(id))));
      pendingFocus.current = bulkButton.current;
      setRemoval(null); setFeedback(t(`已移出 ${removed.size} 项，可在回收站恢复，保留 30 天。`, `Moved ${removed.size} items to the recycle bin for 30 days.`));
    } catch (err) { setError((err as Error).message); } finally { setBusy(''); }
  }
  async function saveSources(event: FormEvent) { event.preventDefault(); if (busy) return; setBusy('sources'); setError(''); try { await request('/settings', 'PATCH', { readingTechPath: techPath.trim(), readingAestheticPath: aestheticPath.trim() }); await refresh(); await load(); setFeedback(t('日报目录已保存。', 'Report folders saved.')); } catch (err) { setError((err as Error).message); } finally { setBusy(''); } }
  function linkBlur() { const suggestion = suggestLink(draft.url); if (suggestion) setDraft(old => ({ ...old, type: suggestion.type, title: old.title || suggestion.title })); }
  return <div className="pw-page reading-page"><PageHead title={t('待读书架', 'Reading shelf')} description={t('先收好好奇，再慢慢读完。', 'Keep your curiosity. Come back when you’re ready.')}><button className="pw-button primary" onClick={() => beginEdit()} disabled={!!busy || panelBusy}><Plus width={18}/>{t('收进书架', 'Add to shelf')}</button></PageHead>
    {error && <Notice error>{error}</Notice>}{feedback && <Notice>{feedback}</Notice>}
    {formOpen && <section className="pw-paper reading-editor"><div className="pw-section-head"><h2>{editing ? t('编辑条目', 'Edit item') : t('留给下一次好奇', 'Save something for later')}</h2><button className="pw-icon-button" aria-label={t('关闭添加表单', 'Close item form')} onClick={() => setFormOpen(false)} disabled={!!busy}><Close width={19}/></button></div><form onSubmit={save}>
      <label className="reading-form-wide">{t('链接（书目可留空）', 'Link (optional for books)')}<input type="url" value={draft.url} onChange={e => setDraft({ ...draft, url: e.target.value })} onBlur={linkBlur} placeholder="https://…" maxLength={2048} disabled={!!busy}/></label>
      <label className="reading-title-field">{t('标题', 'Title')}<input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder={t('例如：CS50 第三讲 / 想读的一本书', 'e.g. CS50 lecture 3 / A book to read')} required maxLength={200} disabled={!!busy}/></label>
      <label>{t('类型', 'Type')}<select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value as ReadingType })} disabled={!!busy}>{Object.entries(typeNames).map(([value, labels]) => <option key={value} value={value}>{t(...labels)}</option>)}</select></label>
      <label>{t('内容分类', 'Category')}<select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value as ReadingCategory })} disabled={!!busy}>{Object.entries(categoryNames).map(([value, labels]) => <option key={value} value={value}>{t(...labels)}</option>)}</select></label>
      <label className="reading-form-wide">{t('随手记（可选）', 'A note to yourself (optional)')}<textarea value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} placeholder={t('为什么想看？读到哪一节了？', 'Why save it? Where did you stop?')} rows={2} maxLength={4000} disabled={!!busy}/></label>
      <div className="pw-form-actions reading-form-wide"><button className="pw-button primary" disabled={!!busy || !draft.title.trim()}>{busy === 'save' ? t('保存中…', 'Saving…') : t('保存到书架', 'Save to shelf')}</button><button type="button" className="pw-text-button" onClick={() => setFormOpen(false)} disabled={!!busy}>{t('取消', 'Cancel')}</button><small>{t('B 站、网课、教程、GitHub 链接均可。', 'Bilibili, courses, tutorials and GitHub links are welcome.')}</small></div>
    </form></section>}
    <div className="reading-primary-nav" role="group" aria-label={t('书架视图', 'Shelf view')}>
      <div className="reading-status-tabs"><button ref={status !== 'done' ? progressFilter : undefined} aria-label={t('未完成', 'Unfinished')} aria-pressed={view === 'shelf' && status !== 'done'} disabled={!!busy || !!removal || panelBusy} onClick={() => showShelf('active')}>{t('未完成', 'Unfinished')} <span>{pending}</span></button><button ref={status === 'done' ? progressFilter : undefined} aria-label={t('已完成', 'Finished')} aria-pressed={view === 'shelf' && status === 'done'} disabled={!!busy || !!removal || panelBusy} onClick={() => showShelf('done')}><Check width={17}/>{t('已完成', 'Finished')} <span>{finished}</span></button></div>
      <div className="reading-secondary-nav"><button className="pw-text-button" aria-pressed={view === 'imports'} disabled={!!busy || !!removal || panelBusy} onClick={() => showPanel('imports')}>{t('导入与记录', 'Imports & history')}</button><button className="pw-text-button" aria-pressed={view === 'trash'} disabled={!!busy || !!removal || panelBusy} onClick={() => showPanel('trash')}><Trash width={17}/>{t('回收站', 'Recycle bin')}</button></div>
    </div>
    {view === 'trash' ? <ReadingTrash onChanged={load} onBusy={setPanelBusy}/> : view === 'imports' ? <ReadingImports onChanged={load} onBusy={setPanelBusy}/> : <>
    <div className="reading-type-shortcuts" role="group" aria-label={t('按内容类型浏览', 'Browse by content type')}>{shelfKinds.map(({ id, label }) => { const Icon = kindIcons[id]; const count = (shelf?.items ?? []).filter(item => matchesKind(item, id) && (status === 'done' ? item.status === 'done' : item.status !== 'done')).length; return <button key={id} className={kind === id ? 'is-active' : ''} aria-label={t(...label)} aria-pressed={kind === id} disabled={!!busy || !!removal} onClick={() => setKind(id)}><Icon width={21}/><span>{t(...label)}</span><small>{count}</small></button>; })}</div>
    <section className="reading-shelf">
      <div className="reading-filters">
        <label className="pw-search"><Search width={18}/><input aria-label={t('搜索书架', 'Search shelf')} placeholder={t('搜索标题、链接或随手记', 'Search titles, links or notes')} value={search} onChange={e => setSearch(e.target.value)} disabled={!!removal || !!busy}/></label>
        <label><span className="pw-sr-only">{t('筛选分类', 'Filter by category')}</span><select value={category} onChange={event => setCategory(event.target.value)} disabled={!!removal || !!busy}><option value="all">{t('全部分类', 'All categories')}</option>{Object.entries(categoryNames).map(([value, labels]) => <option key={value} value={value}>{t(...labels)}</option>)}</select></label>
        {status !== 'done' && <label><span className="pw-sr-only">{t('筛选进度', 'Filter by progress')}</span><select value={status} onChange={event => setStatus(event.target.value)} disabled={!!removal || !!busy}><option value="active">{t('全部未完成', 'All unfinished')}</option><option value="unread">{t('待开始', 'To start')}</option><option value="reading">{t('进行中', 'In progress')}</option></select></label>}
        <button className="pw-text-button" onClick={() => void load()} disabled={!!busy || !!removal}>{t('刷新', 'Refresh')}</button>
      </div>
      <div className="reading-management">
        <p>{t(`${items.length} 项内容`, `${items.length} items`)}{status === 'done' && ` · ${t('保留链接与笔记，随时可以重新开始。', 'Links and notes are kept. Restart any time.')}`}</p>
        <div className="reading-management-actions">
          <button ref={bulkButton} className="pw-text-button" onClick={() => { setSelecting(!selecting); setSelected(new Set()); }} aria-pressed={selecting} disabled={!!busy || !!removal || !shelf?.items.length}>{selecting ? t('结束多选', 'Exit selection') : t('批量移除', 'Remove multiple')}</button>
          <button className="pw-text-button reading-remove" onClick={() => askRemoval('all', shelf?.items ?? [])} disabled={!!busy || !!removal || !!completing.size || !shelf?.items.length}>{t('全部移除', 'Remove all')}</button>
        </div>
      </div>
      {selecting && <div className="reading-selection" aria-label={t('批量管理', 'Bulk actions')}>
        <label className="reading-select-all"><input ref={selectAll} type="checkbox" checked={allSelected} onChange={e => setSelected(new Set(e.target.checked ? selectable.map(item => item.id) : []))} disabled={!!busy || !!removal || !selectable.length}/><span>{t('全选当前列表', 'Select current list')}</span></label>
        <span role="status">{t(`已选 ${selectedItems.length} 项`, `${selectedItems.length} selected`)}</span>
        <button className="pw-button small reading-danger-button" disabled={!!busy || !!removal || !selectedItems.length} onClick={() => askRemoval('selected', selectedItems)}>{t(`移除所选（${selectedItems.length}）`, `Remove selected (${selectedItems.length})`)}</button>
      </div>}
      {removal && <section className="reading-removal" aria-labelledby="reading-removal-title">
        <h3 id="reading-removal-title" ref={removalHeading} tabIndex={-1}>{removal.scope === 'all' ? t(`移除整个书架的 ${removal.items.length} 项？`, `Remove all ${removal.items.length} shelf items?`) : t(`移除这 ${removal.items.length} 项？`, `Remove these ${removal.items.length} items?`)}</h3>
        <p>{removal.scope === 'all' ? t('包含当前筛选外和已完成的条目。', 'Includes items outside the current filter and finished items.') : t('只移除下面选定的书架条目。', 'Only the selected shelf items below will be removed.')} {t('移入回收站后保留 30 天，期间可以恢复，到期不可恢复。原始文件和网页保留；移出的来源不会被自动导入回来。', 'Items can be restored from the recycle bin for 30 days. After that they cannot be recovered. Original files and pages are kept; removed sources are not imported again.')}</p>
        <ul>{removal.items.slice(0, 3).map(item => <li key={item.id}>{item.title}</li>)}</ul>
        {removal.items.length > 3 && <small>{t(`另有 ${removal.items.length - 3} 项`, `And ${removal.items.length - 3} more`)}</small>}
        <div className="reading-removal-actions"><button className="pw-button" onClick={cancelRemoval} disabled={!!busy}>{t('取消', 'Cancel')}</button><button className="pw-button reading-danger-button" onClick={() => void remove()} disabled={!!busy}>{busy === 'remove' ? t('移除中…', 'Removing…') : t('确认移除', 'Confirm removal')}</button></div>
      </section>}
      {loading ? <p className="pw-loading" role="status">{t('正在整理书架…', 'Opening the shelf…')}</p> : items.length ? <ul className="reading-list">{items.map(item => {
        const isCompleting = completing.has(item.id);
        return <li key={item.id} data-reading-id={item.id} className={`reading-entry${isCompleting ? ' is-completing' : ''}${selected.has(item.id) && selecting ? ' is-selected' : ''}`} onAnimationEnd={event => { if (event.target === event.currentTarget && event.animationName === 'reading-shelf-close') finishCompletion(item.id); }}>
          <div className="reading-entry-content"><div className={`reading-row reading-row--${item.type}`}>
            <div className="reading-marker">
              {selecting && <label className="reading-pick"><input type="checkbox" aria-label={t('选择：', 'Select: ') + item.title} checked={selected.has(item.id)} onChange={e => setSelected(previous => { const next = new Set(previous); e.target.checked ? next.add(item.id) : next.delete(item.id); return next; })} disabled={!!busy || !!removal || isCompleting}/><span className="pw-sr-only">{item.title}</span></label>}
              <div className="reading-bookmark" aria-hidden="true">{item.status === 'done' ? <Check width={22}/> : <BookOpen width={22}/>}</div>
            </div>
            <div className="reading-item-main">
              <VideoCover item={item} onCover={applyCover}/>
              <div className="reading-item-meta"><span>{item.origin === 'report' ? item.reportSource === 'tech' ? t('科技早报', 'Tech digest') : t('审美图鉴', 'Aesthetic atlas') : t(...typeNames[item.type])}</span>{item.origin === 'report' && <time>{item.reportSource === 'tech' ? t('报道日期', 'Coverage date') : t('刊期', 'Issue')} {item.reportDate}</time>}<span className="reading-category">{t(...categoryNames[item.category ?? 'other'])}</span>{item.updatedSinceRead && <span className="reading-updated">{t('读后有更新', 'Updated since reading')}</span>}{isCompleting && <span className="reading-completion-label"><Check width={15}/>{t('已完成，收好啦', 'Finished & tucked away')}</span>}</div>
              <h3>{item.title}</h3>{item.status === 'done' && item.finishedAt && <p className="reading-finished-date">{t('完成于', 'Finished')} {dateLabel(item.finishedAt, locale)}</p>}{item.notes && <p className="reading-item-note">{item.notes}</p>}{item.url && <p className="reading-item-url">{item.url}</p>}
              <div className="reading-item-links">
                {(item.pdfUrl || item.url) && <a className="pw-text-button" href={item.pdfUrl || item.url} target="_blank" rel="noopener noreferrer">{item.origin === 'report' ? t('阅读 PDF', 'Read PDF') : t('打开链接', 'Open link')} <ArrowRight width={15}/></a>}
                {item.origin === 'manual' && <button className="pw-text-button" onClick={() => beginEdit(item)} disabled={!!busy || !!removal || isCompleting}>{t('编辑', 'Edit')}</button>}
                <button className="pw-text-button reading-remove" onClick={() => askRemoval('one', [item])} disabled={!!busy || !!removal || isCompleting}>{t('移出', 'Remove')}</button>
                <small>{t('更新于', 'Updated')} {dateLabel(item.updatedAt, locale)}</small>
              </div>
            </div>
            <label className="reading-progress"><span className="pw-sr-only">{t('阅读进度：', 'Reading progress: ')}{item.title}</span><select value={item.status} onChange={e => void changeStatus(item, e.target.value as ReadingStatus)} disabled={!!busy || !!removal || isCompleting}>{Object.entries(statusNames).map(([value, labels]) => <option key={value} value={value}>{t(...labels)}</option>)}</select></label>
          </div></div>
        </li>;
      })}</ul> : <Empty title={search || kind !== 'all' || category !== 'all' || status !== 'active' ? t('这层书架，暂时没有匹配项', 'No matching items on this shelf') : t('给好奇心，留一点位置', 'Make room for your curiosity')}><p>{status === 'done' ? t('完成的内容会留在这里，随时可以重新开始。', 'Finished items stay here. You can restart them any time.') : t('收下一本书、一段视频，或在“已完成”中回看。', 'Save a book or a video, or revisit something under Finished.')}</p></Empty>}
    </section>
    <details className="reading-source-settings"><summary><Folder width={16}/>{t('日报来源与目录', 'Report sources & folders')}</summary><p className="pw-footnote">{t('仅收录目录根层的正式 PDF。科技日期代表报道覆盖日；审美日期代表刊期。', 'Only final PDFs in each folder are listed. Tech dates refer to the day covered; aesthetic dates are issue dates.')}</p><div className="reading-source-status">{shelf?.sources.map(source => <p key={source.id}><strong>{source.label}</strong><span>{source.status === 'ready' ? t(`${source.count} 份报告`, `${source.count} reports`) : source.message || t('尚未找到目录', 'Folder not found')}</span></p>)}</div><form onSubmit={saveSources}><label>{t('科技早报目录', 'Tech digest folder')}<input value={techPath} onChange={e => setTechPath(e.target.value)} spellCheck={false} disabled={!!busy}/></label><label>{t('审美图鉴目录', 'Aesthetic atlas folder')}<input value={aestheticPath} onChange={e => setAestheticPath(e.target.value)} spellCheck={false} disabled={!!busy}/></label><button className="pw-button small" disabled={!!busy}>{t('保存目录', 'Save folders')}</button></form></details>
    </>}
  </div>;
}
