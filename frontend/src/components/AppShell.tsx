import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Sun, Cloud } from 'pixelarticons/react';
import { useWorkspace } from '../personal/Workspace';
import { GardenGlyph } from './GardenLife';

const navItems = [
  { to: '/', label: '我的小院', icon: 'home' },
  { to: '/todos', label: '今日待办', icon: 'todos' },
  { to: '/knowledge', label: '知识书屋', icon: 'knowledge' },
  { to: '/finance', label: '收支账本', icon: 'finance' },
  { to: '/settings', label: '小院设置', icon: 'settings' },
] as const;

export default function AppShell() {
  const [online, setOnline] = useState<boolean | null>(null);
  const location = useLocation();
  const { error, loading, refresh } = useWorkspace();
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try { const response = await fetch('/api/health'); const health = await response.json(); if (alive) setOnline(health.ok === true); }
      catch { if (alive) setOnline(false); }
    };
    void check();
    const timer = window.setInterval(check, 60000);
    window.addEventListener('focus', check);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', check); };
  }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  return (
    <div className="garden-shell">
      <a className="garden-skip" href="#workspace-main" onClick={event => { event.preventDefault(); const main = document.getElementById('workspace-main'); main?.focus(); main?.scrollIntoView({ block: 'start' }); }}>跳到工作区</a>
      <header className="garden-header">
        <div className="garden-header-inner">
          <Link to="/" className="garden-brand" aria-label="日常小院首页">
            <span className="garden-brand-mark"><GardenGlyph name="home" size={28}/></span>
            <span><strong>日常小院</strong><small>我的个人工作台</small></span>
          </Link>
          <div className="garden-header-note"><Sun width={18} height={18} aria-hidden="true" />给每一天，留一点生长的空间。</div>
          <Link to="/settings" className={`garden-connection${online === false ? ' is-offline' : ''}`} aria-live="polite">
            <span aria-hidden="true" />{online === null ? '正在连接' : online ? '本地服务在线' : '服务未连接'}
          </Link>
        </div>
        <div className="garden-nav-wrap">
          <nav className="garden-nav" aria-label="主导航">
            {navItems.map(({ to, label, icon }) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `garden-nav-item${isActive ? ' is-active' : ''}`}>
                <GardenGlyph name={icon} size={24}/><span>{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main id="workspace-main" className="garden-main" tabIndex={-1}>{error && <div className="pw-notice is-error" role="alert">{error} <button className="pw-text-button" onClick={() => void refresh()}>重试</button></div>}{loading ? <p className="pw-loading" role="status">正在打开小院…</p> : <Outlet />}</main>
      <footer className="garden-footer">
        <span><Cloud width={16} height={16} aria-hidden="true" />一方小院，有序日常</span>
        <span>本地存储 · 按需连接</span>
      </footer>
    </div>
  );
}

