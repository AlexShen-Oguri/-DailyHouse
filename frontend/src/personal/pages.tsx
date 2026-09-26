import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Calendar, Folder, Wallet } from 'pixelarticons/react';
import { GardenLife } from '../components/GardenLife';
import { localDay } from './api';
import { useWorkspace } from './Workspace';
import { AddTodo, Empty, PageHead, TodoRows } from './shared';
import '../styles/garden-home.css';
import '../styles/personal.css';
export { default as TodosPage } from './Todos';
export { default as KnowledgePage } from './Knowledge';
export { default as SettingsPage } from './Settings';

export function HomePage() {
  const { data } = useWorkspace();
  if (!data) return null;
  const todos = data.todos.filter(t => !t.done && (!t.dueDate || t.dueDate <= localDay()));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const todayEvents = data.calendar.events.filter(e => e.allDay ? e.start.slice(0, 10) <= localDay() && e.end.slice(0, 10) > localDay() : new Date(e.start) < tomorrow && new Date(e.end) > today);
  const greeting = new Date().getHours() < 12 ? '早上好，挑一件小事，慢慢开始。' : new Date().getHours() < 18 ? '下午好，按自己的节奏来。' : '晚上好，给今天留一点收尾的时间。';
  return <div className="garden-home">
    <div className="gh-landscape"><img src="/images/garden-landscape.png" alt="像素小院，远山、池塘与树荫下的小屋" fetchPriority="high"/><GardenLife/></div>
    <header className="gh-welcome"><div className="gh-welcome-copy"><h1>把日子，过成自己的小院。</h1><p>{greeting}</p></div><div className="gh-welcome-actions"><span className="gh-date"><Calendar width={18} height={18}/>{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span><Link className="pw-button primary" to="/todos">去安排今天 <ArrowRight width={18} height={18}/></Link></div></header>
    <div className="pw-home-grid"><section className="pw-paper"><div className="pw-section-head"><h2>今天的一小步</h2><span className="pw-subtle">{todos.length} 件待完成</span></div><AddTodo compact/>{todos.length ? <TodoRows items={todos.slice(0, 5)}/> : <Empty title="今天，从这里开始"><p>记下一件小事，完成后打个勾。</p></Empty>}<Link className="pw-text-button pw-section-bottom" to="/todos">查看全部待办 <ArrowRight width={16} height={16}/></Link></section>
    <aside className="pw-noticeboard"><h2>小院的几个角落</h2><Link className="pw-source-link" to="/knowledge"><span className="pw-inventory-icon"><BookOpen/></span><span className="pw-grow"><strong>Obsidian 书屋</strong><small>{data.vault.status === 'ready' ? `${data.vault.name} · ${data.vault.notes.length} 篇笔记` : '连接你的笔记仓库'}</small></span><ArrowRight width={19}/></Link><Link className="pw-source-link" to="/finance"><span className="pw-inventory-icon"><Wallet/></span><span className="pw-grow"><strong>Chase 账本</strong><small>等待确认原绑定服务</small></span><ArrowRight width={19}/></Link><Link className="pw-source-link" to="/todos"><span className="pw-inventory-icon"><Folder/></span><span className="pw-grow"><strong>桌面拾遗</strong><small>{data.desktop.scannedAt ? `${data.desktop.files.length} 个文件可查看` : '挑出需要处理的文件'}</small></span><ArrowRight width={19}/></Link><p className="pw-footnote">笔记、日程和眼前的一小步，各归其位。</p></aside></div>
    <section className="pw-agenda-strip"><Calendar width={24} height={24}/><div className="pw-grow"><h2>日历里的今天</h2><p>{data.calendar.status === 'ready' ? todayEvents.length ? todayEvents.map(e => e.title).slice(0, 3).join(' · ') : '今天没有已读取的日程。' : '连接 Apple Calendar 后，在这里看看今天的安排。'}</p></div><Link className="pw-text-button" to={data.calendar.status === 'ready' ? '/todos' : '/settings'}>{data.calendar.status === 'ready' ? '查看日程' : '设置来源'} <ArrowRight width={17}/></Link></section>
  </div>;
}
export function FinancePage() {
  const { data } = useWorkspace();
  return <div className="pw-page"><PageHead title="收支账本" description="为你已有的 Chase 账户，留一处清楚的账目。"/><section className="pw-finance"><div className="pw-ledger-cover" aria-hidden="true"><Wallet width={64} height={64}/><span>小院账本</span><i/></div><div className="pw-finance-copy"><span className="pw-status">等待连接信息</span><h2>接回你的 Chase 账户</h2><p>{data?.finance.message || '还没有可供此工作台读取的 Chase 连接。'}</p><p>请在对话中告诉我，之前在哪个应用或服务绑定了 Chase。确认连接方式后，再接入账户与交易记录。</p><p className="pw-footnote">当前没有读取到余额或交易。这里只保留 Chase，不再提供其他金融连接器。</p></div></section></div>;
}
