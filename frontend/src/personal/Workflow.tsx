import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, Check, Copy, Plus } from 'pixelarticons/react';
import { localDay, request, type Todo } from './api';
import { usePreferences } from './Preferences';
import { useWorkspace } from './Workspace';
import { Empty, Notice, PageHead } from './shared';
import type { ReadingItem, ReadingState } from './reading-model';
import { buildWeeklyReview, buildWorkflowPrompt, kindLabel, kinds, statusLabel, statuses, suggestWorkflow, trackLabel, tracks, workflowMarkdown, type WorkflowDraft, type WorkflowItem, type WorkflowKind, type WorkflowStatus, type WorkflowTrack } from './workflow-model';
import '../styles/workflow.css';

const draftOf = ({ title, url, kind, track, status, notes, excerpt, nextAction, resumeAt, question }: WorkflowItem): WorkflowDraft => ({ title, url, kind, track, status, notes, excerpt, nextAction, resumeAt, question });
const draftKey = (id: string) => `dailyhouse-workflow-draft:${id}`;
function recoverDraft(item: WorkflowItem): WorkflowDraft | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey(item.id)) || 'null');
    if (!saved || saved.updatedAt !== item.updatedAt || !saved.draft) return null;
    const draft = saved.draft as WorkflowDraft;
    if (Object.keys(draftOf(item)).some(key => typeof draft[key as keyof WorkflowDraft] !== 'string') || !kinds.includes(draft.kind) || !tracks.includes(draft.track) || !statuses.includes(draft.status)) return null;
    return draftOf({ ...item, ...draft });
  } catch { return null; }
}
function lastSelection() { try { return sessionStorage.getItem('dailyhouse-workflow-selection') || ''; } catch { return ''; } }

function CopyPanel({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  const { t } = usePreferences();
  const [message, setMessage] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { area.current?.focus(); }, []);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setMessage(t('已复制，可以粘贴到你的 AI 工具或笔记中。', 'Copied. Paste into your AI tool or notes.')); }
    catch { area.current?.focus(); area.current?.select(); setMessage(t('自动复制不可用，已选中文本，请按 Ctrl+C / ⌘C。', 'Automatic copy is unavailable. Text selected; press Ctrl+C / ⌘C.')); }
  }
  return <section className="wf-copy" aria-label={title}>
    <div className="wf-section-heading"><h3>{title}</h3><button className="pw-text-button" onClick={onClose}>{t('收起', 'Close')}</button></div>
    <textarea ref={area} aria-label={title} value={text} readOnly rows={13}/>
    <div className="wf-actions"><button className="pw-button primary" onClick={() => void copy()}><Copy width={17} height={17}/>{t('复制全文', 'Copy all')}</button><span role="status">{message}</span></div>
  </section>;
}

