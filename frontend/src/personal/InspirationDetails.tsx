import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { request } from './api';
import { usePreferences } from './Preferences';
import { Notice } from './shared';
import { tags, type Bubble, type InspirationState } from './inspiration-model';
import InspirationExplore from './InspirationExplore';
import InspirationLaunch from './InspirationLaunch';
import '../styles/inspiration.css';
import '../styles/pastoral-workspace.css';

export default function InspirationDetails({ ideaId, revision, onCanonicalChanged }: { ideaId: string; revision: number; onCanonicalChanged?: () => Promise<void> }) {
  const { t } = usePreferences(); const [state, setState] = useState<InspirationState | null>(null); const [tagText, setTagText] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [unlink, setUnlink] = useState(''); const version = useRef(0);
  const load = useCallback(async () => { const run = ++version.current; try { const next = await request<InspirationState>('/inspiration'); if (run !== version.current) return; setState(next); const item = next.items.find(row => row.id === ideaId); setTagText(item?.tags.join(', ') ?? ''); setError(''); } catch (err) { if (run === version.current) setError((err as Error).message); } }, [ideaId]);
  useEffect(() => { void load(); return () => { version.current++; }; }, [load, revision]);
  useEffect(() => {
    let disposed = false; let pending = false;
    const check = async () => {
      if (disposed || pending || document.visibilityState === 'hidden') return;
      pending = true; const run = version.current;
      try {
        const ai = await request<InspirationState['ai']>('/inspiration/ai');
        if (!disposed && run === version.current) setState(previous => previous ? { ...previous, ai } : previous);
      } catch {
        if (!disposed && run === version.current) setState(previous => previous ? { ...previous, ai: { ...previous.ai, configured: false, availability: 'check_failed', message: t('无法核验本机模型状态，请重新检查。', 'Cannot verify the local model status. Check again.') } } : previous);
      } finally { pending = false; }
    };
    const refresh = () => { void check(); };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [ideaId, t]);
  const bubble = state?.items.find(item => item.id === ideaId);
  const tagValues = tags(tagText); const invalidTags = tagValues.length > 8 || tagValues.some(tag => tag.length > 32);
  async function change(payload: unknown, success: string) { if (busy) return; setBusy(true); setError(''); try { await request<Bubble>(`/inspiration/${ideaId}`, 'PATCH', { ...(payload as Record<string, unknown>), revision: bubble?.revision }); await load(); await onCanonicalChanged?.(); setMessage(success); setUnlink(''); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }
  return <div className="idea-growth-space">{error && <Notice error>{error} <button className="pw-text-button" disabled={busy} onClick={() => void load()}>{t('重试', 'Retry')}</button></Notice>}{message && <Notice>{message}</Notice>}{!bubble || !state ? !error && <p role="status">{t('正在读取气泡关联…', 'Loading bubble links…')}</p> : <>
    <InspirationExplore key={bubble.id} bubble={bubble} ai={state.ai} onChanged={async () => { await load(); await onCanonicalChanged?.(); }}/><details className="idea-links-panel"><summary>{t('标签与融合来源', 'Tags & combined ideas')}</summary><form className="idea-metadata-extension" onSubmit={event => { event.preventDefault(); if (!invalidTags) void change({ tags: tagValues }, t('标签已保存。', 'Tags saved.')); }}><label>{t('标签（逗号分隔）', 'Tags (comma separated)')}<input value={tagText} maxLength={270} disabled={busy} onChange={e => setTagText(e.target.value)} aria-invalid={invalidTags || undefined}/></label>{invalidTags && <p className="idea-danger">{t('最多 8 个标签，每个不超过 32 字。', 'Up to 8 tags, at most 32 characters each.')}</p>}<div className="idea-actions"><button className="pw-button" disabled={busy || invalidTags || tagText === bubble.tags.join(', ')}>{t('保存标签', 'Save tags')}</button><button className="pw-text-button" type="button" disabled={busy || tagText !== bubble.tags.join(', ')} onClick={() => void change({ pinned: !bubble.pinned }, bubble.pinned ? t('已取消置顶。', 'Unpinned.') : t('已置顶。', 'Pinned.'))}>{bubble.pinned ? t('取消置顶', 'Unpin bubble') : t('置顶气泡', 'Pin bubble')}</button></div></form>
    {bubble.sources.length > 0 && <section className="idea-sources"><h3>{t('从这些想法生长而来', 'Grown from these ideas')}</h3><p className="idea-help">{t('保留融合时的快照。来源后来改变，也不会改写这颗气泡。', 'Snapshots are kept from the moment of fusion. Later source edits do not change this bubble.')}</p>{bubble.sources.map(source => { const live = state.items.find(item => item.id === source.id); return <div className="idea-source" key={source.id}><strong>{source.title}</strong>{source.body && <p className="idea-prewrap">{source.body}</p>}<small>{!live ? t('原始记录已移除，快照仍保留', 'Original removed; snapshot retained') : live.updatedAt !== source.updatedAt ? t('原始记录后来有更新', 'Original updated since fusion') : t('融合时的来源快照', 'Source snapshot at fusion')}</small><div className="idea-actions">{live && <Link className="pw-text-button" to={`/ideas/${encodeURIComponent(source.id)}`}>{t('查看原想法', 'Open original idea')}</Link>}<button className="pw-text-button" disabled={busy} onClick={() => setUnlink(source.id)}>{t('解除这条来源', 'Unlink this source')}</button></div>{unlink === source.id && <div className="idea-confirm"><p>{t('解除后只移除此来源快照，原始想法仍保留。', 'Only this source snapshot is unlinked. The original idea stays.')}</p><div className="idea-actions"><button className="pw-button" disabled={busy} onClick={() => setUnlink('')}>{t('取消', 'Cancel')}</button><button className="pw-button" disabled={busy} onClick={() => void change({ sourceIds: bubble.sources.filter(row => row.id !== source.id).map(row => row.id) }, t('来源关联已解除。', 'Source unlinked.'))}>{t('确认解除', 'Unlink source')}</button></div></div>}</div>; })}</section>}
    </details><InspirationLaunch key={bubble.id} bubble={bubble}/>
  </>}</div>;
}
