import { useState } from 'react';
import { request } from './api';
import { usePreferences } from './Preferences';
import { categoryNames, type ReadingItem } from './reading-model';
import '../styles/quick-reading.css';

export default function ReadingClassification({ item, onChanged }: { item: ReadingItem; onChanged: () => Promise<void> }) {
  const { t } = usePreferences(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const state = item.classification;
  if (!state || state.status === 'manual' || state.status === 'ready') return null;
  async function retry(accept = false) {
    if (busy) return; setBusy(true); setError('');
    try { await request(`/reading/${encodeURIComponent(item.id)}${accept ? '' : '/classify'}`, accept ? 'PATCH' : 'POST', accept ? { category: state?.suggestedCategory } : {}); await onChanged(); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <div className="reading-classification" aria-busy={state.status === 'pending' || busy}>
    <p role={state.status === 'pending' ? 'status' : undefined}>{state.status === 'pending' ? t('Qwen 正在排队分类…', 'Queued for Qwen classification…') : state.status === 'review' ? t('Qwen 不太确定，请确认分类。', 'Qwen is unsure. Please confirm a category.') : t('Qwen 分类未完成，内容已保存在书架。', 'Qwen classification failed. Your item is saved on the shelf.')}</p>
    {state.status === 'review' && state.suggestedCategory && <button className="pw-text-button" disabled={busy} onClick={() => void retry(true)}>{t('使用建议：', 'Use suggestion: ')}{t(...categoryNames[state.suggestedCategory])}</button>}
    {state.status !== 'pending' && <button className="pw-text-button" disabled={busy} onClick={() => void retry()}>{busy ? t('提交中…', 'Submitting…') : t('重试分类', 'Retry classification')}</button>}
    {state.status !== 'pending' && (state.message || state.reason) && <details><summary>{t('查看原因', 'Details')}</summary><p>{state.message || state.reason}</p></details>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
