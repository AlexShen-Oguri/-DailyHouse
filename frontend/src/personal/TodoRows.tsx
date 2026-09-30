import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, Close } from 'pixelarticons/react';
import { localDay, request, type Todo } from './api';
import { usePreferences } from './Preferences';
import { useWorkspace } from './Workspace';
import '../styles/reading-todos.css';

const actionSource = (todo: Todo) => todo.source?.kind === 'project_action' && todo.source.linked !== false ? todo.source : undefined;

export function TodoRows({ items, allowDelete = false, focusId = '' }: { items: Todo[]; allowDelete?: boolean; focusId?: string }) {
  const { t } = usePreferences();
  const { refresh } = useWorkspace();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [remove, setRemove] = useState<Todo | null>(null);
  const [editing, setEditing] = useState('');
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [completing, setCompleting] = useState('');
  const [result, setResult] = useState('');
  const [draftRevision, setDraftRevision] = useState<number>();
  const confirmation = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const focused = useRef('');
  const finishFocus = useRef('');
  const fallbackFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { if (remove) confirmation.current?.focus(); }, [remove]);
  useEffect(() => {
    if (!focusId) { focused.current = ''; return; }
    const row = rows.current.get(focusId);
    if (row && focused.current !== focusId) { focused.current = focusId; row.focus(); row.scrollIntoView?.({ block: 'center' }); }
  }, [focusId, items]);
  useEffect(() => {
    if (editing && !items.some(item => item.id === editing)) setEditing('');
    if (completing && !items.some(item => item.id === completing && !item.done)) { setCompleting(''); setResult(''); }
    if (remove && !items.some(item => item.id === remove.id)) setRemove(null);
  }, [items, editing, completing, remove]);
  useEffect(() => {
    if (busy || !finishFocus.current) return;
    const target = rows.current.get(finishFocus.current) || fallbackFocus.current || list.current;
    target?.focus(); finishFocus.current = '';
  }, [items, busy]);
  useEffect(() => () => { if (finishFocus.current) fallbackFocus.current?.focus(); }, []);
  const restoreFocus = (id: string) => rows.current.get(id)?.focus();
  function prepareFocus(id: string) {
    finishFocus.current = id;
    fallbackFocus.current = list.current?.closest('section')?.querySelector<HTMLElement>('.pw-tabs [aria-pressed="true"], input[aria-label]') ?? null;
  }
  function revisionReview(todo: Todo) {
    const source = actionSource(todo);
    if (!source || draftRevision === source.revision) return null;
    return <div className="pw-todo-revision" role="status"><p>{t('项目行动已更新。请核对最新标题、日期和下方验收条件，再保存你的草稿。', 'The project action changed. Review its latest title, date and acceptance criteria before saving your draft.')}</p><p>{todo.title} · {todo.dueDate || t('未设日期', 'No date set')}</p><button type="button" className="pw-text-button" onClick={() => setDraftRevision(source.revision)}>{t('已核对，使用最新版本', 'Reviewed; use latest version')}</button></div>;
  }
  async function change(todo: Todo, deleting = false, completionResult?: string) {
    if (busy) return;
    const source = actionSource(todo);
    if (!deleting && !todo.done && source && completionResult === undefined) {
      setCompleting(todo.id); setResult(''); setDraftRevision(source.revision); setError(''); return;
    }
    setBusy(todo.id); setError('');
    try {
      await request(`/todos/${encodeURIComponent(todo.id)}`, deleting ? 'DELETE' : 'PATCH', deleting ? undefined : {
        done: !todo.done,
        ...(source ? { actionRevision: completionResult === undefined ? source.revision : draftRevision } : {}),
        ...(completionResult !== undefined ? { result: completionResult } : {}),
      });
      if (deleting) setRemove(null);
      prepareFocus(todo.id); setCompleting(''); setResult(''); await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : t('未能更新待办，请重试。', 'Could not update the task. Please try again.')); }
    finally { setBusy(''); }
  }
  async function saveEdit(event: FormEvent<HTMLFormElement>, todo: Todo) {
    event.preventDefault();
    const submitted = new FormData(event.currentTarget);
    const nextTitle = String(submitted.get('title') ?? '').trim();
    const nextDate = String(submitted.get('dueDate') ?? '');
    if (busy || !nextTitle) return;
    setBusy(todo.id); setError('');
    try {
      const source = actionSource(todo);
      await request(`/todos/${encodeURIComponent(todo.id)}`, 'PATCH', { title: nextTitle, dueDate: nextDate || null, ...(source ? { actionRevision: draftRevision } : {}) });
      prepareFocus(todo.id); setEditing(''); await refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(''); }
  }
  function finish(event: FormEvent<HTMLFormElement>, todo: Todo) {
    event.preventDefault();
    const submitted = String(new FormData(event.currentTarget).get('result') ?? '').trim();
    if (submitted) void change(todo, false, submitted);
  }
  return <>
    {error && <p className="pw-notice is-error" role="alert">{error} <button className="pw-text-button" disabled={!!busy} onClick={() => void refresh()}>{t('刷新状态', 'Refresh status')}</button></p>}
    {remove && <section ref={confirmation} tabIndex={-1} className="pw-todo-confirm" aria-label={t('确认删除待办', 'Confirm task deletion')}>
      <h3>{t(`删除待办“${remove.title}”？`, `Delete the task “${remove.title}”?`)}</h3>
      <p>{remove.source?.kind === 'reading'
        ? t('仅删除这条待办。书架内容、阅读状态和原始文件保留；需要时可以从书架重新添加。', 'Only this task is deleted. The shelf item, reading status and original files stay. You can add it again from the shelf.')
        : remove.source?.kind === 'project_action'
          ? t('仅删除这条待办。项目行动、验收条件和完成记录保留，需要时可以从项目重新加入待办。Codex 对话、代码和仓库保留。', 'Only this task is deleted. The project action, acceptance criteria and completion records stay; add it again from the project when needed. Codex conversations, code and repositories stay.')
          : t('仅删除这条待办，其他事项和日历日程保留。此操作无法撤销。', 'Only this task is deleted. Other tasks and calendar events stay. This cannot be undone.')}</p>
      <div className="pw-todo-confirm-actions"><button className="pw-button" disabled={!!busy} onClick={() => void change(remove, true)}>{busy ? t('删除中…', 'Deleting…') : t('确认删除待办', 'Delete this task')}</button><button className="pw-text-button" disabled={!!busy} onClick={() => { const id = remove.id; setRemove(null); restoreFocus(id); }}>{t('取消', 'Cancel')}</button></div>
    </section>}
    <ul ref={list} tabIndex={-1} aria-label={t('待办列表', 'Task list')} className="pw-todos">{items.map(todo => <li key={todo.id} ref={node => { if (node) rows.current.set(todo.id, node); else rows.current.delete(todo.id); }} tabIndex={-1} data-todo-id={todo.id} className={`${todo.done ? 'is-done' : ''}${focusId === todo.id ? ' is-linked-target' : ''}`}>
      <button className="pw-check" aria-label={`${todo.done ? t('恢复', 'Reopen') : t('完成', 'Complete')}: ${todo.title}`} aria-pressed={todo.done} disabled={!!busy || !!editing || !!completing || !!remove} onClick={() => void change(todo)}>{todo.done && <Check width={17} height={17}/>}</button>
      <div className="pw-grow">
        {editing === todo.id ? <form className="pw-todo-edit" onSubmit={event => void saveEdit(event, todo)}>
          <label>{t('待办标题', 'Task title')}<input name="title" autoFocus value={title} maxLength={200} required disabled={!!busy} onChange={event => setTitle(event.target.value)}/></label>
          <label>{t('计划日期', 'Planned date')}<input name="dueDate" type="date" value={dueDate} disabled={!!busy} onChange={event => setDueDate(event.target.value)}/></label>
          {actionSource(todo) && <p className="pw-todo-sync-hint">{t('标题和日期也会更新到项目行动。', 'The title and date also update the project action.')}</p>}
          {revisionReview(todo)}
          <div><button className="pw-button small" disabled={!!busy || !title.trim()}>{t('保存修改', 'Save changes')}</button><button type="button" className="pw-text-button" disabled={!!busy} onClick={() => { setEditing(''); restoreFocus(todo.id); }}>{t('取消编辑', 'Cancel editing')}</button></div>
        </form> : <span className="pw-task-title">{todo.title}</span>}
        <small>{todo.dueDate ? `${todo.dueDate}${!todo.done && todo.dueDate < localDay() ? t(' · 待补上', ' · Overdue') : ''}` : t('未设日期', 'No date set')}</small>
        {todo.source?.kind === 'learning' && <div className="pw-todo-source">
          {todo.source.available !== false ? <Link className="pw-text-button" to={`/learning/${encodeURIComponent(todo.source.id)}`}>{t('回到学习计划：', 'Back to study plan: ')}{todo.source.title}</Link> : <span>{t('原计划或步骤已更新 / 移除，待办保留：', 'Original plan or step changed / removed; task kept: ')}{todo.source.title}</span>}
        </div>}
        {todo.source?.kind === 'reading' && <div className="pw-todo-source">
          {todo.source.available !== false ? <Link className="pw-text-button" to={`/reading?item=${encodeURIComponent(todo.source.id)}`}>{t('回到书架：', 'Back to shelf: ')}{todo.source.title}</Link> : <span>{t('书架来源已移除或暂不可用：', 'Shelf source removed or unavailable: ')}{todo.source.title}</span>}
          {todo.source.url && <a className="pw-text-button" href={todo.source.url} target="_blank" rel="noopener noreferrer">{t('打开原始链接', 'Open original link')}</a>}
        </div>}
        {todo.source?.kind === 'project_action' && <div className="pw-todo-project">
          <div className="pw-todo-source">
            {todo.source.available ? <Link className="pw-text-button" to={`/projects?project=${encodeURIComponent(todo.source.projectId)}&action=${encodeURIComponent(todo.source.id)}`}>{t('回到项目：', 'Back to project: ')}{todo.source.title}</Link> : <span>{t('小院中的项目或行动入口已移除：', 'Project or action entry removed from DailyHouse: ')}{todo.source.title}</span>}
            {todo.source.url && <a className="pw-text-button" href={todo.source.url}>{t('回到关联的 Codex 对话', 'Resume linked Codex conversation')}</a>}
          </div>
          {todo.source.acceptance && <p><strong>{t('验收条件：', 'Acceptance: ')}</strong>{todo.source.acceptance}</p>}
          {actionSource(todo) && ['paused', 'blocked'].includes(todo.source.status) && <p><strong>{todo.source.status === 'paused' ? t('已暂停：', 'Paused: ') : t('遇到阻碍：', 'Blocked: ')}</strong>{todo.source.reason}</p>}
          {todo.done && todo.source.status === 'done' && <p><strong>{t('完成结果：', 'Result: ')}</strong>{todo.source.result || t('结果记录已删除，完成状态保留。', 'The result record was deleted; the completed state is kept.')}</p>}
          {completing === todo.id && <form className="pw-todo-completion" onSubmit={event => finish(event, todo)}>
            {revisionReview(todo)}
            <label>{t('这一步完成了什么？', 'What did this step achieve?')}<textarea name="result" autoFocus required maxLength={4000} rows={3} disabled={!!busy} value={result} onChange={event => setResult(event.target.value)} placeholder={t('记录结果、验证方式或产物位置…', 'Record the outcome, verification or deliverable location…')}/></label>
            <p>{t('保存后，这条待办和项目行动会一起完成。', 'Saving completes both this task and its project action.')}</p>
            <div><button className="pw-button primary" disabled={!!busy || !result.trim()}>{busy ? t('保存中…', 'Saving…') : t('记录结果并完成', 'Save result & complete')}</button><button type="button" className="pw-text-button" disabled={!!busy} onClick={() => { setCompleting(''); setResult(''); restoreFocus(todo.id); }}>{t('取消', 'Cancel')}</button></div>
          </form>}
        </div>}
      </div>
      <button className="pw-text-button pw-todo-edit-button" aria-label={t(`编辑待办：${todo.title}`, `Edit task: ${todo.title}`)} disabled={!!busy || !!editing || !!remove || !!completing} onClick={() => { setEditing(todo.id); setTitle(todo.title); setDueDate(todo.dueDate || ''); setDraftRevision(actionSource(todo)?.revision); }}>{t('编辑', 'Edit')}</button>
      {allowDelete && <button className="pw-icon-button" aria-label={`${t('删除', 'Delete')}: ${todo.title}`} title={t('删除待办', 'Delete task')} disabled={!!busy || !!editing || !!completing} onClick={() => setRemove(todo)}><Close width={17} height={17}/></button>}
    </li>)}</ul>
  </>;
}
