import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Search } from 'pixelarticons/react';
import { GardenLife } from '../components/GardenLife';
import { request, type Note } from './api';
import { useWorkspace } from './Workspace';
import { usePreferences } from './Preferences';
import { Empty, Notice, PageHead } from './shared';
import { resolveWikiLink } from './wiki';

function MarkdownPreview({ content, path, openNote, notes }: { content: string; path: string; openNote: (path: string) => void; notes: Note[] }) {
  const { t } = usePreferences();
  const blocks: ReactNode[] = []; let code: string[] | null = null;
  const inline = (line: string) => line.split(/(\[\[[^\]]+\]\])/g).map((part, i) => { if (!part.startsWith('[[')) return part; const [target, alias] = part.slice(2, -2).split('|'); const note = resolveWikiLink(path, target, notes); return note ? <button className="pw-wikilink" key={i} onClick={() => openNote(note.path)}>{alias || target}</button> : <span key={i} title={t('笔记未找到或存在同名笔记，请在 Obsidian 中打开', 'Note missing or name ambiguous. Open it in Obsidian.')}>{alias || target}</span>; });
  for (const [index, line] of content.split('\n').entries()) {
    if (line.startsWith('```')) { if (code) { blocks.push(<pre key={index}><code>{code.join('\n')}</code></pre>); code = null; } else code = []; continue; }
    if (code) { code.push(line); continue; } if (!line.trim()) continue;
    if (line.startsWith('# ')) blocks.push(<h2 key={index}>{inline(line.slice(2))}</h2>);
    else if (/^#{2,6} /.test(line)) blocks.push(<h3 key={index}>{inline(line.replace(/^#{2,6} /, ''))}</h3>);
    else if (/^[-*] /.test(line)) blocks.push(<p className="pw-md-list" key={index}>{inline(line.slice(2))}</p>);
    else if (line.startsWith('> ')) blocks.push(<blockquote key={index}>{inline(line.slice(2))}</blockquote>);
    else blocks.push(<p key={index}>{inline(line)}</p>);
  }
  if (code) blocks.push(<pre key="last-code"><code>{code.join('\n')}</code></pre>);
  return <div className="pw-markdown">{blocks}</div>;
}
export default function KnowledgePage() {
  const { t } = usePreferences();
  const { data, refresh } = useWorkspace(); const [query, setQuery] = useState(''); const [selected, setSelected] = useState<{ path: string; title: string; content: string } | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const generation = useRef(0);
  const notes = useMemo(() => (data?.vault.notes || []).filter(n => `${n.title} ${n.path}`.toLowerCase().includes(query.toLowerCase())), [data?.vault.notes, query]);
  async function openNote(path: string) { const current = ++generation.current; setBusy(true); setError(''); try { const note = await request<{ path: string; title: string; content: string }>(`/obsidian/note?path=${encodeURIComponent(path)}`); if (current === generation.current) setSelected(note); } catch (err) { if (current === generation.current) setError(err instanceof Error ? err.message : t('未能打开笔记，请重试。', 'Could not open the note. Please try again.')); } finally { if (current === generation.current) setBusy(false); } }
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { setSelected(null); setQuery(''); generation.current++; setBusy(false); }, [data?.settings.vaultPath]);
  if (!data) return null;
  return <div className="pw-page"><PageHead title={t('知识书屋', 'Knowledge library')} description={t('你的 Obsidian 笔记，在小院里也能翻阅。', 'Browse your Obsidian notes from the garden.')}><Link className="pw-button" to="/settings">{t('设置仓库', 'Vault settings')}</Link></PageHead>
    {data.vault.status !== 'ready' ? <section className="pw-paper pw-vault-empty"><span className="pw-library-icon"><BookOpen width={48} height={48}/></span><h2>{t('给你的知识，留一扇门。', 'A doorway to what you know.')}</h2><p>{data.vault.message || t('连接已有的 Obsidian 仓库，即可浏览和搜索 Markdown 笔记。', 'Connect an existing Obsidian vault to browse and search your Markdown notes.')}</p><Link className="pw-button primary" to="/settings">{t('连接 Obsidian 仓库', 'Connect Obsidian vault')} <ArrowRight width={18}/></Link><small>{t('保留你的目录结构、笔记正文与双链。编辑仍在 Obsidian 中完成。', 'Your folders, notes and wiki links stay in place. Edit your notes in Obsidian.')}</small><GardenLife variant="planter"/></section> :
    <div className="pw-library"><aside className="pw-booklist"><div className="pw-section-head"><h2>{data.vault.name}</h2><button className="pw-text-button" onClick={() => void refresh()}>{t('刷新', 'Refresh')}</button></div><label className="pw-search"><Search width={19}/><input aria-label={t('搜索笔记', 'Search notes')} placeholder={t('搜索标题或路径', 'Search titles or paths')} value={query} onChange={e => setQuery(e.target.value)}/></label><p className="pw-subtle">{t(`${notes.length} 篇笔记`, `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`)}</p><ul>{notes.map(note => <li key={note.path}><button className={selected?.path === note.path ? 'active' : ''} onClick={() => void openNote(note.path)}><BookOpen width={19}/><span><strong>{note.title}</strong><small>{note.path}</small></span></button></li>)}</ul>{notes.length === 0 && <p className="pw-footnote">{t('没有找到匹配的笔记。', 'No matching notes found.')}</p>}</aside><article className="pw-note-reader" aria-busy={busy}>{error && <Notice error>{error}</Notice>}{busy && <p role="status">{t('正在翻开笔记…', 'Opening note…')}</p>}{selected ? <><div className="pw-section-head"><h2>{selected.title}</h2><a className="pw-button small" href={`obsidian://open?vault=${encodeURIComponent(data.vault.name)}&file=${encodeURIComponent(selected.path)}`}>{t('在 Obsidian 打开', 'Open in Obsidian')}</a></div><p className="pw-subtle">{selected.path}</p><MarkdownPreview content={selected.content} path={selected.path} openNote={path => void openNote(path)} notes={data.vault.notes}/></> : <Empty title={t('选一本，慢慢读', 'Pick a note and settle in')}><p>{t('从左侧挑一篇笔记。', 'Choose a note from the list.')}</p></Empty>}</article></div>}
  </div>;
}
