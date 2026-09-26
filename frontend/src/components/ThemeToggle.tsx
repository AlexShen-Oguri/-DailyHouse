import { useEffect } from 'react';
import { usePreferences } from '../personal/Preferences';

/** A small physical switch: the same warm pixel disc becomes a moon at night. */
export function ThemeToggle() {
  const { theme, setTheme, t } = usePreferences();
  const night = theme === 'night';
  useEffect(() => {
    let frame = 0;
    const first = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { document.documentElement.dataset.themeReady = 'true'; }); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(frame); };
  }, []);
  return <button type="button" className="garden-theme-toggle" aria-label={t('夜间模式', 'Night mode')} aria-pressed={night} title={night ? t('切换到白昼', 'Switch to day') : t('切换到夜晚', 'Switch to night')} onClick={() => setTheme(night ? 'day' : 'night')}>
    <span className="garden-theme-track" aria-hidden="true">
      <span className="garden-toggle-stars"><i/><i/><i/></span>
      <span className="garden-toggle-thumb"><svg viewBox="0 0 24 24" width="24" height="24" shapeRendering="crispEdges">
        <g className="garden-toggle-sun" fill="currentColor"><path d="M10 1h4v3h-4zm0 19h4v3h-4zM1 10h3v4H1zm19 0h3v4h-3zM4 4h3v3H4zm13 13h3v3h-3zM17 4h3v3h-3zM4 17h3v3H4z"/><path d="M9 6h6v2h3v8h-3v2H9v-2H6V8h3z"/></g>
        <g className="garden-toggle-moon" fill="currentColor"><path d="M10 2h5v2h-4v3H9v7h3v3h7v-2h3v3h-3v3H9v-2H5v-4H3V8h3V4h4z"/></g>
      </svg></span>
    </span>
    <span className="garden-theme-label">{night ? t('夜晚', 'Night') : t('白昼', 'Day')}</span>
  </button>;
}