function Capture({ onCreated, disabled }: { onCreated: (item: WorkflowItem) => void; disabled: boolean }) {
  const { language, t } = usePreferences();
  const [title, setTitle] = useState(''); const [url, setUrl] = useState('');
  const [kind, setKind] = useState<WorkflowKind | ''>(''); const [track, setTrack] = useState<WorkflowTrack | ''>('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const suggestion = suggestWorkflow(title, url);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || disabled || !title.trim()) return;
    setBusy(true); setError('');
    try {
      const item = await request<WorkflowItem>('/workflow', 'POST', { title, url, kind: kind || suggestion.kind, track: track || suggestion.track });
      setTitle(''); setUrl(''); setKind(''); setTrack(''); onCreated(item);
    } catch (err) { setError(err instanceof Error ? err.message : t('保存失败，请重试。', 'Could not save. Try again.')); }
    finally { setBusy(false); }
  }
  return <section className="wf-capture" aria-labelledby="wf-capture-title">
    <div className="wf-capture-heading"><h2 id="wf-capture-title">{t('先记下来', 'Catch the thought')}</h2><p>{t('一个念头、一段视频、一个没弄懂的问题，都可以。', 'An idea, a video, or a question you want to understand.')}</p></div>
    <form onSubmit={submit}>
      <label className="wf-capture-title">{t('想学或想做什么', 'What do you want to explore?')}<input disabled={busy} value={title} onChange={event => setTitle(event.target.value)} maxLength={200} required placeholder={t('例如：用一个小实验理解梯度下降', 'For example: understand gradient descent with a small experiment')}/></label>
      <label className="wf-capture-url">{t('来源链接（可选）', 'Source URL (optional)')}<input disabled={busy} type="url" value={url} onChange={event => setUrl(event.target.value)} maxLength={2000} placeholder="https://…"/></label>
      <label>{t('类型', 'Type')}<select disabled={busy} value={kind || suggestion.kind} onChange={event => setKind(event.target.value as WorkflowKind)}>{kinds.map(value => <option key={value} value={value}>{kindLabel(value, language)}</option>)}</select></label>
      <label>{t('方向', 'Track')}<select disabled={busy} value={track || suggestion.track} onChange={event => setTrack(event.target.value as WorkflowTrack)}>{tracks.map(value => <option key={value} value={value}>{trackLabel(value, language)}</option>)}</select></label>
      <button className="pw-button primary" disabled={busy || disabled || !title.trim()}><Plus width={18} height={18}/>{busy ? t('保存中…', 'Saving…') : t('放入待整理', 'Capture')}</button>
      <small className="wf-capture-hint">{t('类型和方向按链接、关键词本地建议，可以改。', 'Type and track are local suggestions from the URL and keywords. You can change them.')}</small>
    </form>
    {error && <Notice error>{error}</Notice>}
  </section>;
}

