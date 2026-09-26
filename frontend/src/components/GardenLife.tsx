import { useEffect, useRef, useState } from 'react';

type GardenGlyphName = 'home' | 'todos' | 'finance' | 'knowledge' | 'settings';

/** Small geometric icons, drawn on the same two-pixel grid as the navigation. */
export function GardenGlyph({ name, size = 24, className = '' }: { name: GardenGlyphName; size?: number; className?: string }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true as const, className: `garden-glyph ${className}`, shapeRendering: 'crispEdges' as const };
  if (name === 'home') return <svg {...common}><path d="M10 2h4v2h2v2h2v2h2v2h2v2h-2v10H4V12H2v-2h2V8h2V6h2V4h2zm0 4v2H8v2H6v10h4v-6h4v6h4V10h-2V8h-2V6z" /><path className="garden-glyph-accent" d="M18 2h4v4h-2v2h-2zm-2 2h2v2h-2z" /></svg>;
  if (name === 'todos') return <svg {...common}><path d="M6 2h2v2h8V2h2v2h4v18H2V4h4zM4 10v10h16V10zm0-4v2h16V6z" /><path className="garden-glyph-accent" d="M16 12h2v2h-2v2h-2v2h-4v-2H8v-2h2v2h2v-2h2v-2z" /></svg>;
  if (name === 'finance') return <svg {...common}><path d="M4 4h14v2H4v2h18v14H2V4zm0 6v10h16v-2h-6v-6h6v-2zm12 4v2h4v-2z" /><path className="garden-glyph-accent" d="M10 2h2v2h2v2h-2v2h-2V6H8V4h2z" /></svg>;
  if (name === 'knowledge') return <svg {...common}><path d="M2 8h8v2h4V8h8v12h-8v2h-4v-2H2zm2 2v8h6v2h1V12h-1v-2zm10 2v8h1v-2h5v-8h-6z" /><path className="garden-glyph-accent" d="M10 2h2v4h2V2h4v4h-4v4h-2V6H8V2z" /></svg>;
  return <svg {...common}><path d="M4 2h2v4h4V2h2v6h-2v2H8v12H4V10H2V8H0V2h2v4h2zm14 0h2v12h2v8h-6v-8h2z" /></svg>;
}

function Planter({ flower = false, className = '' }: { flower?: boolean; className?: string }) {
  return <svg className={`garden-planter ${className}`} width="40" height="52" viewBox="0 0 20 26" fill="none" shapeRendering="crispEdges">
    <path d="M9 8h2v12H9z" fill="#47704e" />
    <path d="M3 7h4v2h2v4H5v-2H3zm10 3h4v4h-2v2h-4v-4h2z" fill="#668b4f" />
    <path d="M5 9h2v2H5zm8 3h2v2h-2z" fill="#9eaf62" />
    {flower ? <><path d="M7 1h6v2h2v6h-2v2H7V9H5V3h2z" fill="#d68a65" /><path d="M9 3h2v6H9zM7 5h6v2H7z" fill="#f1c788" /><path d="M9 5h2v2H9z" fill="#775331" /></> : <><path d="M9 0h4v4h-2v4H9V6H7V2h2z" fill="#47704e" /><path d="M9 2h2v4H9z" fill="#92a85d" /></>}
    <path d="M2 18h16v4h-2v4H4v-4H2z" fill="#95613f" />
    <path d="M4 20h12v2H4zM6 22h2v4H6z" fill="#c38a59" />
    <path d="M2 18h16v2H2z" fill="#d5a06b" />
  </svg>;
}

/** Decorative garden life; animations pause offscreen, when hidden, and on request. */
export function GardenLife({ variant = 'path', className = '' }: { variant?: 'path' | 'planter'; className?: string }) {
  const region = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [paused, setPaused] = useState(() => {
    try { return localStorage.getItem('garden-motion-paused') === 'true'; } catch { return false; }
  });

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReducedMotion(media?.matches ?? false);
    const updateVisibility = () => setDocumentVisible(document.visibilityState === 'visible');
    updateMotion(); updateVisibility();
    media?.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.1 }) : null;
    if (region.current) observer?.observe(region.current);
    if (!observer) setVisible(true);
    return () => {
      observer?.disconnect();
      media?.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  const toggle = () => setPaused(previous => {
    const next = !previous;
    try { localStorage.setItem('garden-motion-paused', String(next)); } catch { /* A private browser can still pause this visit. */ }
    return next;
  });
  const moving = visible && documentVisible && !paused && !reducedMotion;

  return <div ref={region} className={`garden-life garden-life--${variant} ${className}`} data-moving={moving}>
    <div className="garden-life-scene" aria-hidden="true">
      {variant === 'path' && <><div className="garden-life-path" /><div className="garden-keeper-track"><img className="garden-keeper" src="/images/garden-keeper.png" width="64" height="86" alt="" draggable="false" /></div><span className="garden-butterfly"><i /><i /></span></>}
      <div className="garden-life-plants"><Planter /><Planter flower className="garden-planter-flower" /><Planter className="garden-planter-small" /></div>
    </div>
    {variant === 'path' && !reducedMotion && <button className="garden-motion-control" type="button" onClick={toggle} aria-pressed={paused} aria-label={paused ? '播放小院动画' : '暂停小院动画'} title={paused ? '播放小院动画' : '暂停小院动画'}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">{paused ? <path d="M3 1h2v2h2v2h2v2H7v2H5v2H3z" /> : <path d="M2 2h3v8H2zm5 0h3v8H7z" />}</svg><span>{paused ? '播放动画' : '暂停动画'}</span></button>}
  </div>;
}
