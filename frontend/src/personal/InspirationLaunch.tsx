import { useEffect, useRef, useState, type FormEvent } from 'react';
import { request } from './api';
import { usePreferences } from './Preferences';
import { Notice } from './shared';
import type { Bubble } from './inspiration-model';

type RepositoryOperation = { id: string; kind?: 'repository'; status: 'running' | 'failed' | 'ready' | 'awaiting_manual_handoff'; repoUrl?: string; message?: string };
type RepositoryState = { operation: RepositoryOperation | null; removed?: boolean; defaults: { githubOwner: string; repositoryVisibility: string } };

export default function InspirationLaunch({ bubble }: { bubble: Bubble }) {
  const { t } = usePreferences();
  const [loadAttempt, setLoadAttempt] = useState(0); const [open, setOpen] = useState(false); const [repoName, setRepoName] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [state, setState] = useState<RepositoryState | null>(null); const [removeConfirm, setRemoveConfirm] = useState(false);
  const alive = useRef(true); const operation = state?.operation;
  useEffect(() => {
    alive.current = true; let disposed = false; setError('');
    void request<RepositoryState>(`/inspiration/${encodeURIComponent(bubble.id)}/launch`).then(result => { if (!disposed) setState(result); }).catch(err => { if (!disposed) setError((err as Error).message); });
    return () => { disposed = true; alive.current = false; };
  }, [bubble.id, loadAttempt]);
  useEffect(() => {
    if (operation?.status !== 'running') return;
    const timer = window.setInterval(() => {
      void request<{ operation: RepositoryOperation }>(`/project-launches/${encodeURIComponent(operation.id)}`).then(result => { if (alive.current) { setState(previous => previous && { ...previous, operation: result.operation }); setError(''); } }).catch(err => { if (alive.current) setError((err as Error).message); });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [operation?.id, operation?.status]);
  async function create(event: FormEvent) {
    event.preventDefault(); if (busy || !state) return; setBusy(true); setError('');
    try { const result = await request<{ operation: RepositoryOperation }>(`/inspiration/${encodeURIComponent(bubble.id)}/launch`, 'POST', { repoName: repoName.trim(), confirm: true }); if (alive.current) setState(previous => previous && { ...previous, operation: result.operation }); }
    catch (err) { if (alive.current) setError((err as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function retry() {
    if (!operation || busy) return; setBusy(true); setError('');
    try { const result = await request<{ operation: RepositoryOperation }>(`/project-launches/${encodeURIComponent(operation.id)}/retry`, 'POST', {}); if (alive.current) setState(previous => previous && { ...previous, operation: result.operation }); }
    catch (err) { if (alive.current) setError((err as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function removeRecord() {
    if (!operation || busy) return; setBusy(true); setError('');
    try { await request(`/project-launches/${encodeURIComponent(operation.id)}`, 'DELETE', { confirm: true }); if (alive.current) { setState(previous => previous && { ...previous, operation: null, removed: true }); setRemoveConfirm(false); } }
    catch (err) { if (alive.current) setError((err as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }
  const linked = Boolean(operation?.repoUrl && operation.status !== 'running');
  return <section className="idea-launch" aria-labelledby="idea-repository-title">
    <div><h2 id="idea-repository-title">{t('GitHub 私有仓库', 'Private GitHub repository')}</h2><p>{t('给这个想法创建一个空的私有仓库。', 'Create an empty private repository for this idea.')}</p></div>
    {error && <Notice error>{error}{!state && <button className="pw-text-button" onClick={() => setLoadAttempt(value => value + 1)}>{t('重试读取记录', 'Retry loading record')}</button>}</Notice>}
    {!state && !error && <p role="status">{t('正在读取仓库记录…', 'Loading repository record…')}</p>}
    {state?.removed && <Notice>{t('小院仓库记录已移除，外部资源仍保留。为避免重复创建，请从 GitHub 打开原仓库。', 'The DailyHouse repository record was removed. External resources remain; open the original repository in GitHub to avoid duplicate creation.')}</Notice>}
    {state && !operation && !state.removed && !open && <button className="pw-button" onClick={() => setOpen(true)}>{t('创建 GitHub 私有仓库', 'Create private GitHub repository')}</button>}
    {operation && <div className="idea-launch-progress" aria-live="polite">
      <strong>{linked ? operation.kind === 'repository' && operation.status === 'ready' ? t('私有仓库已创建', 'Private repository created') : t('已有 GitHub 仓库', 'Existing GitHub repository') : operation.status === 'running' ? t('正在创建私有仓库…', 'Creating private repository…') : t('仓库创建未完成', 'Repository creation unfinished')}</strong>
      {operation.status === 'failed' && !linked && <p>{operation.kind === 'repository' ? operation.message : t('旧立项流程已停用。重试只创建或核验 GitHub 私有仓库，已有外部资源保留。', 'The old project launch workflow has been retired. Retry only creates or verifies the private GitHub repository; existing external resources remain.')}</p>}
      <div className="idea-actions">
        {operation.repoUrl && <a className="pw-button primary" href={operation.repoUrl} target="_blank" rel="noreferrer">{t('打开 GitHub 仓库', 'Open GitHub repository')}</a>}
        {operation.status === 'failed' && !linked && <button className="pw-button" disabled={busy} onClick={() => void retry()}>{t('重试创建私有仓库', 'Retry private repository creation')}</button>}
        {operation.status !== 'running' && <button className="pw-text-button idea-danger" disabled={busy} onClick={() => setRemoveConfirm(true)}>{t('移除小院仓库记录', 'Remove DailyHouse repository record')}</button>}
      </div>
      {removeConfirm && <div className="idea-delete-confirm"><p>{t('永久移除小院中的仓库记录。GitHub 仓库、已有本机目录与 Codex 对话都保留；这个灵感不会再次自动创建仓库。', 'Permanently remove this DailyHouse repository record. The GitHub repository, existing local folders and Codex conversations remain. This idea will not create another repository automatically.')}</p><div className="idea-actions"><button className="pw-button" disabled={busy} onClick={() => void removeRecord()}>{t('确认仅移除小院记录', 'Remove only the DailyHouse record')}</button><button className="pw-text-button" disabled={busy} onClick={() => setRemoveConfirm(false)}>{t('取消', 'Cancel')}</button></div></div>}
    </div>}
    {state && !operation && !state.removed && open && <form onSubmit={create}>
      <fieldset className="idea-fields" disabled={busy}><label>{t('GitHub 仓库名', 'GitHub repository name')}<input autoFocus value={repoName} required maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" placeholder="my-flower-game" onChange={event => setRepoName(event.target.value)}/><small>{t('使用英文字母、数字、短横线或下划线。', 'Use letters, numbers, hyphens or underscores.')}</small></label></fieldset>
      <div className="idea-launch-scope"><p>{state.defaults?.githubOwner} · {t('私有仓库', 'Private repository')}</p><p>{t('确认后仅创建空的 GitHub 私有仓库，不上传灵感或历史对话，不创建本机目录或 Codex 项目。', 'Confirmation creates only an empty private GitHub repository. Ideas and conversation history are not uploaded; no local folder or Codex project is created.')}</p></div>
      <div className="idea-actions"><button className="pw-button primary" disabled={busy || !repoName.trim()}>{busy ? t('正在提交…', 'Submitting…') : t('确认创建私有仓库', 'Confirm private repository creation')}</button><button type="button" className="pw-text-button" disabled={busy} onClick={() => setOpen(false)}>{t('取消', 'Cancel')}</button></div>
    </form>}
  </section>;
}