function ShelfImport({ onImported, disabled }: { onImported: (item: WorkflowItem) => void; disabled: boolean }) {
  const { t } = usePreferences();
  const [open, setOpen] = useState(false); const [items, setItems] = useState<ReadingItem[]>([]);
  const [query, setQuery] = useState(''); const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try { const result = await request<ReadingState>('/reading'); setItems(result.items.filter(item => item.origin === 'manual')); }
    catch (err) { setError(err instanceof Error ? err.message : t('书架读取失败。', 'Could not load the shelf.')); }
    finally { setLoading(false); }
  }
  async function importItem(id: string) {
    if (busy || disabled) return; setBusy(id); setError('');
    try { onImported(await request<WorkflowItem>('/workflow/import-reading', 'POST', { id })); }
    catch (err) { setError(err instanceof Error ? err.message : t('引入失败。', 'Could not import.')); }
    finally { setBusy(''); }
  }
  const filtered = items.filter(item => `${item.title} ${item.notes}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="wf-import">
    <button className="pw-text-button" disabled={disabled} aria-expanded={open} onClick={() => { setOpen(!open); if (!open) void load(); }}><BookOpen width={18} height={18}/>{t('从待读书架挑选', 'Choose from your reading shelf')}</button>
    {open && <div className="wf-import-content">
      <p>{t('把现在值得投入的内容引入工作流。同一书架条目只引入一次；原书架与这里的笔记、状态分别保存。', 'Bring in material worth working on now. Each shelf item is imported once; notes and status are kept separately.')}</p>
      <label>{t('搜索书架内容', 'Search shelf items')}<input value={query} onChange={event => setQuery(event.target.value)} maxLength={200}/></label>
      {loading ? <p role="status">{t('正在读取书架…', 'Loading shelf…')}</p> : <ul>{filtered.slice(0, 20).map(item => <li key={item.id}><span>{item.title}</span><button className="pw-text-button" disabled={!!busy} onClick={() => void importItem(item.id)}>{busy === item.id ? t('引入中…', 'Importing…') : t('引入 / 打开', 'Import / open')}</button></li>)}</ul>}
      {!loading && !filtered.length && <p>{t('没有匹配的手动收藏。', 'No matching saved items.')}</p>}
      {filtered.length > 20 && <p>{t('先显示前 20 项，输入关键词缩小范围。', 'Showing the first 20 items. Search to narrow the list.')}</p>}
      {error && <Notice error>{error} <button className="pw-text-button" onClick={() => void load()}>{t('重新读取', 'Reload')}</button></Notice>}
    </div>}
  </section>;
}

function WorkflowEditor({ item, onUpdate, onDirty }: { item: WorkflowItem; onUpdate: (item: WorkflowItem) => void; onDirty: (dirty: boolean) => void }) {
  const { language, t } = usePreferences(); const { data, refresh } = useWorkspace();
  const [draft, setDraft] = useState(() => recoverDraft(item) || draftOf(item)); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState(() => recoverDraft(item) ? t('已恢复当前标签页中未保存的草稿，请保存整理。', 'Restored an unsaved draft from this tab. Save it when ready.') : '');
  const [dueDate, setDueDate] = useState(localDay()); const [output, setOutput] = useState<'prompt' | 'markdown' | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(item));
  const todo = data?.todos.find(todo => todo.id === item.todoId);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); if (window.matchMedia?.('(max-width: 760px)').matches) heading.current?.scrollIntoView?.({ block: 'start' }); }, [item.id]);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => {
    try { if (dirty) sessionStorage.setItem(draftKey(item.id), JSON.stringify({ updatedAt: item.updatedAt, draft })); else sessionStorage.removeItem(draftKey(item.id)); }
    catch { /* Saving to the local service remains available if browser storage is unavailable. */ }
  }, [dirty, draft, item.id, item.updatedAt]);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  function field<K extends keyof WorkflowDraft>(key: K, value: WorkflowDraft[K]) { setDraft(previous => ({ ...previous, [key]: value })); setMessage(''); }
  async function save(addTodo = false) {
    if (busy) return; setBusy(true); setError(''); setMessage('');
    try {
      let saved = await request<WorkflowItem>(`/workflow/${encodeURIComponent(item.id)}`, 'PATCH', draft);
      onUpdate(saved); setDraft(draftOf(saved));
      if (addTodo) {
        const result = await request<{ item: WorkflowItem; todo: Todo; created: boolean }>(`/workflow/${encodeURIComponent(item.id)}/todo`, 'POST', { dueDate: dueDate || null });
        saved = result.item; onUpdate(saved); setDraft(draftOf(saved)); await refresh();
        setMessage(result.created ? t('下一步已加入待办。', 'Next action added to your tasks.') : t('已关联现有待办，没有重复创建。', 'Already linked to an existing task. No duplicate created.'));
      } else setMessage(t('已保存。', 'Saved.'));
    } catch (err) { setError(err instanceof Error ? err.message : t('保存失败，请重试。', 'Could not save. Try again.')); }
    finally { setBusy(false); }
  }
  const suggestion = suggestWorkflow(`${draft.title} ${draft.question}`, draft.url);
  return <section className="wf-editor" aria-labelledby="wf-editor-heading">
    <div className="wf-section-heading"><h2 id="wf-editor-heading" ref={heading} tabIndex={-1}>{t('把它变成下一步', 'Find the next step')}</h2><span className="wf-save-state" role="status">{dirty ? t('有未保存的修改', 'Unsaved changes') : t('已保存在本机', 'Saved locally')}</span></div>
    <div className="wf-editor-shortcut"><button className="pw-text-button" onClick={() => setOutput('prompt')}>{t('准备 AI 提示词', 'Prepare AI prompt')}<ArrowRight width={16} height={16}/></button><small>{t('可直接开始；补上问题与材料后，提示词会随表单更新。', 'Start here; the prompt updates as you add your question and material.')}</small></div>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy}>
        <label>{t('标题', 'Title')}<input value={draft.title} onChange={event => field('title', event.target.value)} maxLength={200} required/></label>
        <div className="wf-editor-fields">
          <label>{t('条目类型', 'Item type')}<select value={draft.kind} onChange={event => field('kind', event.target.value as WorkflowKind)}>{kinds.map(value => <option value={value} key={value}>{kindLabel(value, language)}</option>)}</select></label>
          <label>{t('所属方向', 'Learning track')}<select value={draft.track} onChange={event => field('track', event.target.value as WorkflowTrack)}>{tracks.map(value => <option value={value} key={value}>{trackLabel(value, language)}</option>)}</select></label>
          <label>{t('安排', 'Disposition')}<select value={draft.status} onChange={event => field('status', event.target.value as WorkflowStatus)}>{statuses.map(value => <option value={value} key={value}>{statusLabel(value, language)}</option>)}</select></label>
        </div>
        <div className="wf-suggestion"><span>{t('本地建议', 'Local suggestion')}：{kindLabel(suggestion.kind, language)} · {trackLabel(suggestion.track, language)}</span><button type="button" className="pw-text-button" onClick={() => { field('kind', suggestion.kind); field('track', suggestion.track); }}>{t('采用建议', 'Use suggestion')}</button></div>
        <label>{t('我想弄懂什么 / 想解决什么', 'What do I want to understand or solve?')}<textarea rows={2} value={draft.question} onChange={event => field('question', event.target.value)} maxLength={2000} placeholder={t('带着一个具体问题开始，也可以写课程名称、当前基础或项目约束。', 'Start with a specific question. Add the course, your background, or project constraints.')}/></label>
        <label>{t('下次从哪里继续', 'Where to resume')}<input value={draft.resumeAt} onChange={event => field('resumeAt', event.target.value)} maxLength={200} placeholder={t('视频 12:30 / 论文第 3 节 / 项目中尚未解决的 bug', 'Video 12:30 / paper section 3 / the bug to investigate')}/></label>
        <details className="wf-material" open={draft.kind === 'paper' ? true : undefined}>
          <summary>{t('来源与原文材料', 'Source and original material')}</summary>
          <label>{t('来源链接', 'Source URL')}<input type="url" value={draft.url} onChange={event => field('url', event.target.value)} maxLength={2000}/></label>
          <label>{t('原文片段 / 字幕 / 作业要求', 'Excerpt / transcript / assignment brief')}<textarea rows={5} value={draft.excerpt} onChange={event => field('excerpt', event.target.value)} maxLength={18000} placeholder={t('粘贴这次要精读的一小段，并注明页码或章节。工作台不会自动读取链接正文。', 'Paste a short passage with its page or section. This workspace does not fetch the source text.')}/></label>
          <p>{t('只保存链接也可以；给 AI 的提示词会说明目前没有原文。', 'A link is enough to save the item; the prompt will say when no original text is available.')}</p>
        </details>
        <label>{t('学习笔记 / AI 对话后的收获', 'Notes / takeaways from your AI conversation')}<textarea rows={4} value={draft.notes} onChange={event => field('notes', event.target.value)} maxLength={12000} placeholder={t('今天弄懂了什么？还有什么卡住？可以贴回 AI 结果，再用自己的话整理。', 'What did you understand? What is still unclear? Bring back the AI result and add your own understanding.')}/></label>
        <label>{t('一个可以动手的下一步', 'One concrete next action')}<input value={draft.nextAction} onChange={event => field('nextAction', event.target.value)} maxLength={200} placeholder={t('例如：用 20 行 Python 画出梯度下降的迭代轨迹', 'For example: plot gradient descent iterations in a small Python script')}/></label>
        <div className="wf-actions"><button className="pw-button primary" disabled={!draft.title.trim()}><Check width={17} height={17}/>{busy ? t('保存中…', 'Saving…') : t('保存整理', 'Save changes')}</button><span>{t('暂存和归档都能重新打开。', 'Parked and archived items can be reopened.')}</span></div>
      </fieldset>
    </form>
    {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
    <div className="wf-next-action">
      <h3>{t('安排这一步', 'Schedule this step')}</h3>
      {todo && <><p>{todo.done ? t('上一步已完成：', 'Previous step completed: ') : t('已关联待办：', 'Linked task: ')}{todo.title}</p><Link className="pw-text-button" to="/todos">{t('去待办查看', 'Open tasks')}<ArrowRight width={16} height={16}/></Link><small>{t('完成待办后，改写下一步就能安排新行动；材料的完成状态由你决定。', 'After completing the task, write a new next action to schedule it. You decide when the material is finished.')}</small></>}
      {(!todo || todo.done) && <><div className="wf-actions"><label>{t('计划日期（可选）', 'Planned date (optional)')}<input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)}/></label><button className="pw-button" disabled={busy || !draft.nextAction.trim() || !draft.title.trim() || todo?.title === draft.nextAction.trim()} onClick={() => void save(true)}>{t('保存并加入待办', 'Save and add task')}</button></div><small>{t('先写下一步再安排。只有你选中的行动才会加入待办。', 'Write the next action first. Only actions you choose become tasks.')}</small></>}
    </div>
    <div className="wf-ai">
      <h3>{t('带着上下文，请 AI 帮忙', 'Bring context to your AI')}</h3>
      <p>{t('根据当前表单生成提示词 → 复制到你的 AI 工具 → 把收获和下一步记回来。', 'Generate a prompt from this form → paste into your AI tool → bring back your notes and next step.')}</p>
      <div className="wf-actions"><button className="pw-button" disabled={busy} onClick={() => setOutput('prompt')}>{t(draft.kind === 'paper' ? '生成论文精读提示词' : draft.kind === 'idea' || draft.kind === 'project' ? '生成想法拆解提示词' : '生成学习提示词', draft.kind === 'paper' ? 'Build close-reading prompt' : draft.kind === 'idea' || draft.kind === 'project' ? 'Build idea-to-experiment prompt' : 'Build study prompt')}</button><button className="pw-text-button" onClick={() => setOutput('markdown')}>{t('导出 Markdown 笔记', 'Export Markdown notes')}</button></div>
      <small>{t('只在本地组装文本；复制前可预览。没有调用模型，也没有发送材料。', 'Text is assembled locally for you to preview. No model is called and no material is sent.')}</small>
    </div>
    {output && <CopyPanel key={`${output}-${language}`} title={output === 'prompt' ? t('AI 提示词预览', 'AI prompt preview') : t('Markdown 笔记', 'Markdown notes')} text={output === 'prompt' ? buildWorkflowPrompt(draft, language) : workflowMarkdown({ ...item, ...draft }, language)} onClose={() => setOutput(null)}/>}
    {item.url && <a className="pw-text-button wf-source" href={item.url} target="_blank" rel="noreferrer">{t('打开已保存的来源', 'Open saved source')}<ArrowRight width={16} height={16}/></a>}
  </section>;
}

export default function WorkflowPage() {
  const { language, t } = usePreferences();
  const navigate = useNavigate();
  const [items, setItems] = useState<WorkflowItem[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(lastSelection); const [pendingId, setPendingId] = useState(''); const [dirty, setDirty] = useState(false);
  const [pendingPath, setPendingPath] = useState('');
  const selection = useRef({ dirty, selectedId }); selection.current = { dirty, selectedId };
  const leaveNotice = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<WorkflowStatus | 'all'>('inbox'); const [track, setTrack] = useState<WorkflowTrack | 'all'>('all'); const [query, setQuery] = useState(''); const [limit, setLimit] = useState(30);
  const [review, setReview] = useState(false); const [message, setMessage] = useState('');
  const listTitle = useRef<HTMLHeadingElement>(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const result = await request<{ items: WorkflowItem[] }>('/workflow'); setItems(result.items); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load workflow.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { try { sessionStorage.setItem('dailyhouse-workflow-selection', selectedId); } catch { /* Optional tab-local recovery. */ } }, [selectedId]);
  useEffect(() => {
    if (!dirty) return;
    const intercept = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      if (!anchor || anchor.target === '_blank') return;
      const target = new URL(anchor.href, window.location.href);
      if (target.origin !== window.location.origin || !target.hash.startsWith('#/') || target.hash === window.location.hash) return;
      event.preventDefault(); event.stopPropagation(); setPendingPath(target.hash.slice(1));
    };
    document.addEventListener('click', intercept, true);
    return () => document.removeEventListener('click', intercept, true);
  }, [dirty]);
  useEffect(() => { if (pendingPath) leaveNotice.current?.focus(); }, [pendingPath]);
  const update = useCallback((item: WorkflowItem) => setItems(previous => [item, ...previous.filter(entry => entry.id !== item.id)]), []);
  function select(id: string) { if (id === selection.current.selectedId) return; if (selection.current.dirty) setPendingId(id); else { setSelectedId(id); setPendingId(''); } }
  function add(item: WorkflowItem) { update(item); select(item.id); setStatus(item.status); setTrack('all'); setQuery(''); setMessage(t('已放入工作流，可以在下面继续整理。', 'Added to your workflow. Continue organizing below.')); }
  const selected = items.find(item => item.id === selectedId);
  const filtered = useMemo(() => items.filter(item => (status === 'all' || item.status === status) && (track === 'all' || item.track === track) && `${item.title} ${item.notes} ${item.question} ${item.nextAction} ${item.url}`.toLowerCase().includes(query.toLowerCase())), [items, status, track, query]);
  useEffect(() => setLimit(30), [status, track, query]);
  const activeCount = items.filter(item => item.status === 'active').length;
  return <div className="pw-page workflow-page">
    <PageHead title={t('学习工作流', 'Learning workflow')} description={t('把好奇、材料和零碎想法，接到真正能做的下一步。', 'Turn curiosity, material and scattered ideas into a next step you can take.')}><button className="pw-button" disabled={loading || !!error} aria-expanded={review} onClick={() => setReview(!review)}>{t('每周整理提示词', 'Weekly review prompt')}</button></PageHead>
    <details className="wf-guide"><summary>{t('我的节奏：收集 → 取舍 → 动手 → 留下收获', 'My rhythm: capture → choose → work → reflect')}</summary><div className="wf-guide-body"><p><strong>{t('每天开工', 'Start the day')}</strong>{t('先看课程截止事项与日历，再选一个学习 / 科研重点和一个项目小动作。', 'Check course deadlines and your calendar, then choose one study or research focus and one small project action.')}</p><p><strong>{t('随时收集', 'Capture anytime')}</strong>{t('视频和灵感先放待整理；有明确用途才选为近期重点。可以只看需要的片段。', 'Put videos and ideas in the inbox. Make them active when they serve a real question; watching only a useful segment is enough.')}</p><p><strong>{t('收工与周末', 'Wrap up and review')}</strong>{t('收工写下做到哪、卡在哪里、下次第一步。每周选一个主探索方向和一个轻量实验，其他暂存。', 'Record where you stopped, what blocked you and the next step. Each week, choose one main exploration and one small experiment; park the rest.')}</p><Link className="pw-text-button" to="/todos">{t('查看待办与日历', 'View tasks and calendar')}<ArrowRight width={16} height={16}/></Link></div></details>
    {review && <CopyPanel title={t('每周整理提示词 · 当前记录快照', 'Weekly review prompt · current snapshot')} text={buildWeeklyReview(items, language)} onClose={() => setReview(false)}/>}
    <Capture onCreated={add} disabled={loading || !!error}/>
    <ShelfImport onImported={add} disabled={loading || !!error}/>
    {message && <Notice>{message}</Notice>}
    {error && <Notice error>{error} <button className="pw-text-button" onClick={() => void load()}>{t('重试', 'Try again')}</button></Notice>}
    {pendingPath && <div className="wf-unsaved" role="alert" tabIndex={-1} ref={leaveNotice}><p>{t('离开前请保存当前条目的修改，或明确放弃。', 'Save this item before leaving, or discard your changes.')}</p><div className="wf-actions"><button className="pw-button" onClick={() => { try { sessionStorage.removeItem(draftKey(selectedId)); } catch { /* Optional storage. */ } navigate(pendingPath); }}>{t('放弃修改并离开', 'Discard and leave')}</button><button className="pw-text-button" onClick={() => setPendingPath('')}>{t('留下继续编辑', 'Stay and edit')}</button></div></div>}
    {pendingId && <div className="wf-unsaved" role="alert"><p>{t('当前条目有未保存的修改。可以先保存，或放弃修改后打开另一条。', 'This item has unsaved changes. Save first, or discard changes to open the other item.')}</p><div className="wf-actions"><button className="pw-button" onClick={() => { try { sessionStorage.removeItem(draftKey(selectedId)); } catch { /* Optional storage. */ } setSelectedId(pendingId); setPendingId(''); setDirty(false); }}>{t('放弃修改并打开', 'Discard and open')}</button><button className="pw-text-button" onClick={() => setPendingId('')}>{t('继续编辑', 'Keep editing')}</button></div></div>}
    <div className="wf-workspace">
      <section className="wf-inbox" aria-labelledby="wf-list-heading">
        <div className="wf-section-heading"><h2 id="wf-list-heading" tabIndex={-1} ref={listTitle}>{t('给探索一个位置', 'A place for your explorations')}</h2></div>
        <div className="wf-statuses" role="group" aria-label={t('按安排筛选', 'Filter by disposition')}>{[...statuses, 'all' as const].map(value => <button key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{value === 'all' ? t('全部', 'All') : statusLabel(value, language)}<span>{value === 'all' ? items.length : items.filter(item => item.status === value).length}</span></button>)}</div>
        <div className="wf-filters"><label><span className="pw-sr-only">{t('搜索工作流', 'Search workflow')}</span><input value={query} onChange={event => setQuery(event.target.value)} maxLength={200} placeholder={t('搜索标题、笔记或下一步', 'Search title, notes or next action')}/></label><label><span className="pw-sr-only">{t('筛选方向', 'Filter by track')}</span><select value={track} onChange={event => setTrack(event.target.value as WorkflowTrack | 'all')}><option value="all">{t('所有方向', 'All tracks')}</option>{tracks.map(value => <option value={value} key={value}>{trackLabel(value, language)}</option>)}</select></label></div>
        {status === 'active' && <p className="wf-focus-note">{t(`目前 ${activeCount} 项近期重点。建议同时推进 1–3 项，其他随时暂存。`, `${activeCount} active items. Consider working on 1–3 at a time and parking the rest.`)}</p>}
        {loading ? <p className="pw-loading" role="status">{t('正在读取工作流…', 'Loading workflow…')}</p> : filtered.length ? <ul className="wf-list">{filtered.slice(0, limit).map(item => <li key={item.id}><button className={`wf-item${selectedId === item.id ? ' is-selected' : ''}`} aria-pressed={selectedId === item.id} onClick={() => select(item.id)}><span className="wf-item-meta">{trackLabel(item.track, language)}<span>{kindLabel(item.kind, language)}</span></span><strong>{item.title}</strong><span className="wf-item-next">{item.nextAction || item.question || t('写一个问题，或留下一步。', 'Add a question or a next action.')}</span>{item.resumeAt && <small>{t('继续：', 'Resume: ')}{item.resumeAt}</small>}</button></li>)}</ul> : <Empty title={t('这里暂时是空的', 'A little room to begin')}><p>{items.length ? t('试试其他筛选，或在上方记下新内容。', 'Try another filter or capture something above.') : t('先记一个现在困扰你的问题，或从书架挑一段值得继续的视频。', 'Capture one question on your mind, or choose a video from your shelf.')}</p></Empty>}
        {filtered.length > limit && <button className="pw-text-button wf-load-more" onClick={() => setLimit(previous => previous + 30)}>{t('再显示 30 项', 'Show 30 more')}</button>}
      </section>
      {selected ? <WorkflowEditor key={selected.id} item={selected} onUpdate={update} onDirty={setDirty}/> : <section className="wf-editor wf-editor-empty"><Empty title={t('一次，把一件事想清楚', 'One thing at a time')}><p>{t('选中一条材料，写下问题、准备 AI 提示词，再决定要不要变成行动。', 'Select an item, add your question, prepare an AI prompt, and decide on an action.')}</p></Empty><div className="wf-empty-guide"><p><strong>{t('论文', 'Papers')}</strong>{t('贴一小段原文，补先修知识，再逐段精读。', 'Bring a short excerpt, learn the prerequisites, then read closely.')}</p><p><strong>{t('视频', 'Videos')}</strong>{t('记录续看位置，只为眼前的问题投入时间。', 'Save your place and spend time on a question that matters now.')}</p><p><strong>{t('灵感', 'Ideas')}</strong>{t('先设计一个小实验，再决定要不要做成项目。', 'Try a small experiment before committing to a project.')}</p></div></section>}
    </div>
  </div>;
}
