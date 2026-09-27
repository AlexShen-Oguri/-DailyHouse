import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Calendar, ArrowRight } from 'pixelarticons/react';
import { dateLabel, localDay, request } from './api';
import { useWorkspace } from './Workspace';
import { usePreferences } from './Preferences';
import { AddTodo, Empty, Notice, PageHead, TodoRows } from './shared';
import { calendarMonths, eventInMonth } from './calendar-model';
import '../styles/calendar.css';
export default function TodosPage() {
  const { data, refresh } = useWorkspace();
  const { t, locale } = usePreferences();
  const [filter, setFilter] = useState<'today' | 'all' | 'done'>('today'); const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  const [month, setMonth] = useState(''); const [params, setParams] = useSearchParams(); const linkedId = params.get('task') ?? ''; const handledLink = useRef('');
  useEffect(() => { if (!linkedId) { handledLink.current = ''; return; } if (!data || handledLink.current === linkedId) return; const found = data.todos.find(todo => todo.id === linkedId); if (found) { handledLink.current = linkedId; setFilter(found.done ? 'done' : 'all'); } }, [linkedId, data]);
  if (!data) return null;
  const tasks = data.todos.filter(t => filter === 'done' ? t.done : !t.done && (filter === 'all' || !t.dueDate || t.dueDate <= localDay()));
  const months = calendarMonths(data.calendar.events, data.calendar.range);
  const selectedMonth = months.includes(month) ? month : '';
  const calendarEvents = data.calendar.events.filter(event => eventInMonth(event, selectedMonth));
  const calendarTitle = data.calendar.provider === 'google' ? 'Google Calendar' : data.calendar.provider === 'apple' ? 'Apple Calendar' : t('我的日历', 'My calendar');
  async function action(name: string, path: string, body?: unknown) { setBusy(name); setError(''); try { await request(path, 'POST', body); await refresh(); } catch (err) { setError(err instanceof Error ? err.message : t('操作未完成，请重试。', 'The action could not be completed. Please try again.')); } finally { setBusy(''); } }
  return <div className="pw-page"><PageHead title={t('今日待办', 'Today’s tasks')} description={t('记下要做的事，看看日历里的安排。', 'Write down your tasks and check your calendar.')}/><section className="pw-paper pw-task-panel">{!!linkedId && !data.todos.some(todo => todo.id === linkedId) && <Notice>{t('这条待办已删除。书架来源不会随之删除，可以回到书架重新添加。', 'This task was deleted. Its shelf source is kept; add it again from the shelf if needed.')} <button className="pw-text-button" onClick={() => setParams({})}>{t('查看其他待办', 'View other tasks')}</button></Notice>}<AddTodo/><div className="pw-tabs" aria-label={t('待办筛选', 'Filter tasks')}>{([['today', t('今天与未完成', 'Today & overdue')], ['all', t('全部待办', 'All tasks')], ['done', t('已完成', 'Completed')]] as const).map(([key, label]) => <button key={key} className={filter === key ? 'active' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>{tasks.length ? <TodoRows items={tasks} allowDelete focusId={linkedId}/> : <Empty title={filter === 'done' ? t('完成的小事，会留在这里', 'A place for what you’ve finished') : t('这一页，暂时留白', 'A little room to begin')}><p>{filter === 'done' ? t('回到待办，完成一件再来看看。', 'Complete a task and you’ll find it here.') : t('在上方添加待办，从一件小事开始。', 'Add a task above and start with one small thing.')}</p></Empty>}</section>
    {error && <Notice error>{error}</Notice>}
    <section className="pw-paper pw-calendar-panel">
      <div className="pw-section-head"><h2><Calendar/>{calendarTitle}</h2><button className="pw-button small" disabled={!!busy || !data.settings.calendarConfigured} onClick={() => void action('calendar', '/calendar/refresh')}>{busy === 'calendar' ? t('读取中…', 'Loading…') : t('读取日历', 'Load calendar')}</button></div>
      <p className="pw-subtle">{t('只读日程', 'Read-only events')} · {dateLabel(data.calendar.updatedAt, locale)}</p>
      {data.calendar.status !== 'ready' ? <Empty title={t('把日历带进小院', 'Bring your calendar into the garden')}><p>{data.calendar.message || t('在设置中连接 Google Calendar 或 Apple Calendar。', 'Connect Google Calendar or Apple Calendar in Settings.')}</p><Link className="pw-text-button" to="/settings">{t('设置日历来源', 'Set up calendar')} <ArrowRight width={16}/></Link></Empty> : <>
        <p className="pw-subtle">{data.calendar.message}</p>
        {data.calendar.range && <p className="pw-subtle">{t('读取范围', 'Loaded range')}：{new Date(data.calendar.range.from).toLocaleDateString(locale)} – {new Date(new Date(data.calendar.range.to).getTime() - 1).toLocaleDateString(locale)}</p>}
        <div className="pw-calendar-toolbar"><label>{t('查看月份', 'View month')}<select value={selectedMonth} onChange={event => setMonth(event.target.value)}><option value="">{t('全部已读取日程', 'All loaded events')}</option>{months.map(value => <option key={value} value={value}>{new Date(`${value}-01T12:00:00`).toLocaleDateString(locale, { year: 'numeric', month: 'long' })}</option>)}</select></label><span role="status">{t(`${calendarEvents.length} 项日程`, `${calendarEvents.length} events`)}</span></div>
        {calendarEvents.length ? <ul className="pw-events">{calendarEvents.map(event => <li key={event.id}><time>{event.allDay ? `${event.start.slice(5, 10)} ${t('全天', 'All day')}` : dateLabel(event.start, locale)}</time><div><strong>{event.title}</strong>{event.location && <small>{event.location}</small>}</div></li>)}</ul> : <Empty title={selectedMonth ? t('这个月暂无日程', 'No events this month') : t('近期没有日程', 'No upcoming events')}><p>{selectedMonth ? t('可以切换月份，或读取更新后的日历来源。', 'Choose another month or refresh the calendar source.') : t('读取范围内暂无安排；可以检查来源并刷新。', 'No events in the loaded range. Check the source and refresh.')}</p></Empty>}
      </>}
    </section>
  </div>;
}
