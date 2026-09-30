import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Plus, Search, Trash } from 'pixelarticons/react';
import { dateLabel, localDay, request, type Todo } from './api';
import { usePreferences } from './Preferences';
import { useWorkspace } from './Workspace';
import { Empty, Notice, PageHead } from './shared';
import { LearningEntryForm, LearningPlanForm } from './LearningForms';
import type { LearningEntry, LearningKind, LearningPlan, LearningRemoved, LearningStatus, LearningSummary } from './learning-model';
import '../styles/ideas.css';
import '../styles/learning.css';

const statusNames: Record<LearningStatus, [string, string]> = { active: ['进行中', 'Active'], paused: ['暂缓', 'Paused'], done: ['已完成', 'Completed'] };
const kindNames: Record<LearningKind, [string, string]> = { initial: ['学习起点', 'Starting point'], progress: ['进展', 'Progress'], question: ['疑问', 'Question'], milestone: ['阶段成果', 'Milestone'], resource: ['资料', 'Resource'] };
const planPath = (id: string) => `/learning/${encodeURIComponent(id)}`;

export default function LearningPage() {
  const { t, locale, language } = usePreferences();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const trash = params.get('trash') === '1';
  const [items, setItems] = useState<(LearningSummary | LearningRemoved)[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [open, setOpen] = useState(false), [search, setSearch] = useState(''), [status, setStatus] = useState('all');
  const addButton = useRef<HTMLButtonElement>(null), generation = useRef(0), saving = useRef(false);
  const load = useCallback(async () => {
    const token = ++generation.current;
    setLoading(true); setError('');
    try { const result = await request<{ items: (LearningSummary | LearningRemoved)[] }>(trash ? '/learning/trash' : '/learning'); if (token === generation.current) setItems(result.items); }
    catch (err) { if (token === generation.current) setError((err as Error).message); }
    finally { if (token === generation.current) setLoading(false); }
  }, [trash, language]);
  useEffect(() => { setItems([]); void load(); return () => { generation.current++; }; }, [load]);
  async function create(body: Record<string, unknown>) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try { const plan = await request<LearningPlan>('/learning', 'POST', body); navigate(planPath(plan.id)); }
    catch (err) { setError((err as Error).message); }
    finally { saving.current = false; setBusy(false); }
  }
  async function restore(item: LearningRemoved) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try { const plan = await request<LearningPlan>(`${planPath(item.id)}/restore`, 'POST', { revision: item.revision }); navigate(planPath(plan.id)); }
    catch (err) { setError((err as Error).message); }
    finally { saving.current = false; setBusy(false); }
  }
  const visible = items.filter(item => (status === 'all' || status === item.status) && `${item.title} ${item.course} ${item.goal} ${item.preview}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <div className="pw-page ideas-page learning-page">
    <PageHead title={t('学习计划', 'Study plans')} description={t('把课程与长期目标，推进成今天的一小步。', 'Turn courses and longer goals into one small step today.')}>
      <button ref={addButton} className="pw-button primary" disabled={busy} onClick={() => setOpen(true)}><Plus width={18}/>{t('新建计划', 'New plan')}</button>
    </PageHead>
    {error && <Notice error>{error} <button className="pw-text-button" disabled={busy || loading} onClick={() => void load()}>{t('重新读取', 'Retry loading')}</button></Notice>}
    {open && <section className="pw-paper idea-new" aria-labelledby="learning-new-title"><h2 id="learning-new-title">{t('开始一个学习计划', 'Start a study plan')}</h2><LearningPlanForm busy={busy} onSave={create} onCancel={() => { setOpen(false); addButton.current?.focus(); }}/></section>}
    <div className="idea-view-tabs" role="group" aria-label={t('学习计划视图', 'Study plan view')}><button className="pw-text-button" aria-pressed={!trash} disabled={busy} onClick={() => setParams({})}>{t('我的计划', 'My plans')}</button><button className="pw-text-button" aria-pressed={trash} disabled={busy} onClick={() => setParams({ trash: '1' })}><Trash width={17}/>{t('回收站', 'Recycle bin')}</button></div>
    {trash && <p className="idea-trash-hint">{t('计划与时间线保留 30 天，可一起恢复。已加入的待办始终保留。', 'Plans and timelines can be restored for 30 days. Tasks already added are kept.')}</p>}
    <section className="idea-shelf" aria-label={trash ? t('学习计划回收站', 'Study plan recycle bin') : t('学习计划列表', 'Study plan list')}>
      <div className="idea-filters"><label className="pw-search"><Search width={18}/><input aria-label={t('搜索学习计划', 'Search study plans')} placeholder={t('搜索计划、课程或最新记录', 'Search plans, courses or latest entries')} value={search} onChange={e => setSearch(e.target.value)}/></label><label><span className="pw-sr-only">{t('筛选计划状态', 'Filter plan status')}</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="all">{t('全部状态', 'All statuses')}</option>{Object.entries(statusNames).map(([key, names]) => <option key={key} value={key}>{t(...names)}</option>)}</select></label><button className="pw-text-button" disabled={busy || loading} onClick={() => void load()}>{t('刷新', 'Refresh')}</button></div>
      {loading ? <p className="pw-loading" role="status">{t('正在打开学习计划…', 'Opening study plans…')}</p> : error && !items.length ? <p className="idea-load-hint">{t('读取失败，请重试。新建表单中的草稿仍在。', 'Loading failed. Retry when ready; your new plan draft is kept.')}</p> : !visible.length ? <Empty title={items.length ? t('没有匹配的计划', 'No matching plans') : trash ? t('回收站是空的', 'The recycle bin is empty') : t('从一门课、一个目标开始', 'Start with a course or a goal')}><p>{items.length ? t('试试其他关键词，或查看全部状态。', 'Try another search or show all statuses.') : trash ? t('删除的计划会暂时保留在这里。', 'Deleted plans stay here temporarily.') : t('新建后进入计划的专属页面，持续记录进展、疑问和资料。零散的点子可以记在灵感库。', 'Create a plan to keep its progress, questions and resources together. Capture passing ideas in the Idea garden.')}</p></Empty> : <><p className="idea-count">{t(`${visible.length} 个计划`, `${visible.length} plans`)}</p><ul className="idea-list">{visible.map(item => <li key={item.id}>{trash ? <div className="idea-trash-row"><div className="idea-list-main"><h2>{item.title}</h2><p className="idea-preview">{item.goal}</p><div className="idea-meta"><span>{t('可恢复至 ', 'Restore before ')}<time dateTime={(item as LearningRemoved).expiresAt}>{dateLabel((item as LearningRemoved).expiresAt, locale)}</time></span><span>{t(`${item.entryCount} 条记录`, `${item.entryCount} entries`)}</span></div></div><button className="pw-button" disabled={busy} aria-label={t(`恢复计划：${item.title}`, `Restore plan: ${item.title}`)} onClick={() => void restore(item as LearningRemoved)}>{t('恢复并打开', 'Restore & open')}</button></div> : <Link className="idea-list-link" to={planPath(item.id)}><div className="idea-list-main"><div className="idea-list-title"><h2>{item.title}</h2><span className="idea-status">{t(...statusNames[item.status])}</span></div>{item.course && <p className="learning-course">{item.course}</p>}<p className="idea-preview">{item.goal || item.preview}</p><div className="idea-meta"><span>{t(`${item.entryCount} 条记录`, `${item.entryCount} entries`)}</span><span>{t('最后更新 ', 'Updated ')}<time dateTime={item.updatedAt}>{dateLabel(item.updatedAt, locale)}</time></span>{item.dueDate && <span>{t('目标 ', 'Target ')}{item.dueDate}</span>}</div></div><ArrowRight width={22} aria-hidden="true"/></Link>}</li>)}</ul></>}
    </section>
  </div>;
}

function NextStep({ text, task, busy, add }: { text: string; task?: Todo; busy: boolean; add: () => void }) {
  const { t } = usePreferences();
  return text ? <div className="learning-next-step"><div><span className="pw-subtle">{t('下一步', 'Next step')}</span><p>{text}</p>{task && task.title !== text && <small>{t('待办中的名称：', 'Task name: ')}{task.title}</small>}</div>{task ? <Link className="pw-text-button" to={`/todos?task=${encodeURIComponent(task.id)}`}>{task.done ? t('查看已完成待办', 'View completed task') : t('查看待办', 'View task')} <ArrowRight width={16}/></Link> : <button className="pw-button small" disabled={busy} onClick={add}>{t('加入今日待办', 'Add to today')}</button>}</div> : null;
}

export function LearningDetailPage() {
  const { id = '' } = useParams();
  return <LearningDetail key={id}/>;
}

function LearningDetail() {
  const { id = '' } = useParams();
  const { t, locale, language } = usePreferences();
  const { data, refresh } = useWorkspace();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<LearningPlan | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [feedback, setFeedback] = useState('');
  const [editor, setEditor] = useState<'plan' | 'new' | string>(''), [remove, setRemove] = useState(''), [order, setOrder] = useState<'oldest' | 'newest'>('oldest'), [showRemoved, setShowRemoved] = useState(false);
  const generation = useRef(0), saving = useRef(false), confirm = useRef<HTMLDivElement>(null), history = useRef<HTMLHeadingElement>(null), updateButton = useRef<HTMLButtonElement>(null), planEditButton = useRef<HTMLButtonElement>(null);
  const load = useCallback(async () => {
    const token = ++generation.current;
    setLoading(true); setError('');
    try { const result = await request<LearningPlan>(planPath(id)); if (token === generation.current) setPlan(result); }
    catch (err) { if (token === generation.current) setError((err as Error).message); }
    finally { if (token === generation.current) setLoading(false); }
  }, [id, language]);
  useEffect(() => { setPlan(null); setEditor(''); setRemove(''); setFeedback(''); setOrder('oldest'); setShowRemoved(false); void load(); return () => { generation.current++; }; }, [id]); // Language refreshes below without discarding the draft.
  useEffect(() => { if (plan) void load(); }, [language]);
  useEffect(() => { if (remove) confirm.current?.focus(); }, [remove]);
  async function mutate(path: string, method: string, body: Record<string, unknown>, message: string, after?: () => void) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(''); setFeedback('');
    try {
      const result = await request<LearningPlan>(path, method, body);
      setPlan(result); setFeedback(message); after?.(); await refresh();
    } catch (err) { setError((err as Error).message); try { setPlan(await request<LearningPlan>(planPath(id))); } catch { /* Keep the visible plan and draft. */ } }
    finally { saving.current = false; setBusy(false); }
  }
  async function removePlan() {
    if (!plan || saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try { await request(planPath(id), 'DELETE', { revision: plan.revision, confirmed: true }); await refresh(); navigate('/learning?trash=1'); }
    catch (err) { setError((err as Error).message); try { setPlan(await request<LearningPlan>(planPath(id))); } catch { /* Keep confirmation visible. */ } }
    finally { saving.current = false; setBusy(false); }
  }
  async function addTodo(entry?: LearningEntry) {
    if (!plan || saving.current) return;
    saving.current = true; setBusy(true); setError(''); setFeedback('');
    try { await request(`${planPath(id)}/todo`, 'POST', { revision: plan.revision, dueDate: localDay(), ...(entry ? { entryId: entry.id } : {}) }); await refresh(); setFeedback(t('已放进今日待办，可以从待办回到这个计划。', 'Added to today. The task links back to this plan.')); }
    catch (err) { setError((err as Error).message); try { setPlan(await request<LearningPlan>(planPath(id))); } catch { /* Keep the current plan. */ } }
    finally { saving.current = false; setBusy(false); }
  }
  function closeEditor() { const target = editor === 'plan' ? planEditButton : updateButton; setEditor(''); window.setTimeout(() => target.current?.focus(), 0); }
  function afterEntryChange() { setEditor(''); setRemove(''); window.setTimeout(() => history.current?.focus(), 0); }
  const taskFor = (stepId: string) => data?.todos.find(todo => todo.source?.kind === 'learning' && todo.source.id === id && todo.source.stepId === stepId);
  if (!plan) return <div className="pw-page ideas-page learning-page"><Link className="pw-text-button idea-back" to="/learning"><ArrowLeft width={17}/>{t('全部学习计划', 'All study plans')}</Link>{loading ? <p className="pw-loading" role="status">{t('正在打开计划…', 'Opening the plan…')}</p> : <><PageHead title={t('暂时打不开这个计划', 'This plan could not be opened')} description={t('如果已删除，可以在回收站中恢复。', 'If it was deleted, it may be in the recycle bin.')}/>{error && <Notice error>{error}</Notice>}<div className="idea-actions"><button className="pw-button" onClick={() => void load()}>{t('重新读取', 'Retry loading')}</button><Link className="pw-text-button" to="/learning?trash=1">{t('查看回收站', 'View recycle bin')}</Link></div></>}</div>;
  const entries = order === 'oldest' ? plan.entries : [...plan.entries].reverse();
  return <div className="pw-page ideas-page idea-detail-page learning-page">
    <Link className="pw-text-button idea-back" to="/learning"><ArrowLeft width={17}/>{t('全部学习计划', 'All study plans')}</Link>
    <PageHead title={plan.title} description={plan.course || t('一步一步，留下学习的轨迹。', 'Keep a record of your learning, one step at a time.')}><button ref={updateButton} className="pw-button primary" disabled={busy || !!editor || !!remove} onClick={() => setEditor('new')}><Plus width={18}/>{t('记录进展', 'Add update')}</button></PageHead>
    <div className="idea-summary"><span className="idea-status">{t(...statusNames[plan.status])}</span>{plan.dueDate && <span>{t('目标日期 ', 'Target date ')}{plan.dueDate}</span>}<span>{t(`${plan.entries.length} 条记录`, `${plan.entries.length} entries`)}</span><button ref={planEditButton} className="pw-text-button" disabled={busy || !!editor || !!remove} onClick={() => setEditor('plan')}>{t('编辑计划', 'Edit plan')}</button></div>
    {error && <Notice error>{error} <button className="pw-text-button" disabled={busy || loading} onClick={() => void load()}>{t('刷新计划', 'Refresh plan')}</button></Notice>}{feedback && <Notice>{feedback}</Notice>}
    {editor === 'plan' ? <section className="pw-paper idea-new"><h2>{t('编辑学习计划', 'Edit study plan')}</h2><LearningPlanForm plan={plan} busy={busy} onSave={body => mutate(planPath(id), 'PATCH', body, t('计划已保存。', 'Plan saved.'), closeEditor)} onCancel={closeEditor}/></section> : <section className="learning-goal" aria-labelledby="learning-goal-heading"><h2 id="learning-goal-heading">{t('学习目标', 'Learning goal')}</h2><p>{plan.goal || t('还没有写下目标，可以在“编辑计划”中补充。', 'Add a goal using “Edit plan” when you are ready.')}</p><NextStep text={plan.nextStep} task={taskFor(plan.nextStepId)} busy={busy || !!editor || !!remove} add={() => void addTodo()}/></section>}
    {editor === 'new' && <section className="pw-paper idea-new"><h2>{t('这次推进了什么？', 'What moved forward?')}</h2><LearningEntryForm plan={plan} busy={busy} onSave={body => mutate(`${planPath(id)}/entries`, 'POST', body, t('新记录已加入时间线。', 'The update is on your timeline.'), afterEntryChange)} onCancel={closeEditor}/></section>}
    <section className="idea-history" aria-labelledby="learning-history-heading"><div className="idea-history-head"><h2 id="learning-history-heading" ref={history} tabIndex={-1}>{t('学习时间线', 'Learning timeline')}</h2><label>{t('阅读顺序', 'Reading order')}<select value={order} onChange={e => setOrder(e.target.value as typeof order)}><option value="oldest">{t('从最初到最新', 'Oldest to newest')}</option><option value="newest">{t('最新在前', 'Newest first')}</option></select></label></div>
      {entries.length ? <ol className="idea-timeline">{entries.map(entry => <li key={entry.id} className={`idea-timeline-entry idea-entry-${entry.kind}`}><article aria-label={`${t(...kindNames[entry.kind])} ${dateLabel(entry.createdAt, locale)}`}><div className="idea-entry-head"><div><h3>{t(...kindNames[entry.kind])}</h3><time dateTime={entry.createdAt}>{dateLabel(entry.createdAt, locale)}</time>{entry.updatedAt !== entry.createdAt && <span className="idea-edited"> · {t('已编辑', 'Edited')}</span>}</div><div className="idea-entry-actions"><button className="pw-text-button" aria-label={t(`编辑记录：${entry.content.slice(0, 40) || '资料'}`, `Edit entry: ${entry.content.slice(0, 40) || 'Resource'}`)} disabled={busy || !!editor || !!remove} onClick={() => setEditor(entry.id)}>{t('编辑', 'Edit')}</button><button className="pw-text-button idea-danger" aria-label={t(`删除记录：${entry.content.slice(0, 40) || '资料'}`, `Delete entry: ${entry.content.slice(0, 40) || 'Resource'}`)} disabled={busy || !!editor || !!remove} onClick={() => setRemove(entry.id)}>{t('删除', 'Delete')}</button></div></div>
        {editor === entry.id ? <LearningEntryForm plan={plan} entry={entry} busy={busy} onSave={body => mutate(`${planPath(id)}/entries/${entry.id}`, 'PATCH', body, t('记录已保存，原时间顺序保持不变。', 'Entry saved in its original place on the timeline.'), afterEntryChange)} onCancel={closeEditor}/> : <>{entry.content && <p className="idea-entry-content">{entry.content}</p>}{!!entry.links.length && <ul className="learning-resources">{entry.links.map(link => <li key={link.id}><a href={link.url} target="_blank" rel="noopener noreferrer"><span>{link.title}</span><small>{new URL(link.url).hostname}</small><ArrowRight width={16} aria-hidden="true"/></a></li>)}</ul>}<NextStep text={entry.nextStep} task={taskFor(entry.nextStepId)} busy={busy || !!editor || !!remove} add={() => void addTodo(entry)}/></>}
        {remove === entry.id && <div ref={confirm} tabIndex={-1} className="idea-delete-confirm" role="alert"><h3>{t('删除这条记录？', 'Delete this entry?')}</h3><p>{t('这条记录及其链接可在 30 天内恢复。计划、其他记录、原网页与已加入的待办会保留。', 'This entry and its links can be restored for 30 days. The plan, other entries, original pages and existing tasks are kept.')}</p><div className="idea-actions"><button className="pw-button idea-danger-button" disabled={busy} onClick={() => void mutate(`${planPath(id)}/entries/${entry.id}`, 'DELETE', { revision: plan.revision, confirmed: true }, t('记录已移除，可在下方恢复。', 'Entry removed. Restore it below if needed.'), afterEntryChange)}>{t('确认删除记录', 'Confirm delete entry')}</button><button className="pw-text-button" disabled={busy} onClick={() => { setRemove(''); history.current?.focus(); }}>{t('保留记录', 'Keep entry')}</button></div></div>}
      </article></li>)}</ol> : <Empty title={t('时间线暂时留白', 'The timeline is empty')}><p>{t('点击“记录进展”补充内容，或恢复下方已移除的记录。', 'Add an update or restore a removed entry below.')}</p></Empty>}
      {!!plan.removedEntries.length && <div className="learning-removed"><button className="pw-text-button" aria-expanded={showRemoved} onClick={() => setShowRemoved(!showRemoved)}>{t(`已移除记录（${plan.removedEntries.length}）`, `Removed entries (${plan.removedEntries.length})`)}</button>{showRemoved && <><p className="pw-subtle">{t('保留 30 天，恢复后回到原来的时间位置。', 'Kept for 30 days; restored entries return to their original place.')}</p><ul>{plan.removedEntries.map(entry => <li key={entry.id}><div><strong>{t(...kindNames[entry.kind])}</strong><p>{entry.content || entry.links.map(link => link.title).join(' · ')}</p><small>{t('可恢复至 ', 'Restore before ')}{dateLabel(entry.expiresAt, locale)}</small></div><button className="pw-button small" disabled={busy || !!editor || !!remove} aria-label={t(`恢复记录：${entry.content.slice(0, 40) || '资料'}`, `Restore entry: ${entry.content.slice(0, 40) || 'Resource'}`)} onClick={() => void mutate(`${planPath(id)}/entries/${entry.id}/restore`, 'POST', { revision: plan.revision }, t('记录已回到原来的时间位置。', 'Entry restored to its original place.'), afterEntryChange)}>{t('恢复记录', 'Restore entry')}</button></li>)}</ul></>}</div>}
    </section>
    <div className="idea-footer"><button className="pw-text-button idea-danger" disabled={busy || !!editor || !!remove} onClick={() => setRemove('plan')}><Trash width={17}/>{t('删除这个计划', 'Delete this plan')}</button></div>
    {remove === 'plan' && <div ref={confirm} tabIndex={-1} className="idea-delete-confirm" role="alert"><h3>{t(`删除“${plan.title}”？`, `Delete “${plan.title}”?`)}</h3><p>{t('计划与完整时间线将移到回收站，保留 30 天。已加入的待办、灵感和原始资料不会删除。', 'The plan and its complete timeline move to the recycle bin for 30 days. Existing tasks, ideas and original resources are kept.')}</p><div className="idea-actions"><button className="pw-button idea-danger-button" disabled={busy} onClick={() => void removePlan()}>{t('确认删除计划', 'Confirm delete plan')}</button><button className="pw-text-button" disabled={busy} onClick={() => { setRemove(''); planEditButton.current?.focus(); }}>{t('保留计划', 'Keep plan')}</button></div></div>}
  </div>;
}
