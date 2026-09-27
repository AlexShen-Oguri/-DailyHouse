import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Close, Download, Play } from 'pixelarticons/react';
import { request } from './api';
import { usePreferences } from './Preferences';
import '../styles/reading-collection.css';

export type CollectionRun = {
  id: string;
  status: 'queued' | 'reading' | 'importing' | 'completed' | 'partial' | 'needs_login' | 'failed' | 'cancelled';
  createdAt: string; updatedAt: string; scanned: number;
  coverage?: { from: string; to: string; complete: boolean };
  result?: { added: number; skipped: number; itemIds: string[] };
  issue?: string; conversationUrl?: string; threadId?: string;
};
type CollectionState = { bridge: { connected: boolean; lastSeenAt?: string }; run: CollectionRun | null; history?: CollectionRun[] };
type Translate = (zh: string, en: string) => string;
export const isCollectionActive = (run: CollectionRun | null) => !!run && ['queued', 'reading', 'importing'].includes(run.status);
export function collectionSummary(run: CollectionRun, t: Translate) {
  if (run.status === 'completed' || run.status === 'partial') {
    const added = run.result?.added ?? 0;
    return added ? t(`新增 ${added} 项，已放入书架。`, `${added} new items saved to your shelf.`) : t('这次没有需要新增的内容。', 'Nothing new to add this time.');
  }
  return {
    queued: t('正在打开 B 站历史…', 'Opening Bilibili history…'),
    reading: t('正在读取近一周的历史…', 'Reading the last week of history…'),
    importing: t('Codex 正在挑选内容、整理分类…', 'Codex is choosing useful items and sorting them…'),
    needs_login: t('请先登录 B 站，再重新读取。', 'Sign in to Bilibili, then try again.'),
    failed: t('这次读取没有完成。', 'This reading did not finish.'),
    cancelled: t('已停止读取。', 'Reading stopped.'),
  }[run.status];
}
export function collectionIssue(run: CollectionRun, t: Translate) {
  if (run.status === 'partial') return t('只读取了部分历史，已找到的内容正常入架。可以再读一次补齐。', 'Only part of your history was read. The items found were saved. Read again to continue.');
  if (!run.issue || run.status === 'needs_login') return '';
  return {
    page_unavailable: t('B 站历史页暂时打不开，请检查网络后重试。', 'Bilibili history could not open. Check your connection and try again.'),
    unsupported_page: t('暂时无法读懂 B 站历史页，请稍后重试。', 'The Bilibili history page could not be read. Please try again later.'),
    bridge_disconnected: t('请打开安装了小院扩展的浏览器，再试一次。', 'Open the browser with the DailyHouse extension, then try again.'),
    timeout: t('读取花费的时间过长，请保持历史页可见，再试一次。', 'Reading took too long. Keep the history page visible and try again.'),
    server_restarted: t('小院重启中断了读取，可以重新开始。', 'DailyHouse restarted during reading. You can start again.'),
    codex_unavailable: t('暂时无法连接 Codex，请打开 Codex 后重试。', 'Codex is unavailable. Open Codex and try again.'),
    codex_failed: t('Codex 未完成整理，请检查 Codex 登录后重试。已有书架内容保留。', 'Codex did not finish sorting. Check your Codex sign-in and try again; your existing shelf is kept.'),
    import_failed: t('内容尚未保存完成，请重试。已有书架内容保留。', 'The new items could not be saved. Try again; your existing shelf is kept.'),
  }[run.issue] ?? t('读取中断，请再试一次。已有书架内容保留。', 'Reading was interrupted. Try again; your existing shelf is kept.');
}
export function collectionConversation(run: CollectionRun) {
  return run.conversationUrl?.startsWith('codex://threads/') ? run.conversationUrl : undefined;
}

