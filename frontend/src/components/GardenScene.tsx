import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePreferences } from '../personal/Preferences';

/** Paired artwork keeps every garden landmark in place as the light changes. */
export function GardenScene({ children }: { children?: ReactNode }) {
  const { theme, t } = usePreferences();
  const scene = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  useEffect(() => {
    const updateVisibility = () => setDocumentVisible(document.visibilityState === 'visible');
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.1 }) : null;
    if (scene.current) observer?.observe(scene.current);
    if (!observer) setVisible(true);
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', updateVisibility); };
  }, []);
  return <div className="gh-landscape garden-scene" ref={scene} data-scene-active={theme === 'night' && visible && documentVisible}>
    <div className="garden-scene-art" role="img" aria-label={theme === 'night' ? t('月光下的像素小院，池塘映着星光，小屋亮着暖灯', 'A moonlit pixel garden, starlight on the pond and warm cottage windows') : t('像素小院，远山、池塘与树荫下的小屋', 'A pixel garden with distant mountains, a pond and a cottage under the trees')}>
      <img className="garden-scene-image garden-scene-day" src="/images/garden-landscape.png" alt="" width="2172" height="724" fetchPriority={theme === 'day' ? 'high' : 'auto'} draggable="false"/>
      <img className="garden-scene-image garden-scene-night" src="/images/garden-landscape-night.png" alt="" width="2172" height="724" fetchPriority={theme === 'night' ? 'high' : 'auto'} draggable="false"/>
    </div>
    <div className="garden-fireflies" aria-hidden="true">{[0, 1, 2, 3, 4].map(index => <i className={`garden-firefly garden-firefly-${index}`} key={index}/>)}</div>
    {children}
  </div>;
}
