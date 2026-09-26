import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { request, type Workspace } from './api';
const Context = createContext<{ data: Workspace | null; error: string; loading: boolean; refresh: () => Promise<void> }>({ data: null, error: '', loading: true, refresh: async () => {} });
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Workspace | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try { const next = await request<Workspace>('/state'); if (current === generation.current) { setData(next); setError(''); } }
    catch (err) { if (current === generation.current) setError(err instanceof Error ? err.message : '读取失败'); }
    finally { if (current === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);
  useEffect(() => { document.documentElement.dataset.gardenMotion = data?.settings.animationEnabled === false ? 'off' : 'on'; }, [data?.settings.animationEnabled]);
  return <Context.Provider value={{ data, error, loading, refresh }}>{children}</Context.Provider>;
}
export const useWorkspace = () => useContext(Context);
