import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Close, Download, Play } from 'pixelarticons/react';
import { dateLabel, request } from './api';
import { usePreferences } from './Preferences';
import '../styles/reading-collection.css';

export type CollectionRun = {
  id: string;
  status: 'queued' | 'reading' | 'importing' | 'completed' | 'partial' | 'needs_login' | 'failed' | 'cancelled';
  createdAt: string; updatedAt: string; scanned: number;
  coverage?: { from: string; to: string; complete: boolean };
  result?: { added: number; updated: number; review: number; skipped: number; batchId?: string };
  issue?: string;
};
type CollectionState = { bridge: { connected: boolean; lastSeenAt?: string }; run: CollectionRun | null };
const isActive = (run: CollectionRun | null) => !!run && ['queued', 'reading', 'importing'].includes(run.status);

export default function ReadingCollection({ onChanged, onHistory, children }: { onChanged: () => Promise<void>; onHistory: () => void; children?: ReactNode }) {
  const { t, locale } = usePreferences();
  const [state, setState] = useState<CollectionState | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [expanded, setExpanded] = useState(false); const [setupOpen, setSetupOpen] = useState(false);
  const [extensionPath, setExtensionPath] = useState(''); const [setupBusy, setSetupBusy] = useState(false); const [setupError, setSetupError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const version = useRef(0); const mounted = useRef(true); const refreshed = useRef(new Set<string>());
  const restoreTrigger = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null); const setupHeading = useRef<HTMLHeadingElement>(null); const clearHeading = useRef<HTMLHeadingElement>(null);
  const run = state?.run ?? null; const active = isActive(run);
  const accept = useCallback((next: CollectionState) => {
    setState(next);
    const completed = next.run;
    if (completed?.result && !isActive(completed) && !refreshed.current.has(completed.id)) {
      refreshed.current.add(completed.id);
      void onChanged().catch(() => { /* The shelf exposes its own refresh error. */ });
    }
  }, [onChanged]);
  const refreshStatus = useCallback(async () => {
    const current = ++version.current;
    try {
      const next = await request<CollectionState>('/reading/collection');
      if (mounted.current && current === version.current) { accept(next); setConnectionError(''); }
      return next;
    } catch (err) { if (mounted.current && current === version.current) setConnectionError((err as Error).message); throw err; }
  }, [accept]);
  useEffect(() => { mounted.current = true; void refreshStatus().catch(() => {}); return () => { mounted.current = false; version.current++; }; }, [refreshStatus]);
  useEffect(() => {
    if (busy) return;
    // Only observe here. A collection always requires an explicit button press.
    let pending = false;
    const poll = () => { if (document.hidden || pending) return; pending = true; void refreshStatus().catch(() => {}).finally(() => { pending = false; }); };
    const timer = window.setInterval(poll, active ? 2000 : 15000);
    window.addEventListener('focus', poll);
    return () => { clearInterval(timer); window.removeEventListener('focus', poll); };
  }, [active, busy, refreshStatus]);
  useEffect(() => { if (setupOpen) setupHeading.current?.focus(); }, [setupOpen]);
  useEffect(() => { if (confirmClear) clearHeading.current?.focus(); }, [confirmClear]);
  useEffect(() => { if (!busy && restoreTrigger.current) { restoreTrigger.current = false; trigger.current?.focus(); } }, [busy, run?.id, confirmClear]);
  async function openSetup() {
    setSetupOpen(true); setExpanded(true);
    if (extensionPath || setupBusy) return;
    setSetupBusy(true); setSetupError('');
    try { const info = await request<{ extensionPath: string }>('/reading/collection/setup'); if (mounted.current) setExtensionPath(info.extensionPath); }
    catch (err) { if (mounted.current) setSetupError((err as Error).message); }
    finally { if (mounted.current) setSetupBusy(false); }
  }
  async function start() {
    if (busy || active) return;
    setBusy(true); setError(''); setExpanded(true); setConfirmClear(false);
    try {
      const latest = await refreshStatus();
      if (!latest.bridge.connected) { await openSetup(); return; }
      if (isActive(latest.run)) return;
      version.current++;
      const next = await request<CollectionRun>('/reading/collection', 'POST', {});
      if (mounted.current) { accept({ bridge: latest.bridge, run: next }); setSetupOpen(false); }
    } catch (err) { if (mounted.current) setError((err as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function cancel() {
    if (!run || busy) return;
    setBusy(true); setError(''); version.current++;
    try { const next = await request<CollectionRun>(`/reading/collection/${encodeURIComponent(run.id)}/cancel`, 'POST', {}); if (mounted.current) accept({ bridge: state!.bridge, run: next }); }
    catch (err) { if (mounted.current) setError((err as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function clear() {
    if (!run || busy || active) return;
    setBusy(true); setError(''); version.current++;
    try {
      await request(`/reading/collection/${encodeURIComponent(run.id)}`, 'DELETE', { confirm: true });
      if (mounted.current) { setState(previous => previous ? { ...previous, run: null } : previous); setConfirmClear(false); setExpanded(false); restoreTrigger.current = true; }
    } catch (err) { if (mounted.current) setError((err as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  }
  const status = run ? {
    queued: t('等待浏览器接单', 'Waiting for your browser'),
    reading: t('正在读取 B 站历史', 'Reading Bilibili history'),
    importing: t('正在筛选并收进书架', 'Checking and saving to your shelf'),
    completed: t('本次读取完成', 'Collection complete'),
    partial: t('已收录可确认的内容，历史未读完整', 'Saved verified items; history is incomplete'),
    needs_login: t('需要在浏览器登录 B 站', 'Sign in to Bilibili in your browser'),
    failed: t('本次读取未完成', 'Collection did not finish'),
    cancelled: t('已停止本次读取', 'Collection stopped'),
  }[run.status] : '';
  const issue = run?.issue ? {
    needs_login: t('在安装扩展的浏览器中登录后，再点“一键读取”。', 'Sign in in the browser with the extension, then press Read now.'),
    page_unavailable: t('B 站历史页暂时无法打开。请检查网络后重试。', 'The Bilibili history page could not open. Check your connection and retry.'),
    unsupported_page: t('历史页的结构或播放进度暂时无法识别。没有把未知进度当作未观看。', 'The history layout or playback progress could not be read. Unknown progress was not treated as unwatched.'),
    read_failed: t('浏览器读取中断。已收录的内容保留，可以重试。', 'Browser reading was interrupted. Saved items are kept; you can retry.'),
    bridge_disconnected: t('浏览器扩展已离线。打开安装了扩展的浏览器后重试。', 'The browser extension is offline. Open its browser and retry.'),
    timeout: t('读取超时。请检查 B 站历史页及浏览器扩展后重试。', 'Reading timed out. Check the history page and extension, then retry.'),
    server_restarted: t('小院服务重启，中断了这次读取。可以重新开始。', 'The local service restarted and interrupted this collection. You can start again.'),
    import_failed: t('历史已读取，但收录未完成。重试会保留已有内容并去重。', 'History was read but could not be saved. Retrying preserves existing items and avoids duplicates.'),
    classification_pending: t('内容已保存，Qwen 分类尚未完成。请在书架查看分类状态与重试入口。', 'Items are saved, but Qwen classification is unfinished. Check classification status and retry options on the shelf.'),
  }[run.issue] ?? t('读取遇到问题，请检查历史页后重试。', 'Collection encountered a problem. Check the history page and retry.') : '';
  const showPanel = expanded || active || !!run;
  return <>
    <div className="reading-head-actions">
      <button ref={trigger} type="button" className="pw-button reading-collect-button" aria-label={t('一键读取 B 站历史', 'Read Bilibili history now')} aria-controls="reading-collection-panel" aria-expanded={showPanel} disabled={busy || active} onClick={() => void start()}>
        <Download width={25} aria-hidden="true"/><span><strong>{active ? t('正在读取…', 'Reading…') : busy ? t('连接中…', 'Connecting…') : t('一键读取', 'Read now')}</strong><small>{t('B 站 · 近 7 天', 'Bilibili · Last 7 days')}</small></span>
      </button>
      {children}
      <button type="button" className="pw-text-button reading-collection-help" onClick={() => void openSetup()}>{t('读取设置', 'Reading setup')}</button>
    </div>
    {showPanel && <section id="reading-collection-panel" className="reading-collection-panel" aria-label={t('B 站历史读取', 'Bilibili history collection')}>
      {(error || connectionError) && <p className="reading-collection-error" role="alert">{error || connectionError}</p>}
      {run && <>
        <div className="reading-collection-heading"><h2 role="status">{run.status === 'completed' ? <Check width={19} aria-hidden="true"/> : <Play width={18} aria-hidden="true"/>}{status}</h2><time dateTime={run.updatedAt}>{dateLabel(run.updatedAt, locale)}</time></div>
        {run.status === 'queued' && <p>{t('扩展通常每 30 秒检查一次；浏览器休眠可能延迟。历史页会自动打开，读取期间请保持该页可见。', 'The extension usually checks every 30 seconds; browser sleep may delay it. The history page will open. Keep that tab visible while it reads.')}</p>}
        {run.status === 'reading' && <p role="status">{t(`已读取 ${run.scanned} 条历史，正在继续查看近一周的记录…`, `Read ${run.scanned} history entries; continuing through the last week…`)}</p>}
        {run.status === 'reading' && <p>{t('请保持 B 站历史页可见，切换到其他标签页会暂停继续加载。', 'Keep the Bilibili history tab visible. Switching tabs pauses further loading.')}</p>}
        {run.status === 'importing' && <p>{t('只收录播放进度明确低于 25% 的教育或实用内容。保存后由 Qwen 分类。', 'Saving educational or useful items with known progress below 25%. Qwen classifies them after saving.')}</p>}
        {run.result && <p className="reading-collection-result">{t(`新增 ${run.result.added} 项 · 更新 ${run.result.updated} 项 · 待确认 ${run.result.review} 项 · 跳过 ${run.result.skipped} 项`, `${run.result.added} added · ${run.result.updated} updated · ${run.result.review} to review · ${run.result.skipped} skipped`)}</p>}
        {run.coverage && <p className="reading-collection-coverage">{t('实际读取范围：', 'Actual coverage: ')}{dateLabel(run.coverage.from, locale)} — {dateLabel(run.coverage.to, locale)} · {run.coverage.complete ? t('完整', 'Complete') : t('仅部分记录', 'Partial records')}</p>}
        {issue && <p>{issue}</p>}
        {run.status === 'partial' && <p>{t('未读到的记录不会被删除，也不会宣称已经同步。可以重试补读。', 'Unread entries are left untouched. Retry to read the remaining history.')}</p>}
        <div className="reading-collection-actions">
          {active ? <button className="pw-text-button" disabled={busy} onClick={() => void cancel()}>{busy ? t('处理中…', 'Working…') : t('停止读取', 'Stop reading')}</button> : <>
            {run.status !== 'completed' && <button className="pw-button small" disabled={busy} onClick={() => void start()}>{t('重新读取', 'Read again')}</button>}
            <button className="pw-text-button" onClick={onHistory}>{run.result?.review ? t('查看待确认与导入记录', 'Review items & import history') : t('查看导入记录', 'View import history')}</button>
            <button className="pw-text-button" disabled={busy} onClick={() => setConfirmClear(true)}>{t('清除此条读取状态', 'Clear this collection status')}</button>
          </>}
          {(run.status === 'needs_login' || run.status === 'failed') && <a className="pw-text-button" href="https://www.bilibili.com/history" target="_blank" rel="noreferrer">{t('打开 B 站历史', 'Open Bilibili history')}</a>}
        </div>
      </>}
      {confirmClear && <div className="reading-collection-confirm"><h3 ref={clearHeading} tabIndex={-1}>{t('清除此条读取状态？', 'Clear this collection status?')}</h3><p>{t('只清除这里的状态。书架内容、导入批次和撤销入口都会保留。', 'Only this status is cleared. Shelf items, import batches and their undo options are kept.')}</p><div className="reading-collection-actions"><button className="pw-button small" disabled={busy} onClick={() => void clear()}>{t('确认清除状态', 'Confirm clear status')}</button><button className="pw-text-button" disabled={busy} onClick={() => setConfirmClear(false)}>{t('取消', 'Cancel')}</button></div></div>}
      {setupOpen && <div className="reading-collection-setup">
        <div className="reading-collection-heading"><h2 ref={setupHeading} tabIndex={-1}>{t('先连接你的浏览器', 'Connect your browser first')}</h2><button className="pw-icon-button" aria-label={t('关闭读取设置', 'Close reading setup')} onClick={() => { setSetupOpen(false); if (!run) setExpanded(false); trigger.current?.focus(); }}><Close width={18}/></button></div>
        <p role="status">{state?.bridge.connected ? t('浏览器扩展已连接。', 'The browser extension is connected.') : active ? t('浏览器扩展连接中断，请保持浏览器打开并检查扩展。上方会显示本次读取的实际结果。', 'The browser extension is disconnected. Keep its browser open and check the extension. The actual collection result will appear above.') : t('浏览器扩展尚未连接，当前没有开始读取。首次需要在 Edge 或 Chrome 中安装本机扩展。', 'The browser extension is not connected; no collection has started. Install the local extension in Edge or Chrome once.')}</p>
        <ol><li>{t('在 Edge 打开扩展管理页 edge://extensions，或在 Chrome 打开 chrome://extensions，启用“开发人员模式”。', 'Open edge://extensions in Edge or chrome://extensions in Chrome and enable Developer mode.')}</li><li>{t('选择“加载解压缩的扩展”，选中下方文件夹。', 'Choose Load unpacked and select this folder.')}{extensionPath && <code className="reading-collection-path" tabIndex={0}>{extensionPath}</code>}{setupBusy && <span role="status">{t('正在读取扩展位置…', 'Finding the extension folder…')}</span>}{setupError && <><span className="reading-collection-error" role="alert">{setupError}</span><button className="pw-text-button" onClick={() => void openSetup()}>{t('重试获取位置', 'Retry finding folder')}</button></>}</li><li>{t('在这个浏览器中登录 B 站并保持浏览器打开，回到书架点“一键读取”。扩展连接可能需要约 30 秒。', 'Sign in to Bilibili in that browser and keep it open, then return here and press Read now. The extension may take about 30 seconds to connect.')}</li></ol>
        <p>{t('扩展只读取 B 站历史页显示的内容并发送到本机小院；不读取 Cookie、密码或其他网站的浏览记录。', 'The extension reads content displayed on Bilibili history and sends it to this local DailyHouse. It does not read cookies, passwords or browsing history on other sites.')}</p>
        <p>{t('安装时，浏览器会请求 B 站与本机 127.0.0.1 的站点访问权限。', 'During installation, the browser requests site access to Bilibili and local 127.0.0.1.')}</p>
        <p>{t('规则与每日采集相同：近 7 天、播放进度明确低于 25%、有教育或实用意义。模糊内容留待确认，手动完成与移出记录保留。', 'The daily rules apply: last 7 days, known progress below 25%, and educational or practical content. Unclear items wait for review; your completed and removed items stay respected.')}</p>
      </div>}
    </section>}
  </>;
}
