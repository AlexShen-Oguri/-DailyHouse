import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { dateLabel, request } from './api';
import { usePreferences } from './Preferences';
import { categoryNames, type ReadingCategory, type ReadingItem } from './reading-model';
import { Empty, Notice } from './shared';

export type ImportItem = { title: string; url: string; notes?: string; coverUrl?: string; viewedAt: string; progress: number | null };
type Coverage = { from: string; to: string; complete: boolean };
export type ImportPayload = { items: ImportItem[]; coverage?: Coverage; acceptedUrls?: string[]; excludedUrls?: string[] };
type Decision = 'import' | 'duplicate' | 'suppressed' | 'excluded' | 'review';
export type ImportCandidate = ImportItem & { index: number; sourceKey: string; category: ReadingCategory; reason: string; decision: Decision };
type Counts = { total: number; accepted: number; excluded: number; review: number; duplicates: number; suppressed: number };
export type ImportPreview = { candidates: ImportCandidate[]; counts: Counts; coverage?: Coverage; window: { from: string; to: string } };
export type ImportBatch = { id: string; createdAt: string; coverage?: Coverage; counts: Counts; addedCount: number; duplicateCount: number; excludedCount: number; reviewCount: number; suppressedCount: number; itemIds: string[]; canUndo: boolean; undoneAt?: string; candidates: ImportCandidate[]; undoResult?: { removedCount: number; conflictCount: number; skippedCount: number } };
const decisionNames: Record<Decision, [string, string]> = { import: ['将收录', 'To import'], duplicate: ['已有条目', 'Already saved'], suppressed: ['已移除，跳过', 'Previously removed'], excluded: ['不收录', 'Excluded'], review: ['待确认', 'Needs review'] };
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export default function ReadingImports({ onChanged, onBusy }: { onChanged: () => Promise<void>; onBusy: (busy: boolean) => void }) {
  const { t, locale, language } = usePreferences();
  const [batches, setBatches] = useState<ImportBatch[]>([]); const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<ImportPayload | null>(null); const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState(''); const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [feedback, setFeedback] = useState('');
  const [undoId, setUndoId] = useState(''); const [decision, setDecision] = useState('all');
  const previewHeading = useRef<HTMLHeadingElement>(null); const fileInput = useRef<HTMLInputElement>(null); const version = useRef(0);
  const load = useCallback(async () => {
    const current = ++version.current;
    try { const next = await request<{ items: ImportBatch[] }>('/reading/imports'); if (current === version.current) { setBatches(next.items); setError(''); } }
    catch (err) { if (current === version.current) setError((err as Error).message); }
    finally { if (current === version.current) setLoading(false); }
  }, [language]);
  useEffect(() => { void load(); return () => { version.current++; }; }, [load]);
  useEffect(() => { onBusy(!!busy); return () => onBusy(false); }, [busy, onBusy]);
  useEffect(() => { if (preview && !busy) previewHeading.current?.focus(); }, [preview, busy]);
  async function inspect(next: ImportPayload) {
    setBusy('preview'); setError(''); setFeedback('');
    try { const result = await request<ImportPreview>('/reading/imports/preview', 'POST', next); setPayload(next); setPreview(result); setDirty(false); setDecision('all'); previewHeading.current?.focus(); }
    catch (err) { setError((err as Error).message); if (fileInput.current) fileInput.current.value = ''; }
    finally { setBusy(''); }
  }
  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setError(''); setFeedback(''); setPreview(null); setPayload(null); setFileName(file.name); setDirty(false);
    if (file.size > MAX_IMPORT_BYTES) { setError(t('文件超过 2 MB，请拆成更小的批次。', 'The file exceeds 2 MB. Split it into smaller batches.')); event.target.value = ''; return; }
    setBusy('file');
    try {
      const parsed: unknown = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
      if (!parsed || typeof parsed !== 'object' || !('items' in parsed) || !Array.isArray(parsed.items)) throw new Error(t('JSON 需要包含 items 数组；每项包含标题、链接、观看时间和播放比例。', 'The JSON must contain an items array with title, URL, viewedAt and progress.'));
      const next = parsed as ImportPayload;
      await inspect({ items: next.items, ...(next.coverage ? { coverage: next.coverage } : {}), ...(next.acceptedUrls ? { acceptedUrls: next.acceptedUrls } : {}), ...(next.excludedUrls ? { excludedUrls: next.excludedUrls } : {}) });
    } catch (err) { setError(err instanceof SyntaxError ? t('无法解析 JSON，请检查文件格式后重试。', 'Invalid JSON. Check the file and try again.') : (err as Error).message); if (fileInput.current) fileInput.current.value = ''; setBusy(''); }
  }
  function choose(candidate: ImportCandidate, include: boolean) {
    if (!payload || busy) return;
    const accepted = new Set(payload.acceptedUrls ?? []); const excluded = new Set(payload.excludedUrls ?? []);
    if (include) { excluded.delete(candidate.url); if (candidate.decision === 'review' || candidate.decision === 'excluded') accepted.add(candidate.url); }
    else { accepted.delete(candidate.url); excluded.add(candidate.url); }
    setPayload({ ...payload, acceptedUrls: [...accepted], excludedUrls: [...excluded] }); setDirty(true); setFeedback('');
  }
  async function commit() {
    if (!payload || !preview || dirty || busy) return;
    setBusy('import'); setError(''); setFeedback('');
    try {
      const result = await request<ImportPreview & { batch: ImportBatch; items: ReadingItem[] }>('/reading/imports', 'POST', payload);
      setPreview(null); setPayload(null); setFileName(''); if (fileInput.current) fileInput.current.value = '';
      setFeedback(t(`已收录 ${result.items.length} 项；${result.counts.review} 项保留在批次记录中待确认。`, `Imported ${result.items.length} items; ${result.counts.review} remain in the batch log for review.`));
      await Promise.all([load(), onChanged()]);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(''); }
  }
  async function undo(id: string) {
    if (busy) return; setBusy(id); setError(''); setFeedback('');
    try {
      const result = await request<{ removedIds: string[]; conflictIds: string[]; skippedIds: string[]; alreadyUndone: boolean }>(`/reading/imports/${encodeURIComponent(id)}/undo`, 'POST', {});
      setUndoId('');
      setFeedback(result.alreadyUndone ? t('这个批次已撤销，无需重复操作。', 'This batch has already been undone.') : t(`已撤销 ${result.removedIds.length} 项；保留 ${result.conflictIds.length} 项后来修改的内容，另有 ${result.skippedIds.length} 项已不在书架。`, `Undid ${result.removedIds.length} items; kept ${result.conflictIds.length} items edited since import and skipped ${result.skippedIds.length} no longer on the shelf.`));
      await Promise.all([load(), onChanged()]);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(''); }
  }
  const candidates = preview?.candidates.filter(candidate => decision === 'all' || candidate.decision === decision) ?? [];
  return <section className="reading-shelf reading-imports" aria-label={t('书架导入记录', 'Shelf imports')}>
    <div className="reading-panel-intro"><h2>{t('预览后，再收进书架', 'Review before importing')}</h2><p>{t('读取你选择的本机 JSON。先核对条目、分类和跳过理由；确认后才会写入。已有和曾移出的内容不会重复收录。', 'Choose a local JSON file. Review items, categories and skip reasons before saving. Existing and previously removed items are not imported again.')}</p></div>
    {error && <Notice error>{error}</Notice>}{feedback && <Notice>{feedback}</Notice>}
    <div className="reading-import-file"><label>{t('选择历史记录 JSON（最多 2 MB）', 'History JSON file (up to 2 MB)')}<input ref={fileInput} type="file" accept=".json,application/json" disabled={!!busy} onChange={event => void chooseFile(event)}/></label><span>{busy === 'file' || busy === 'preview' ? t('正在生成预览…', 'Preparing preview…') : fileName}</span></div>
    <details className="reading-import-help"><summary>{t('文件格式与导入规则', 'File format & import rules')}</summary><p>{t('每项需要 title、url、viewedAt（含时区的 ISO 时间）与 progress（0–1 的播放比例；未知填 null），可附 notes 与 coverUrl。时间覆盖范围可放在 coverage 中。', 'Each item needs title, url, viewedAt (ISO time with time zone) and progress (0–1, or null if unknown). notes and coverUrl are optional. Put the observed range in coverage.')}</p><pre>{'{ "items": [{ "title": "Example", "url": "https://www.bilibili.com/video/BV…/", "viewedAt": "2026-09-27T09:00:00-04:00", "progress": 0.12 }] }'}</pre><p>{t('只收录最近 7 天、播放比例低于 25% 且主题符合的内容。缺少可靠进度、明确无关、重复或曾移出的内容不会因手动确认而绕过规则。', 'Only matching material watched in the last 7 days with progress below 25% is eligible. Confirmation cannot override missing progress, unrelated material, duplicates or previous removals.')}</p></details>
    {preview && payload && <section className="reading-import-preview" aria-label={t('导入预览', 'Import preview')}>
      <div className="pw-section-head"><h3 ref={previewHeading} tabIndex={-1}>{t('本次预览', 'This preview')}</h3><span className="pw-subtle">{dateLabel(preview.window.from, locale)} – {dateLabel(preview.window.to, locale)}</span></div>
      <p className="reading-import-summary">{t(`${preview.counts.total} 项 · 将收录 ${preview.counts.accepted} · 待确认 ${preview.counts.review} · 已有 ${preview.counts.duplicates} · 已移除 ${preview.counts.suppressed} · 排除 ${preview.counts.excluded}`, `${preview.counts.total} items · ${preview.counts.accepted} to import · ${preview.counts.review} to review · ${preview.counts.duplicates} saved · ${preview.counts.suppressed} removed · ${preview.counts.excluded} excluded`)}</p>
      {preview.coverage && !preview.coverage.complete && <Notice>{t('这份历史覆盖不完整；只处理实际读取到的条目。', 'History coverage is incomplete. Only the observed items will be processed.')}</Notice>}
      <label className="reading-import-decision-filter">{t('查看结果', 'Show results')}<select value={decision} disabled={!!busy} onChange={event => setDecision(event.target.value)}><option value="all">{t('全部结果', 'All results')}</option>{Object.entries(decisionNames).map(([value, names]) => <option key={value} value={value}>{t(...names)}</option>)}</select></label>
      <ul className="reading-import-candidates">{candidates.map(candidate => {
        const editable = candidate.decision === 'import' || candidate.decision === 'review' || (payload.excludedUrls ?? []).includes(candidate.url) || (payload.acceptedUrls ?? []).includes(candidate.url);
        const checked = !(payload.excludedUrls ?? []).includes(candidate.url) && (candidate.decision === 'import' || (payload.acceptedUrls ?? []).includes(candidate.url));
        return <li key={candidate.index}><div className="reading-import-candidate-head"><strong>{candidate.title}</strong><span>{t(...decisionNames[candidate.decision])}</span></div><p>{t(...categoryNames[candidate.category])} · {candidate.progress === null ? t('进度未知', 'Progress unknown') : `${Math.round(candidate.progress * 100)}%`} · {dateLabel(candidate.viewedAt, locale)}</p><p>{candidate.reason}</p>{editable && <label className="reading-import-choice"><input type="checkbox" checked={checked} disabled={!!busy} aria-label={t('收录：', 'Include: ') + candidate.title} onChange={event => choose(candidate, event.target.checked)}/>{candidate.decision === 'review' ? t('我确认这项内容有教育或实用价值', 'I confirm this has educational or practical value') : t('本批次收录', 'Include in this batch')}</label>}</li>;
      })}</ul>
      {dirty && <p role="status" className="pw-footnote">{t('选择有变化，请更新预览后再确认。', 'Your selections changed. Update the preview before confirming.')}</p>}
      <div className="reading-import-actions"><button className="pw-button" disabled={!!busy || !dirty} onClick={() => void inspect(payload)}>{t('更新预览', 'Update preview')}</button><button className="pw-button primary" disabled={!!busy || dirty || !preview.counts.total} onClick={() => void commit()}>{busy === 'import' ? t('写入中…', 'Importing…') : preview.counts.accepted ? t(`确认收录 ${preview.counts.accepted} 项`, `Import ${preview.counts.accepted} items`) : t('保存本次审阅记录', 'Save this review')}</button><button className="pw-text-button" disabled={!!busy} onClick={() => { setPreview(null); setPayload(null); setFileName(''); if (fileInput.current) fileInput.current.value = ''; }}>{t('取消本次导入', 'Cancel import')}</button></div>
      <p className="pw-footnote">{t('未确认的内容保留在批次记录中，不加入书架；可以稍后重新审阅。', 'Unconfirmed items remain in the batch log and stay off the shelf. Review them later.')}</p>
    </section>}
    <div className="reading-import-history"><div className="pw-section-head"><h2>{t('导入批次', 'Import history')}</h2><button className="pw-text-button" disabled={!!busy} onClick={() => void load()}>{t('刷新记录', 'Refresh history')}</button></div>
      {loading ? <p role="status">{t('正在读取记录…', 'Loading history…')}</p> : !batches.length ? <Empty title={t('还没有导入批次', 'No import batches yet')}><p>{t('完成首次导入后，可在这里核对结果或撤销。', 'After importing, review the result or undo the batch here.')}</p></Empty> : <ul className="reading-batches">{batches.map(batch => <li key={batch.id}>
        <div className="reading-batch-heading"><strong>{dateLabel(batch.createdAt, locale)}</strong><span>{t(`收录 ${batch.addedCount} 项`, `${batch.addedCount} imported`)}{batch.undoneAt && ` · ${t('已撤销', 'Undone')}`}</span></div>
        <p>{t(`已有 ${batch.duplicateCount} · 排除 ${batch.excludedCount} · 已移除 ${batch.suppressedCount} · 待确认 ${batch.reviewCount}`, `${batch.duplicateCount} saved · ${batch.excludedCount} excluded · ${batch.suppressedCount} previously removed · ${batch.reviewCount} to review`)}</p>
        {batch.undoResult && <p>{t(`撤销 ${batch.undoResult.removedCount} 项，保留 ${batch.undoResult.conflictCount} 项后续编辑，跳过 ${batch.undoResult.skippedCount} 项。`, `Undid ${batch.undoResult.removedCount}; kept ${batch.undoResult.conflictCount} later edits; skipped ${batch.undoResult.skippedCount}.`)}</p>}
        <div className="reading-import-actions">{batch.reviewCount > 0 && <button className="pw-text-button" disabled={!!busy} onClick={() => { setFileName(t('待确认条目', 'Items awaiting review')); void inspect({ items: batch.candidates.filter(candidate => candidate.decision === 'review').map(({ title, url, notes, coverUrl, viewedAt, progress }) => ({ title, url, notes, coverUrl, viewedAt, progress })), ...(batch.coverage ? { coverage: batch.coverage } : {}) }); }}>{t('重新审阅待确认项', 'Review pending items')}</button>}{batch.canUndo && <button className="pw-text-button reading-remove" disabled={!!busy} onClick={() => setUndoId(batch.id)}>{t('撤销此批次', 'Undo batch')}</button>}</div>
        {undoId === batch.id && <div className="reading-undo-confirm"><p>{t('撤销会将本批次新建且未被后续修改的条目移入回收站。已经编辑或完成的内容会保留。', 'Undo moves unchanged items created by this batch to the recycle bin. Items edited or completed afterward are kept.')}</p><div className="reading-import-actions"><button className="pw-button" disabled={!!busy} onClick={() => setUndoId('')}>{t('取消', 'Cancel')}</button><button className="pw-button reading-danger-button" disabled={!!busy} onClick={() => void undo(batch.id)}>{busy === batch.id ? t('撤销中…', 'Undoing…') : t('确认撤销批次', 'Confirm undo')}</button></div></div>}
        <details><summary>{t('逐项结果', 'Item-by-item results')}</summary><ul className="reading-batch-log">{batch.candidates.map(candidate => <li key={candidate.index}><strong>{candidate.title}</strong><span>{t(...decisionNames[candidate.decision])} · {candidate.reason}</span></li>)}</ul></details>
      </li>)}</ul>}
    </div>
  </section>;
}
