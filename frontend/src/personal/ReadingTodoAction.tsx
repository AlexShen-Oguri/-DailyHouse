import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Plus } from 'pixelarticons/react';
import { request, type Todo } from './api';
import { useWorkspace } from './Workspace';
import { usePreferences } from './Preferences';
import type { ReadingItem } from './reading-model';
import '../styles/reading-todos.css';

export default function ReadingTodoAction({ item, disabled = false }: { item: ReadingItem; disabled?: boolean }) {
  const { t } = usePreferences(); const { data, refresh } = useWorkspace(); const [saved, setSaved] = useState<Todo | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const pending = useRef(false);
  const tasks = data?.todos;
  useEffect(() => { setSaved(null); }, [tasks]);
  const todo = tasks?.find(task => task.source?.kind === 'reading' && task.source.id === item.id) ?? saved;
  async function add() {
    if (pending.current || disabled || todo) return; pending.current = true; setBusy(true); setError('');
    try { const result = await request<{ todo: Todo; todoId: string; created: boolean }>(`/reading/${encodeURIComponent(item.id)}/todo`, 'POST'); setSaved(result.todo); await refresh(); }
    catch (err) { setError((err as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  return <span className="reading-todo-action">{todo ? <Link className="pw-text-button" to={`/todos?task=${encodeURIComponent(todo.id)}`} aria-label={t(`${todo.done ? '查看已完成待办' : '查看关联待办'}：${item.title}`, `${todo.done ? 'View completed task' : 'View linked task'}: ${item.title}`)}><Check width={15}/>{todo.done ? t('待办已完成', 'Task completed') : t('已加入待办', 'In your tasks')}</Link> : <button className="pw-text-button" disabled={disabled || busy} onClick={() => void add()} aria-label={t(`加入待办：${item.title}`, `Add to tasks: ${item.title}`)}><Plus width={15}/>{busy ? t('添加中…', 'Adding…') : t('加入待办', 'Add to tasks')}</button>}{error && <span role="alert" className="reading-todo-error">{error}</span>}</span>;
}
