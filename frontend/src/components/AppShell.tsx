import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Sun, Cloud } from 'pixelarticons/react';
import { useWorkspace } from '../personal/Workspace';
import { GardenGlyph } from './GardenLife';
import { ThemeToggle } from './ThemeToggle';
import { usePreferences } from '../personal/Preferences';

const navItems = [
  { to: '/', label: '我的小院', en: 'My garden', icon: 'home' },
  { to: '/todos', label: '今日待办', en: 'Today', icon: 'todos' },
  { to: '/reading', label: '待读书架', en: 'Reading shelf', icon: 'reading' },
  { to: '/knowledge', label: '知识书屋', en: 'Obsidian', icon: 'knowledge' },
  { to: '/finance', label: '收支账本', en: 'Ledger', icon: 'finance' },
  { to: '/settings', label: '小院设置', en: 'Settings', icon: 'settings' },
] as const;

export default function AppShell() {
  const [online, setOnline] = useState<boolean | null>(null);
  const location = useLocation();
  const { error, loading, refresh } = useWorkspace();
  const { language, setLanguage, t } = usePreferences();
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
      <a className="garden-skip" href="#workspace-main" onClick={event => { event.preventDefault(); const main = document.getElementById('workspace-main'); main?.focus(); main?.scrollIntoView({ block: 'start' }); }}>{t('跳到工作区', 'Skip to workspace')}</a>
      <header className="garden-header">
        <div className="garden-header-inner">
          <Link to="/" className="garden-brand" aria-label={t('日常小院首页', 'DailyHouse home')}>
            <span className="garden-brand-mark"><GardenGlyph name="home" size={28}/></span>
            <span><strong>{t('日常小院', 'DailyHouse')}</strong><small>{t('我的个人工作台', 'My personal workspace')}</small></span>
          </Link>
          <div className="garden-header-note"><Sun width={18} height={18} aria-hidden="true" />{t('给每一天，留一点生长的空间。', 'A little room to grow, every day.')}</div>
          <div className="garden-preferences">
            <div className="garden-language-switch" role="group" aria-label={t('界面语言', 'Interface language')}><button lang="zh-CN" aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>中文</button><button lang="en" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button></div>
            <ThemeToggle/>
          <Link to="/settings" className={`garden-connection${online === false ? ' is-offline' : ''}`} aria-live="polite">
            <span aria-hidden="true" />{online === null ? t('正在连接', 'Connecting') : online ? t('本地服务在线', 'Local service online') : t('服务未连接', 'Service offline')}
          </Link>
          </div>
        </div>
        <div className="garden-nav-wrap">
          <nav className="garden-nav" aria-label={t('主导航', 'Main navigation')}>
            {navItems.map(({ to, label, en, icon }) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `garden-nav-item${isActive ? ' is-active' : ''}`}>
                {icon === 'reading' ? <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 5h5v14H2zm7-3h5v17H9zm7 4h4l3 12-4 1zM1 20h22v2H1z"/><path className="garden-glyph-accent" d="M3 8h3v2H3zm7-3h3v2h-3z"/></svg> : <GardenGlyph name={icon} size={24}/>}<span>{t(label, en)}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main id="workspace-main" className="garden-main" tabIndex={-1}>{error && <div className="pw-notice is-error" role="alert">{error} <button className="pw-text-button" onClick={() => void refresh()}>{t('重试', 'Try again')}</button></div>}{loading ? <p className="pw-loading" role="status">{t('正在打开小院…', 'Opening your garden…')}</p> : <Outlet />}</main>
      <footer className="garden-footer">
        <span><Cloud width={16} height={16} aria-hidden="true" />{t('一方小院，有序日常', 'A small garden for everyday life')}</span>
        <span>{t('本地存储 · 按需连接', 'Stored locally · Connected by choice')}</span>
      </footer>
    </div>
  );
}