export default function ReadingCollection({ onChanged, onHistory, children, startRequest = 0 }: { startRequest?: number; onChanged: () => Promise<void>; onHistory: () => void; children?: ReactNode }) {
  const { t } = usePreferences();
  const [state, setState] = useState<CollectionState | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState(''); const [setupOpen, setSetupOpen] = useState(false);
  const [extensionPath, setExtensionPath] = useState(''); const [setupBusy, setSetupBusy] = useState(false); const [setupError, setSetupError] = useState('');
  const version = useRef(0); const mounted = useRef(true); const refreshed = useRef(new Set<string>());
  const trigger = useRef<HTMLButtonElement>(null); const setupHeading = useRef<HTMLHeadingElement>(null);
  const run = state?.run ?? null; const active = isCollectionActive(run);
  const accept = useCallback((next: CollectionState) => {
    setState(next);
    const completed = next.run;
    if (completed?.result && !isCollectionActive(completed) && !refreshed.current.has(completed.id)) {
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
    let pending = false;
    const poll = () => { if (document.hidden || pending) return; pending = true; void refreshStatus().catch(() => {}).finally(() => { pending = false; }); };
    const timer = window.setInterval(poll, active ? 2000 : 15000);
    window.addEventListener('focus', poll); document.addEventListener('visibilitychange', poll);
    return () => { clearInterval(timer); window.removeEventListener('focus', poll); document.removeEventListener('visibilitychange', poll); };
  }, [active, busy, refreshStatus]);
  useEffect(() => { if (setupOpen) setupHeading.current?.focus(); }, [setupOpen]);
  async function openSetup() {
    setSetupOpen(true);
    if (extensionPath || setupBusy) return;
    setSetupBusy(true); setSetupError('');
    try { const info = await request<{ extensionPath: string }>('/reading/collection/setup'); if (mounted.current) setExtensionPath(info.extensionPath); }
    catch (err) { if (mounted.current) setSetupError((err as Error).message); }
    finally { if (mounted.current) setSetupBusy(false); }
  }
  async function start() {
    if (busy || active) return;
    setBusy(true); setError('');
    try {
      const latest = await refreshStatus();
      if (!latest.bridge.connected) { await openSetup(); return; }
      if (isCollectionActive(latest.run)) return;
      version.current++;
      const next = await request<CollectionRun>('/reading/collection', 'POST', {});
      if (mounted.current) { accept({ ...latest, run: next }); setSetupOpen(false); }
    } catch (err) { if (mounted.current) setError((err as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function cancel() {
    if (!run || busy) return;
    setBusy(true); setError(''); version.current++;
    try { const next = await request<CollectionRun>(`/reading/collection/${encodeURIComponent(run.id)}/cancel`, 'POST', {}); if (mounted.current) accept({ ...state!, run: next }); }
    catch (err) { if (mounted.current) setError((err as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  }
  const lastStartRequest = useRef(startRequest);
  useEffect(() => { if (lastStartRequest.current !== startRequest) { lastStartRequest.current = startRequest; void start(); } }, [startRequest]);
  const conversation = run ? collectionConversation(run) : undefined;
  const issue = run ? collectionIssue(run, t) : '';
  const showPanel = setupOpen || !!run || !!error || !!connectionError;
  return <>
    <div className="reading-head-actions">
      <button ref={trigger} type="button" className="pw-button reading-collect-button" aria-label={t('一键读取 B 站历史', 'Read Bilibili history now')} aria-controls="reading-collection-panel" aria-expanded={showPanel} disabled={busy || active} onClick={() => void start()}>
        <Download width={25} aria-hidden="true"/><span><strong>{active ? t('正在读取…', 'Reading…') : busy ? t('连接中…', 'Connecting…') : t('一键读取', 'Read now')}</strong><small>{t('Codex 整理 · B 站近 7 天', 'Codex sorts · Bilibili, last 7 days')}</small></span>
      </button>
      {children}
      <button type="button" className="pw-text-button reading-collection-help" onClick={() => void openSetup()}>{t('浏览器连接', 'Browser connection')}</button>
    </div>
    {showPanel && <section id="reading-collection-panel" className="reading-collection-panel" aria-label={t('本次读取', 'Current reading')}>
      {(error || connectionError) && <p className="reading-collection-error" role="alert">{error || connectionError}</p>}
      {run && <>
        <div className="reading-collection-heading"><h2 role="status">{run.status === 'completed' ? <Check width={19} aria-hidden="true"/> : <Play width={18} aria-hidden="true"/>}{collectionSummary(run, t)}</h2>
          {active ? <button className="pw-text-button" disabled={busy} onClick={() => void cancel()}>{t('停止读取', 'Stop reading')}</button> : <button className="pw-text-button" onClick={onHistory}>{t('最近读取', 'Recent readings')}</button>}
        </div>
        {(run.status === 'queued' || run.status === 'reading') && <p>{t('请保持自动打开的 B 站历史页可见。读取后，Codex 会在独立对话中自动整理入架。', 'Keep the Bilibili history tab visible. Codex will then sort and save useful items in a separate conversation.')}</p>}
        {run.status === 'importing' && <p>{t('按现有分类自动入架，完成后会显示在下方书架。', 'Items are being filed into your existing categories and will appear on the shelf below.')}</p>}
        {issue && <p>{issue}</p>}
        {(conversation || ['needs_login', 'failed', 'partial'].includes(run.status)) && <div className="reading-collection-actions">
          {conversation && <a className="pw-text-button" href={conversation}>{t('打开 Codex 采集对话', 'Open collection in Codex')}</a>}
          {['needs_login', 'failed', 'partial'].includes(run.status) && <button className="pw-text-button" disabled={busy} onClick={() => void start()}>{t('重新读取', 'Read again')}</button>}
          {run.status === 'needs_login' && <a className="pw-text-button" href="https://www.bilibili.com/history" target="_blank" rel="noreferrer">{t('打开 B 站登录', 'Open Bilibili to sign in')}</a>}
        </div>}
      </>}
      {setupOpen && <div className="reading-collection-setup">
        <div className="reading-collection-heading"><h2 ref={setupHeading} tabIndex={-1}>{state?.bridge.connected ? t('浏览器已连接', 'Browser connected') : t('先连接你的浏览器', 'Connect your browser first')}</h2><button className="pw-icon-button" aria-label={t('关闭浏览器连接', 'Close browser connection')} onClick={() => { setSetupOpen(false); trigger.current?.focus(); }}><Close width={18}/></button></div>
        <p>{state?.bridge.connected ? t('可随时点击“一键读取”。请保持 B 站登录，读取时让历史页留在前台。', 'Read whenever you like. Stay signed in to Bilibili and keep the history tab visible while reading.') : t('请打开安装了小院扩展的 Edge 或 Chrome。当前没有开始读取。', 'Open Edge or Chrome with the DailyHouse extension. No reading has started yet.')}</p>
        <details><summary>{t('首次安装或重新连接', 'Install or reconnect')}</summary>
          <ol><li>{t('在 Edge 打开 edge://extensions，或在 Chrome 打开 chrome://extensions，启用“开发人员模式”。', 'Open edge://extensions in Edge or chrome://extensions in Chrome and enable Developer mode.')}</li><li>{t('选择“加载解压缩的扩展”，选择下方文件夹。', 'Choose Load unpacked and select this folder.')}{extensionPath && <code className="reading-collection-path" tabIndex={0}>{extensionPath}</code>}{setupBusy && <span role="status">{t('正在读取位置…', 'Finding the folder…')}</span>}{setupError && <><span className="reading-collection-error" role="alert">{setupError}</span><button className="pw-text-button" onClick={() => void openSetup()}>{t('重试', 'Retry')}</button></>}</li><li>{t('登录 B 站，等待约 30 秒后回到书架点击“一键读取”。', 'Sign in to Bilibili, wait about 30 seconds, then return to the shelf and press Read now.')}</li></ol>
          <p>{t('扩展仅提供历史页显示的内容，由 Codex 整理到本机书架。它不读取 Cookie、密码或其他网站历史。', 'The extension supplies what the history page displays; Codex sorts it into your local shelf. It does not read cookies, passwords or other sites’ history.')}</p>
        </details>
      </div>}
    </section>}
  </>;
}
