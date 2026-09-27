import { useState } from 'react';
import { request } from './api';
import { usePreferences } from './Preferences';
import { type ReadingItem } from './reading-model';
import '../styles/quick-reading.css';

export default function ReadingClassification({ item, onChanged }: { item: ReadingItem; onChanged: () => Promise<void> }) {
  const { t } = usePreferences(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const state = item.classification;
  if (!state || ['manual', 'ready', 'review'].includes(state.status)) return null;
  async function retry() {
    if (busy) return; setBusy(true); setError('');
    try { await request(`/reading/${encodeURIComponent(item.id)}/classify`, 'POST', {}); await onChanged(); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <div className="reading-classification" aria-busy={state.status === 'pending' || busy}>
    <p role={state.status === 'pending' ? 'status' : undefined}>{state.status === 'pending' ? t('正在自动分类…', 'Sorting automatically…') : t('已收好，自动分类暂未完成。也可以直接编辑分类。', 'Saved. Automatic sorting is unfinished; you can also edit the category.')}</p>
    {state.status === 'failed' && <button className="pw-text-button" disabled={busy} onClick={() => void retry()}>{busy ? t('提交中…', 'Submitting…') : t('重试分类', 'Retry sorting')}</button>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
