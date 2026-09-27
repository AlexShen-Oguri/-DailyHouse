import { useCallback, useEffect, useRef, useState } from 'react';
import { Close } from 'pixelarticons/react';
import { dateLabel, request } from './api';
import { usePreferences } from './Preferences';
import { collectionConversation, collectionIssue, collectionSummary, isCollectionActive, type CollectionRun } from './ReadingCollection';
import { Empty, Notice } from './shared';

export default function ReadingImports({ onBusy, onRetry }: { onBusy: (busy: boolean) => void; onRetry: () => void }) {
  const { t, locale, language } = usePreferences();
  const [items, setItems] = useState<CollectionRun[]>([]); const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [removeId, setRemoveId] = useState('');
  const version = useRef(0); const refreshButton = useRef<HTMLButtonElement>(null); const confirmHeading = useRef<HTMLHeadingElement>(null);
  const load = useCallback(async () => {
    const current = ++version.current;
    try { const next = await request<{ items: CollectionRun[] }>('/reading/reads'); if (current === version.current) { setItems(next.items.slice(0, 5)); setError(''); } }
    catch (err) { if (current === version.current) setError((err as Error).message); }
    finally { if (current === version.current) setLoading(false); }
  }, [language]);
  useEffect(() => { void load(); return () => { version.current++; }; }, [load]);
  useEffect(() => { onBusy(!!busy); return () => onBusy(false); }, [busy, onBusy]);
  useEffect(() => { if (removeId) confirmHeading.current?.focus(); }, [removeId]);
  const active = items.some(isCollectionActive);
  useEffect(() => { if (!active) return; const timer = window.setInterval(() => { if (!document.hidden && !busy && !removeId) void load(); }, 2000); return () => clearInterval(timer); }, [active, busy, removeId, load]);
  async function remove() {
    if (!removeId || busy) return; setBusy(removeId); setError(''); version.current++;
    try { await request(`/reading/reads/${encodeURIComponent(removeId)}`, 'DELETE', { confirm: true }); setItems(previous => previous.filter(item => item.id !== removeId)); setRemoveId(''); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(''); }
  }
  useEffect(() => { if (!busy && !removeId && !loading) refreshButton.current?.focus(); }, [busy, removeId, loading]);
  return <section className="reading-shelf reading-imports" aria-label={t('最近读取', 'Recent readings')}>
    <div className="reading-panel-intro reading-recent-heading"><div><h2>{t('最近读取', 'Recent readings')}</h2><p>{t('保留最近 5 次结果，收好的内容一直留在书架。', 'The last 5 readings. Saved items stay on your shelf.')}</p></div><button ref={refreshButton} className="pw-text-button" disabled={!!busy} onClick={() => void load()}>{t('刷新记录', 'Refresh history')}</button></div>
    {error && <Notice error>{error}</Notice>}
    {loading ? <p className="pw-loading" role="status">{t('正在读取记录…', 'Loading history…')}</p> : !items.length ? <Empty title={t('还没有读取记录', 'No readings yet')}><p>{t('点上方“一键读取”，Codex 会把值得读的内容整理到书架。', 'Press Read now above. Codex will sort useful content into your shelf.')}</p></Empty> : <ol className="reading-recent-list">{items.map(item => {
      const issue = collectionIssue(item, t); const conversation = collectionConversation(item);
      return <li key={item.id}>
        <div className="reading-recent-meta"><span>{t('B 站 · Codex 整理', 'Bilibili · Sorted by Codex')}</span><time dateTime={item.createdAt}>{dateLabel(item.createdAt, locale)}</time>{!isCollectionActive(item) && <button className="pw-icon-button" aria-label={t('删除读取记录：', 'Delete reading record: ') + dateLabel(item.createdAt, locale)} disabled={!!busy} onClick={() => setRemoveId(item.id)}><Close width={17}/></button>}</div>
        <h3>{collectionSummary(item, t)}</h3>
        {item.coverage && <p className="reading-recent-range">{t('读取范围：', 'History read: ')}{dateLabel(item.coverage.from, locale)} – {dateLabel(item.coverage.to, locale)}{!item.coverage.complete && t('（部分历史）', ' (partial history)')}</p>}
        {issue && <p>{issue}</p>}
        {(conversation || ['failed', 'needs_login', 'partial'].includes(item.status)) && <div className="reading-collection-actions">{conversation && <a className="pw-text-button" href={conversation}>{t('打开 Codex 采集对话', 'Open collection in Codex')}</a>}{['failed', 'needs_login', 'partial'].includes(item.status) && <button className="pw-text-button" onClick={onRetry}>{t('重新读取', 'Read again')}</button>}</div>}
        {removeId === item.id && <div className="reading-collection-confirm"><h4 ref={confirmHeading} tabIndex={-1}>{t('删除这条读取记录？', 'Delete this reading record?')}</h4><p>{t('只删除这条摘要，书架内容和 Codex 对话保留。', 'Only this summary is deleted. Shelf items and the Codex conversation are kept.')}</p><div className="reading-collection-actions"><button className="pw-button small" disabled={!!busy} onClick={() => void remove()}>{t('删除记录', 'Delete record')}</button><button className="pw-text-button" disabled={!!busy} onClick={() => setRemoveId('')}>{t('取消', 'Cancel')}</button></div></div>}
      </li>;
    })}</ol>}
  </section>;
}
