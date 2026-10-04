import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Calendar } from 'pixelarticons/react';
import { GardenLife, GardenGlyph } from '../components/GardenLife';
import { GardenScene } from '../components/GardenScene';
import { localDay } from './api';
import { useWorkspace } from './Workspace';
import { usePreferences } from './Preferences';
import { AddTodo, Empty, TodoRows } from './shared';
import Pomodoro from './Pomodoro';
import '../styles/garden-home.css';
import '../styles/personal.css';
export { default as TodosPage } from './Todos';
export { default as KnowledgePage } from './Knowledge';
export { default as SettingsPage } from './Settings';

export function HomePage() {
  const { data } = useWorkspace();
  const { t, locale } = usePreferences();
  if (!data) return null;
  const todos = data.todos.filter(t => !t.done && (!t.dueDate || t.dueDate <= localDay()));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const todayEvents = data.calendar.events.filter(e => e.allDay ? e.start.slice(0, 10) <= localDay() && e.end.slice(0, 10) > localDay() : new Date(e.start) < tomorrow && new Date(e.end) > today);
  const greeting = new Date().getHours() < 12 ? t('早上好，挑一件小事，慢慢开始。', 'Good morning. Start with one small thing.') : new Date().getHours() < 18 ? t('下午好，按自己的节奏来。', 'Good afternoon. Take things at your own pace.') : t('晚上好，给今天留一点收尾的时间。', 'Good evening. Leave a little time to wind down.');
  return <div className="garden-home">
    <GardenScene><GardenLife/></GardenScene>
    <header className="gh-welcome"><div className="gh-welcome-copy"><h1>{t('把日子，过成自己的小院。', 'A little space to make the day your own.')}</h1><p>{greeting}</p></div><div className="gh-welcome-actions"><span className="gh-date"><Calendar width={18} height={18}/>{new Date().toLocaleDateString(locale, { month: 'long', day: 'numeric', weekday: 'long' })}</span><Link className="pw-button primary" to="/todos">{t('去安排今天', 'Plan today')} <ArrowRight width={18} height={18}/></Link></div></header>
    <div className="pw-home-grid"><section className="pw-paper"><div className="pw-section-head"><h2>{t('今天的一小步', 'One small step today')}</h2><span className="pw-subtle">{t(`${todos.length} 件待完成`, `${todos.length} left to do`)}</span></div><AddTodo compact/>{todos.length ? <TodoRows items={todos.slice(0, 5)}/> : <Empty title={t('今天，从这里开始', 'Your day starts here')}><p>{t('记下一件小事，完成后打个勾。', 'Write down one small task. Check it off when you finish.')}</p></Empty>}<Link className="pw-text-button pw-section-bottom" to="/todos">{t('查看全部待办', 'View all tasks')} <ArrowRight width={16} height={16}/></Link></section>
    <aside className="pw-noticeboard"><Pomodoro/><h2>{t('小院的几个角落', 'Around the garden')}</h2><Link className="pw-source-link" to="/reading"><span className="pw-inventory-icon"><BookOpen/></span><span className="pw-grow"><strong>{t('待读书架', 'Reading shelf')}</strong><small>{t('书籍、视频、课程与每日汇报', 'Books, videos, courses and daily reports')}</small></span><ArrowRight width={19}/></Link><Link className="pw-source-link" to="/learning"><span className="pw-inventory-icon"><BookOpen/></span><span className="pw-grow"><strong>{t('学习计划', 'Study plans')}</strong><small>{t('课程与长期目标，持续记录进展', 'Courses, longer goals and steady progress')}</small></span><ArrowRight width={19}/></Link><Link className="pw-source-link" to="/journal"><span className="pw-inventory-icon"><GardenGlyph name="journal"/></span><span className="pw-grow"><strong>{t('工作日记', 'Work journal')}</strong><small>{t('记录 Codex 进展与现实生活', 'Codex progress and everyday life')}</small></span><ArrowRight width={19}/></Link><Link className="pw-source-link" to="/knowledge"><span className="pw-inventory-icon"><BookOpen/></span><span className="pw-grow"><strong>{t('Obsidian 书屋', 'Obsidian library')}</strong><small>{data.vault.status === 'ready' ? `${data.vault.name} · ${t(`${data.vault.notes.length} 篇笔记`, `${data.vault.notes.length} ${data.vault.notes.length === 1 ? 'note' : 'notes'}`)}` : t('连接你的笔记仓库', 'Connect your note vault')}</small></span><ArrowRight width={19}/></Link><p className="pw-footnote">{t('笔记、日程和眼前的一小步，各归其位。', 'A place for your notes, plans and next small step.')}</p></aside></div>
    <section className="pw-agenda-strip"><Calendar width={24} height={24}/><div className="pw-grow"><h2>{t('日历里的今天', 'Today on your calendar')}</h2><p>{data.calendar.status === 'ready' ? todayEvents.length ? todayEvents.map(e => e.title).slice(0, 3).join(' · ') : t('今天没有已读取的日程。', 'No events for today in the calendar you loaded.') : t('连接 Google Calendar 或 Apple Calendar 后，在这里看看今天的安排。', 'Connect Google Calendar or Apple Calendar to see today’s plans here.')}</p></div><Link className="pw-text-button" to={data.calendar.status === 'ready' ? '/todos' : '/settings'}>{data.calendar.status === 'ready' ? t('查看日程', 'View events') : t('设置来源', 'Set up source')} <ArrowRight width={17}/></Link></section>
  </div>;
}
