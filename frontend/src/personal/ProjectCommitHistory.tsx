import { useEffect, useRef, useState } from 'react';
import { ArrowRight, GitCommit } from 'pixelarticons/react';
import { request } from './api';
import { usePreferences } from './Preferences';
import { Notice } from './shared';
import '../styles/project-history.css';

type Commit = { hash: string; shortHash: string; subject: string; message: string; author: { name: string; email: string }; authoredAt: string; committedAt: string; parents: string[]; refs: string[]; url?: string };
type HistoryPage = { status: 'ready' | 'empty' | 'not_repository' | 'missing' | 'error'; message?: string; items: Commit[]; refs: { name: string; label: string; kind: 'branch' | 'remote' | 'tag'; hash: string }[]; selectedRef: string; shallow: boolean; snapshotAt: string | null; nextCursor: string | null; total?: number };
export default function ProjectCommitHistory({ projectId, projectTitle }: { projectId: string; projectTitle: string }) {
  const { t, language, locale } = usePreferences(); const [open, setOpen] = useState(false); const [page, setPage] = useState<HistoryPage | null>(null); const [selection, setSelection] = useState('all'); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const generation = useRef(0); const pending = useRef(false); const more = useRef<HTMLButtonElement>(null);
  useEffect(() => () => { generation.current++; }, [projectId]);
  async function load(ref = selection, append = false) {
    if (pending.current) return; pending.current = true; setLoading(true); setError(''); const run = ++generation.current;
    const query = new URLSearchParams({ limit: '30', ...(append && page?.nextCursor ? { cursor: page.nextCursor } : { ref }) });
    try {
      const next = await request<HistoryPage>(`/project-resume/${encodeURIComponent(projectId)}/history?${query}`);
      if (run !== generation.current) return;
      if (next.status === 'error') { setError(next.message || t('暂时无法读取提交历史，请重试。', 'Commit history could not be read. Please retry.')); return; }
      setPage(previous => append && previous ? { ...next, items: [...previous.items, ...next.items.filter(item => !previous.items.some(old => old.hash === item.hash))] } : next);
      setSelection(next.selectedRef || ref);
    } catch (err) { if (run === generation.current) setError((err as Error).message); }
    finally { if (run === generation.current) { pending.current = false; setLoading(false); } }
  }
  const fullDate = (date: string) => { const value = new Date(date); return Number.isNaN(value.getTime()) ? date : value.toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const statusMessage = page?.status === 'empty' ? t('这个仓库还没有提交。第一次提交后再刷新。', 'This repository has no commits yet. Refresh after its first commit.') : page?.status === 'missing' ? t('本机工作目录暂时不可用，恢复目录后重新读取。', 'The workspace is unavailable. Restore its location, then refresh.') : page?.status === 'not_repository' ? t('这个工作目录还不是 Git 仓库。', 'This workspace is not a Git repository yet.') : '';
  return <section className="project-history"><button className="pw-text-button project-history-toggle" aria-expanded={open} aria-controls={`history-${projectId}`} onClick={() => { const next = !open; setOpen(next); if (next && !page && !loading) void load(); }}><GitCommit width={19}/>{t('查看完整提交历史', 'View full commit history')}<span aria-hidden="true">{open ? '−' : '+'}</span></button>
    {open && <div id={`history-${projectId}`} className="project-history-panel" aria-label={t(`${projectTitle} 的提交历史`, `Commit history for ${projectTitle}`)}>
      <div className="project-history-controls"><label><span>{t('历史范围', 'History scope')}</span><select aria-label={t('选择提交历史范围', 'Choose commit history scope')} value={selection} disabled={loading} onChange={event => { const value = event.target.value; void load(value); }}><option value="all">{t('本机全部分支与标签', 'All branches & tags on this device')}</option><option value="HEAD">{t('当前 HEAD', 'Current HEAD')}</option>{page?.refs.map(ref => <option key={ref.name} value={ref.name}>{ref.kind === 'tag' ? t('标签', 'Tag') : ref.kind === 'remote' ? t('远端缓存', 'Remote tracking') : t('分支', 'Branch')} · {ref.label}</option>)}</select></label><button className="pw-text-button" disabled={loading} onClick={() => void load(selection)}>{t('刷新历史', 'Refresh history')}</button></div>
      <p className="project-history-scope">{page?.shallow ? t('这是浅克隆，仅展示本机已下载的历史。', 'This is a shallow clone. Only history downloaded on this device is available.') : t('读取本机 Git 历史，不自动拉取远端。', 'Reading local Git history; no remote fetch is performed.')}{page?.snapshotAt && <> {t('快照时间：', 'Snapshot: ')}<time dateTime={page.snapshotAt}>{fullDate(page.snapshotAt)}</time></>}</p>
      {error && <Notice error>{error} <button className="pw-text-button" disabled={loading} onClick={() => void load(selection)}>{t('重新读取历史', 'Reload history')}</button></Notice>}
      {statusMessage && <p className="project-history-empty">{statusMessage}</p>}
      {page?.items.length ? <><p className="project-history-count">{typeof page.total === 'number' ? t(`已显示 ${page.items.length} / ${page.total} 条提交`, `Showing ${page.items.length} of ${page.total} commits`) : t(`已显示 ${page.items.length} 条提交`, `Showing ${page.items.length} commits`)}</p><ol className="project-commits">{page.items.map(commit => <li key={commit.hash}><details><summary><span className="project-commit-subject">{commit.subject || t('无提交标题', 'Untitled commit')}</span><span className="project-commit-meta"><code>{commit.shortHash}</code><span>{commit.author.name}</span><time dateTime={commit.committedAt}>{fullDate(commit.committedAt)}</time></span></summary>{commit.refs.length > 0 && <div className="project-commit-refs">{commit.refs.map(ref => <span key={ref}>{ref}</span>)}</div>}<pre className="project-commit-message">{commit.message}</pre><dl className="project-commit-facts"><dt>{t('完整哈希', 'Full hash')}</dt><dd><code>{commit.hash}</code></dd><dt>{t('作者', 'Author')}</dt><dd>{commit.author.name}{commit.author.email && <> &lt;{commit.author.email}&gt;</>}</dd><dt>{t('创作时间', 'Authored')}</dt><dd><time dateTime={commit.authoredAt}>{fullDate(commit.authoredAt)}</time></dd><dt>{t('提交时间', 'Committed')}</dt><dd><time dateTime={commit.committedAt}>{fullDate(commit.committedAt)}</time></dd>{commit.parents.length > 0 && <><dt>{t('父提交', 'Parents')}</dt><dd>{commit.parents.map(parent => <code key={parent}>{parent}</code>)}</dd></>}</dl>{commit.url && <a className="pw-text-button" href={commit.url} target="_blank" rel="noreferrer">{t('在 GitHub 查看此提交', 'View this commit on GitHub')}<ArrowRight width={15}/></a>}</details></li>)}</ol></> : null}
      {loading && <p className="project-history-loading" role="status">{t('正在读取提交历史…', 'Reading commit history…')}</p>}
      {page?.nextCursor && <button ref={more} className="pw-button small" disabled={loading} onClick={() => void load(selection, true)}>{loading ? t('读取中…', 'Loading…') : t('加载更多提交', 'Load more commits')}</button>}{page?.status === 'ready' && !page.nextCursor && !!page.items.length && <p className="project-history-end">{language === 'en' ? 'You have reached the end of this local snapshot.' : '已显示此本机快照中的全部提交。'}</p>}
    </div>}
  </section>;
}
