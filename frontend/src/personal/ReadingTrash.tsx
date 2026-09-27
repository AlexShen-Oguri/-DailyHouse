import { useCallback, useEffect, useRef, useState } from 'react';
import { dateLabel, request } from './api';
import { usePreferences } from './Preferences';
import { categoryNames, typeNames, type ReadingItem } from './reading-model';
import { Empty, Notice } from './shared';

export type TrashEntry = { item: ReadingItem; deletedAt: string; expiresAt: string; batchId?: string };
export default function ReadingTrash({ onChanged, onBusy }: { onChanged: () => Promise<void>; onBusy: (busy: boolean) => void }) {
  const { t, locale, language } = usePreferences();
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [feedback, setFeedback] = useState('');
  const [purge, setPurge] = useState<TrashEntry | null>(null);
  const restoreButton = useRef<HTMLButtonElement>(null); const selectAll = useRef<HTMLInputElement>(null);
  const returnFocus = useRef(false); const confirmPanel = useRef<HTMLElement>(null);
  const version = useRef(0);
  const load = useCallback(async () => {
    const current = ++version.current;
    try { const next = await request<{ items: TrashEntry[] }>('/reading/trash'); if (current === version.current) { setEntries(next.items); setError(''); } }
    catch (err) { if (current === version.current) setError((err as Error).message); }
    finally { if (current === version.current) setLoading(false); }
  }, [language]);
  useEffect(() => { void load(); return () => { version.current++; }; }, [load]);
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  useEffect(() => { if (!busy && returnFocus.current) { returnFocus.current = false; restoreButton.current?.focus(); } }, [busy, feedback]);
  useEffect(() => { if (purge) confirmPanel.current?.focus(); }, [purge]);
  const visible = entries.filter(({ item }) => `${item.title} ${item.notes} ${item.url}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const recoverable = visible.filter(entry => Date.parse(entry.expiresAt) > Date.now());
  const selectedIds = recoverable.filter(entry => selected.has(entry.item.id)).map(entry => entry.item.id);
  const allSelected = recoverable.length > 0 && selectedIds.length === recoverable.length;
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = selectedIds.length > 0 && !allSelected; }, [selectedIds.length, allSelected]);
  async function restore(ids: string[]) {
    if (busy || !ids.length) return;
    setBusy(true); setError(''); setFeedback(''); version.current++;
    try {
      const result = await request<{ restoredIds: string[] }>('/reading/restore', 'POST', { ids });
      setEntries(previous => previous.filter(entry => !result.restoredIds.includes(entry.item.id)));
      setSelected(new Set());
      setFeedback(t(`已恢复 ${result.restoredIds.length} 项，保留原来的阅读状态。`, `Restored ${result.restoredIds.length} items with their previous reading status.`));
      await onChanged();
      returnFocus.current = true;
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function permanentlyDelete() {
    if (busy || !purge) return;
    setBusy(true); setError(''); setFeedback('');
    try {
      const result = await request<{ deletedId: string; cleanupPending?: boolean }>(`/reading/trash/${encodeURIComponent(purge.item.id)}`, 'DELETE', { deletedAt: purge.deletedAt });
      setEntries(previous => previous.filter(entry => entry.item.id !== purge.item.id));
      setSelected(previous => { const next = new Set(previous); next.delete(purge.item.id); return next; }); setPurge(null);
      setFeedback(result.cleanupPending ? t('记录已删除，系统占用的附件副本将在后续清理；原文件保留。', 'Record deleted. The managed copy is in use and will be cleaned up later; the original file is kept.') : t('记录已永久删除，原始网页和本机原文件保留。', 'Record permanently deleted. Original pages and source files are kept.'));
      await onChanged(); returnFocus.current = true;
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return <section className="reading-shelf reading-trash" aria-label={t('书架回收站', 'Shelf recycle bin')}>
    <div className="reading-panel-intro"><h2>{t('回收站', 'Recycle bin')}</h2><p>{t('移出后保留 30 天，到期不可恢复。恢复会带回原来的分类、笔记和阅读状态；原始网页和文件始终保留。', 'Items stay here for 30 days and cannot be recovered afterward. Restore their categories, notes and reading status. Original pages and files are kept.')}</p></div>
    {error && <Notice error>{error}</Notice>}{feedback && <Notice>{feedback}</Notice>}
    {purge && <section ref={confirmPanel} tabIndex={-1} className="idea-delete-confirm" aria-label={t('确认永久删除书架记录', 'Confirm permanent shelf-record deletion')}><h3>{t(`永久删除“${purge.item.title}”？`, `Permanently delete “${purge.item.title}”?`)}</h3><p>{t('将永久删除这条记录及工作台保存的文件副本，无法恢复。原始网页、导入前的本机文件不会被删除。', 'Permanently delete this record and its managed file copy. It cannot be restored. The original page and original source file stay untouched.')}</p><div className="idea-actions"><button className="pw-button" disabled={busy} onClick={() => void permanentlyDelete()}>{busy ? t('删除中…', 'Deleting…') : t('确认永久删除', 'Permanently delete')}</button><button className="pw-text-button" disabled={busy} onClick={() => setPurge(null)}>{t('取消', 'Cancel')}</button></div></section>}
    <div className="reading-filters"><label className="pw-search"><span className="pw-sr-only">{t('搜索回收站', 'Search recycle bin')}</span><input aria-label={t('搜索回收站', 'Search recycle bin')} value={search} placeholder={t('查找移出的内容', 'Find removed items')} disabled={busy} onChange={event => { setSearch(event.target.value); setSelected(new Set()); }}/></label><button ref={restoreButton} className="pw-text-button" disabled={busy} onClick={() => void load()}>{t('刷新', 'Refresh')}</button></div>
    {!!entries.length && <div className="reading-selection"><label className="reading-select-all"><input ref={selectAll} type="checkbox" checked={allSelected} disabled={busy || !recoverable.length} onChange={event => setSelected(new Set(event.target.checked ? recoverable.map(entry => entry.item.id) : []))}/>{t('全选可恢复项', 'Select recoverable items')}</label><span>{t(`已选 ${selectedIds.length} 项`, `${selectedIds.length} selected`)}</span><button className="pw-button small" disabled={busy || !selectedIds.length} onClick={() => void restore(selectedIds)}>{busy ? t('恢复中…', 'Restoring…') : t('恢复所选', 'Restore selected')}</button></div>}
    {loading ? <p className="pw-loading" role="status">{t('正在读取回收站…', 'Loading removed items…')}</p> : visible.length ? <ul className="reading-list">{visible.map(entry => {
      const expired = Date.parse(entry.expiresAt) <= Date.now();
      return <li className="reading-trash-row" key={entry.item.id}>
        <label className="reading-pick"><input type="checkbox" aria-label={t('恢复选择：', 'Select to restore: ') + entry.item.title} disabled={busy || expired} checked={selected.has(entry.item.id)} onChange={event => setSelected(previous => { const next = new Set(previous); event.target.checked ? next.add(entry.item.id) : next.delete(entry.item.id); return next; })}/></label>
        <div className="pw-grow"><div className="reading-item-meta"><span>{t(...typeNames[entry.item.type])}</span><span>{t(...categoryNames[entry.item.category ?? 'other'])}</span></div><h3>{entry.item.title}</h3><p>{t('移出于', 'Removed')} {dateLabel(entry.deletedAt, locale)} · {expired ? t('已过恢复期限', 'Restore period ended') : `${t('可恢复至', 'Recoverable until')} ${dateLabel(entry.expiresAt, locale)}`}</p></div>
        <div className="reading-trash-actions"><button className="pw-button small" disabled={busy || expired} onClick={() => void restore([entry.item.id])}>{t('恢复', 'Restore')}</button><button className="pw-text-button idea-danger" disabled={busy} onClick={() => setPurge(entry)}>{t('永久删除', 'Delete permanently')}</button></div>
      </li>;
    })}</ul> : <Empty title={search ? t('没有匹配的移出记录', 'No matching removed items') : t('回收站是空的', 'The recycle bin is empty')}><p>{t('从书架移出的内容会在这里保留 30 天。', 'Items removed from the shelf stay here for 30 days.')}</p></Empty>}
  </section>;
}
