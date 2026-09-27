import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash } from 'pixelarticons/react';
import { request } from './api';
import { usePreferences } from './Preferences';
import { Notice, PageHead } from './shared';
import { detailIdeaDraft, entryKinds, ideaDate, ideaKindNames, ideaStatusNames, useIdeaDraft, type Idea, type IdeaEntry, type IdeaEntryKind } from './ideas-model';
import InspirationDetails from './InspirationDetails';
import '../styles/ideas.css';

export default function IdeaDetail() {
  const { id = '' } = useParams();
  return <IdeaDetailContent key={id} id={id}/>;
}

function IdeaDetailContent({ id }: { id: string }) {
  const { t, locale } = usePreferences();
  const navigate = useNavigate();
  const { draft, setDraft, settleDraft, storageAvailable, dirty } = useIdeaDraft(`dailyhouse-idea-draft:${id}`, detailIdeaDraft);
  const [idea, setIdea] = useState<Idea | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [metaOpen, setMetaOpen] = useState(Boolean(draft.status));
  const [remove, setRemove] = useState('');
  const [newestFirst, setNewestFirst] = useState(false);
  const generation = useRef(0);
  const alive = useRef(true);
  const mutation = useRef(false);
  const updateInput = useRef<HTMLTextAreaElement>(null);
  const editInput = useRef<HTMLTextAreaElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const timelineHeading = useRef<HTMLHeadingElement>(null);
  const deleteHeading = useRef<HTMLHeadingElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const metadataButton = useRef<HTMLButtonElement>(null);
  const entryHeadings = useRef(new Map<string, HTMLHeadingElement>());
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const deleteButtons = useRef(new Map<string, HTMLButtonElement>());
  const path = `/ideas/${encodeURIComponent(id)}`;

  async function load() {
    const run = ++generation.current;
    setLoading(true); setError('');
    try { const data = await request<Idea>(path); if (alive.current && run === generation.current) setIdea(data); }
    catch (err) { if (alive.current && run === generation.current) setError((err as Error).message); }
    finally { if (alive.current && run === generation.current) setLoading(false); }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; generation.current++; }; }, [id]);
  useEffect(() => { if (draft.editingId && !loading) editInput.current?.focus(); }, [draft.editingId, loading]);
  useEffect(() => { if (metaOpen && !loading) titleInput.current?.focus(); }, [metaOpen, loading]);
  useEffect(() => { if (remove) deleteHeading.current?.focus(); }, [remove]);

  async function change(action: string, suffix: string, method: string, body: Record<string, unknown>, saved: (result: Idea) => void, settle?: () => void) {
    if (!idea || mutation.current || loading) return;
    mutation.current = true; setBusy(action); setError(''); setFeedback('');
    try {
      const result = await request<Idea>(`${path}${suffix}`, method, { ...body, revision: idea.revision });
      settle?.();
      if (alive.current) { if (action !== 'delete-idea') setIdea(result); saved(result); }
    } catch (err) { if (alive.current) setError((err as Error).message); }
    finally { mutation.current = false; if (alive.current) setBusy(''); }
  }
  function focusTimeline(entryId?: string) {
    window.setTimeout(() => {
      if (!alive.current) return;
      const element = (entryId ? entryHeadings.current.get(entryId) : null) || timelineHeading.current;
      element?.focus(); element?.scrollIntoView?.({ block: 'nearest' });
    }, 0);
  }
  function append(event: FormEvent) {
    event.preventDefault(); if (!draft.content.trim()) return;
    void change('append', '/entries', 'POST', { content: draft.content.trim(), kind: entryKinds.includes(draft.kind as Exclude<IdeaEntryKind, 'initial'>) ? draft.kind : 'note' }, result => {
      setFeedback(t('更新已保存。', 'Update saved.'));
      focusTimeline(result.entries[result.entries.length - 1]?.id);
    }, () => settleDraft({ content: draft.content, kind: draft.kind }, { content: '', kind: 'note' }));
  }
  function saveMetadata(event: FormEvent) {
    event.preventDefault(); if (!draft.title.trim()) return;
    void change('metadata', '', 'PATCH', { title: draft.title.trim(), status: draft.status }, () => {
      setMetaOpen(false); setFeedback(t('想法信息已保存。', 'Idea details saved.'));
      window.setTimeout(() => metadataButton.current?.focus(), 0);
    }, () => settleDraft({ title: draft.title, status: draft.status }, { title: '', status: '' }));
  }
  function startEdit(entry: IdeaEntry) { setRemove(''); setDraft({ ...draft, editingId: entry.id, editContent: entry.content, editKind: entry.kind }); }
  function cancelEdit() {
    const previousId = draft.editingId;
    setDraft({ ...draft, editingId: '', editContent: '', editKind: 'note' });
    window.setTimeout(() => editButtons.current.get(previousId)?.focus(), 0);
  }
  function saveEntry(event: FormEvent, entry: IdeaEntry) {
    event.preventDefault(); if (!draft.editContent.trim()) return;
    void change('edit', `/entries/${encodeURIComponent(entry.id)}`, 'PATCH', { content: draft.editContent.trim(), ...(entry.kind === 'initial' ? {} : { kind: draft.editKind }) }, () => {
      setFeedback(t('记录已保存。', 'Entry saved.')); focusTimeline(entry.id);
    }, () => settleDraft({ editingId: draft.editingId, editContent: draft.editContent, editKind: draft.editKind }, { editingId: '', editContent: '', editKind: 'note' }));
  }
  function cancelRemove() {
    const previous = remove; setRemove('');
    window.setTimeout(() => { if (previous === 'idea') deleteButton.current?.focus(); else deleteButtons.current.get(previous)?.focus(); }, 0);
  }
  function deleteEntry(entry: IdeaEntry) {
    void change('delete-entry', `/entries/${encodeURIComponent(entry.id)}`, 'DELETE', {}, () => {
      setRemove(''); if (draft.editingId === entry.id) setDraft({ ...draft, editingId: '', editContent: '', editKind: 'note' });
      setFeedback(t('这条更新已删除。', 'Update deleted.')); focusTimeline();
    });
  }
  const disabled = Boolean(busy) || loading;
  const entries = idea ? [...idea.entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [];
  if (newestFirst) entries.reverse();
  const missingEdit = idea && draft.editingId && !idea.entries.some(entry => entry.id === draft.editingId);
  return <div className="pw-page ideas-page idea-detail-page">
    <Link className="pw-text-button idea-back" to="/ideas" aria-disabled={!!busy || undefined} onClick={event => { if (busy) event.preventDefault(); }}><ArrowLeft width={18}/>{t('返回想法列表', 'Back to ideas')}</Link>
    <PageHead title={idea?.title || t('想法时间线', 'Idea timeline')} description={t('每次补充，都接在这个想法后面。', 'Every update adds to this idea’s story.')}>
      {idea && <button className="pw-button primary" disabled={disabled || !!remove} onClick={() => { updateInput.current?.focus(); updateInput.current?.scrollIntoView?.({ block: 'center' }); }}><Plus width={18}/>{t('追加更新', 'Add an update')}</button>}
    </PageHead>
    {error && <Notice error>{error} <button className="pw-text-button" disabled={disabled} onClick={() => void load()}>{t('刷新已保存内容', 'Refresh saved content')}</button><span className="idea-error-hint">{t('未保存的文字会保留；刷新后请核对最新记录，再保存。', 'Your draft is kept. Review the latest entries after refreshing, then save.')}</span></Notice>}
    {feedback && <Notice>{feedback}</Notice>}
    {!storageAvailable && dirty && <Notice>{t('浏览器暂时不能保存草稿。切换页面仍会保留，请在关闭或刷新前保存。', 'Draft storage is unavailable. Your draft survives page navigation; save it before closing or refreshing this tab.')}</Notice>}
    {loading && <p className="pw-loading" role="status">{t('正在读取时间线…', 'Loading the timeline…')}</p>}
    {!loading && !idea && !error && <Notice error>{t('没有找到这个想法。', 'This idea could not be found.')}</Notice>}
    {idea && !loading && <>
      <div className="idea-summary"><span className="idea-status">{t(...ideaStatusNames[idea.status])}</span><span>{t('创建于 ', 'Created ')}<time dateTime={idea.createdAt}>{ideaDate(idea.createdAt, locale)}</time></span><span>{t(`${Math.max(0, idea.entries.length - 1)} 次更新`, `${Math.max(0, idea.entries.length - 1)} updates`)}</span>
        <button ref={metadataButton} className="pw-text-button" disabled={disabled || !!remove || metaOpen} onClick={() => { setDraft({ ...draft, title: idea.title, status: idea.status }); setMetaOpen(true); }}>{t('编辑标题与状态', 'Edit title & status')}</button>
      </div>
      <InspirationDetails ideaId={idea.id} revision={idea.revision} onCanonicalChanged={async () => { const latest = await request<Idea>(path); if (alive.current) setIdea(latest); }}/>
      {metaOpen && <form className="idea-metadata pw-paper" onSubmit={saveMetadata}><label>{t('想法标题', 'Idea title')}<input ref={titleInput} value={draft.title} maxLength={200} required disabled={disabled || !!remove} onChange={event => setDraft({ ...draft, title: event.target.value })}/></label><label>{t('想法状态', 'Idea status')}<select aria-label={t('想法状态', 'Idea status')} value={draft.status} disabled={disabled || !!remove} onChange={event => setDraft({ ...draft, status: event.target.value })}>{Object.entries(ideaStatusNames).map(([key, names]) => <option key={key} value={key}>{t(...names)}</option>)}</select></label><div className="idea-actions"><button className="pw-button primary" disabled={disabled || !!remove || !draft.title.trim()}>{busy === 'metadata' ? t('保存中…', 'Saving…') : t('保存信息', 'Save details')}</button><button type="button" className="pw-text-button" disabled={disabled || !!remove} onClick={() => { setDraft({ ...draft, title: '', status: '' }); setMetaOpen(false); window.setTimeout(() => metadataButton.current?.focus(), 0); }}>{t('取消编辑', 'Cancel editing')}</button></div></form>}
      {missingEdit && <section className="idea-orphan pw-paper"><h2>{t('保留的编辑草稿', 'Your saved editing draft')}</h2><p>{t('原记录已不存在，下面的草稿仍然保留，可复制到新更新中。', 'The original entry no longer exists. Your draft is kept below so you can copy it into a new update.')}</p><textarea aria-label={t('保留的编辑草稿', 'Saved editing draft')} rows={4} value={draft.editContent} readOnly/><button className="pw-text-button" disabled={disabled || !!remove} onClick={cancelEdit}>{t('放弃这份编辑草稿', 'Discard this editing draft')}</button></section>}
      <section className="idea-history" aria-labelledby="idea-history-title"><div className="idea-history-head"><h2 id="idea-history-title" ref={timelineHeading} tabIndex={-1}>{t('想法时间线', 'Idea timeline')}</h2><label><span className="pw-sr-only">{t('时间线顺序', 'Timeline order')}</span><select aria-label={t('时间线顺序', 'Timeline order')} value={newestFirst ? 'newest' : 'oldest'} disabled={disabled || !!remove} onChange={event => setNewestFirst(event.target.value === 'newest')}><option value="oldest">{t('从最初到最新', 'Oldest first')}</option><option value="newest">{t('从最新到最初', 'Newest first')}</option></select></label></div>
        <ol className="idea-timeline">{entries.map(entry => <li key={entry.id} className={`idea-timeline-entry idea-entry-${entry.kind}`}><article>
          <header className="idea-entry-head"><div><h3 ref={element => { if (element) entryHeadings.current.set(entry.id, element); else entryHeadings.current.delete(entry.id); }} tabIndex={-1}>{t(...ideaKindNames[entry.kind])}</h3><time dateTime={entry.createdAt}>{ideaDate(entry.createdAt, locale)}</time>{entry.updatedAt !== entry.createdAt && <span className="idea-edited">{t(' · 编辑于 ', ' · Edited ')}<time dateTime={entry.updatedAt}>{ideaDate(entry.updatedAt, locale)}</time></span>}</div>
            <div className="idea-entry-actions"><button ref={element => { if (element) editButtons.current.set(entry.id, element); else editButtons.current.delete(entry.id); }} className="pw-text-button" aria-label={t('编辑记录', 'Edit entry')} disabled={disabled || !!remove || !!draft.editingId} onClick={() => startEdit(entry)}>{t('编辑', 'Edit')}</button>{entry.kind !== 'initial' && <button ref={element => { if (element) deleteButtons.current.set(entry.id, element); else deleteButtons.current.delete(entry.id); }} className="pw-text-button idea-danger" aria-label={t('删除记录', 'Delete entry')} disabled={disabled || !!remove || !!draft.editingId} onClick={() => setRemove(entry.id)}>{t('删除', 'Delete')}</button>}</div>
          </header>
          {draft.editingId === entry.id ? <form className="idea-entry-editor" onSubmit={event => saveEntry(event, entry)}>{entry.kind !== 'initial' && <label>{t('记录类型', 'Entry type')}<select aria-label={t('记录类型', 'Entry type')} value={draft.editKind} disabled={disabled || !!remove} onChange={event => setDraft({ ...draft, editKind: event.target.value })}>{entryKinds.map(kind => <option key={kind} value={kind}>{t(...ideaKindNames[kind])}</option>)}</select></label>}<label>{t('编辑内容', 'Edit content')}<textarea ref={editInput} value={draft.editContent} rows={5} maxLength={20000} required disabled={disabled || !!remove} onChange={event => setDraft({ ...draft, editContent: event.target.value })}/></label><div className="idea-actions"><button className="pw-button primary" disabled={disabled || !!remove || !draft.editContent.trim()}>{busy === 'edit' ? t('保存中…', 'Saving…') : t('保存记录', 'Save entry')}</button><button type="button" className="pw-text-button" disabled={disabled || !!remove} onClick={cancelEdit}>{t('取消编辑', 'Cancel editing')}</button></div></form> : <p className="idea-entry-content">{entry.content}</p>}
          {remove === entry.id && <div className="idea-delete-confirm"><h3 ref={deleteHeading} tabIndex={-1}>{t('删除这条更新？', 'Delete this update?')}</h3><p>{t('这条记录将永久删除，其他时间线记录会保留。', 'This entry will be permanently deleted. The rest of the timeline will remain.')}</p><div className="idea-actions"><button className="pw-button idea-danger-button" disabled={disabled} onClick={() => deleteEntry(entry)}>{busy === 'delete-entry' ? t('删除中…', 'Deleting…') : t('确认删除这条更新', 'Delete this update')}</button><button className="pw-text-button" disabled={disabled} onClick={cancelRemove}>{t('取消删除', 'Cancel deletion')}</button></div></div>}
        </article></li>)}</ol>
      </section>
      <section className="idea-compose pw-paper" aria-labelledby="idea-compose-title"><div className="pw-section-head"><h2 id="idea-compose-title">{t('随手记进时间线', 'Add a note to the timeline')}</h2></div><form onSubmit={append}><label className="idea-kind-field">{t('更新类型', 'Update type')}<select aria-label={t('更新类型', 'Update type')} value={draft.kind} disabled={disabled || !!remove} onChange={event => setDraft({ ...draft, kind: event.target.value })}>{entryKinds.map(kind => <option key={kind} value={kind}>{t(...ideaKindNames[kind])}</option>)}</select></label><label>{t('这次的新想法', 'What’s new?')}<textarea ref={updateInput} value={draft.content} onChange={event => setDraft({ ...draft, content: event.target.value })} maxLength={20000} rows={5} required disabled={disabled || !!remove} placeholder={t('补上一点进展、一个决定，或还没想清的问题…', 'Add a thought, some progress, a decision or an open question…')}/></label><div className="idea-actions"><button className="pw-button primary" disabled={disabled || !!remove || !draft.content.trim()}>{busy === 'append' ? t('保存中…', 'Saving…') : t('保存更新', 'Save update')}</button><small>{draft.content.trim() ? t('草稿会保留在当前标签页。', 'Draft kept in this browser tab.') : t('保存后会成为时间线上的一条新记录。', 'Each saved update becomes a new entry in the timeline.')}</small></div></form></section>
      <footer className="idea-footer"><button ref={deleteButton} className="pw-text-button idea-danger" disabled={disabled || !!remove} onClick={() => setRemove('idea')}><Trash width={17}/>{t('删除想法', 'Delete idea')}</button></footer>
      {remove === 'idea' && <section className="idea-delete-confirm" aria-labelledby="idea-delete-title"><h3 id="idea-delete-title" ref={deleteHeading} tabIndex={-1}>{t('删除整个想法？', 'Delete this entire idea?')}</h3><p>{t(`“${idea.title}”及其全部 ${idea.entries.length} 条时间线记录将移入回收站，30 天内可恢复。未保存的草稿会清除。`, `“${idea.title}” and all ${idea.entries.length} timeline entries will move to the recycle bin for 30 days. Unsaved drafts will be cleared.`)}</p><div className="idea-actions"><button className="pw-button idea-danger-button" disabled={disabled} onClick={() => void change('delete-idea', '', 'DELETE', {}, () => navigate('/ideas'), () => settleDraft({}, null))}>{busy === 'delete-idea' ? t('删除中…', 'Deleting…') : t('确认删除整个想法', 'Delete the entire idea')}</button><button className="pw-text-button" disabled={disabled} onClick={cancelRemove}>{t('取消删除', 'Cancel deletion')}</button></div></section>}
    </>}
  </div>;
}
