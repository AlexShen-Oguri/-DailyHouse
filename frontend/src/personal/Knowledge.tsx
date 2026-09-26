import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Search } from 'pixelarticons/react';
import { GardenLife } from '../components/GardenLife';
import { request, type Note } from './api';
import { useWorkspace } from './Workspace';
import { Empty, Notice, PageHead } from './shared';
import { resolveWikiLink } from './wiki';

function MarkdownPreview({ content, path, openNote, notes }: { content: string; path: string; openNote: (path: string) => void; notes: Note[] }) {
  const blocks: ReactNode[] = []; let code: string[] | null = null;
  const inline = (line: string) => line.split(/(\[\[[^\]]+\]\])/g).map((part, i) => { if (!part.startsWith('[[')) return part; const [target, alias] = part.slice(2, -2).split('|'); const note = resolveWikiLink(path, target, notes); return note ? <button className="pw-wikilink" key={i} onClick={() => openNote(note.path)}>{alias || target}</button> : <span key={i} title="笔记未找到或存在同名笔记，请在 Obsidian 中打开">{alias || target}</span>; });
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
  const { data, refresh } = useWorkspace(); const [query, setQuery] = useState(''); const [selected, setSelected] = useState<{ path: string; title: string; content: string } | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const generation = useRef(0);
  const notes = useMemo(() => (data?.vault.notes || []).filter(n => `${n.title} ${n.path}`.toLowerCase().includes(query.toLowerCase())), [data?.vault.notes, query]);
  async function openNote(path: string) { const current = ++generation.current; setBusy(true); setError(''); try { const note = await request<{ path: string; title: string; content: string }>(`/obsidian/note?path=${encodeURIComponent(path)}`); if (current === generation.current) setSelected(note); } catch (err) { if (current === generation.current) setError((err as Error).message); } finally { if (current === generation.current) setBusy(false); } }
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { setSelected(null); setQuery(''); generation.current++; setBusy(false); }, [data?.settings.vaultPath]);
  if (!data) return null;
  return <div className="pw-page"><PageHead title="知识书屋" description="你的 Obsidian 笔记，在小院里也能翻阅。"><Link className="pw-button" to="/settings">设置仓库</Link></PageHead>
    {data.vault.status !== 'ready' ? <section className="pw-paper pw-vault-empty"><span className="pw-library-icon"><BookOpen width={48} height={48}/></span><h2>给你的知识，留一扇门。</h2><p>{data.vault.message || '连接已有的 Obsidian 仓库，即可浏览和搜索 Markdown 笔记。'}</p><Link className="pw-button primary" to="/settings">连接 Obsidian 仓库 <ArrowRight width={18}/></Link><small>保留你的目录结构、笔记正文与双链。编辑仍在 Obsidian 中完成。</small><GardenLife variant="planter"/></section> :
    <div className="pw-library"><aside className="pw-booklist"><div className="pw-section-head"><h2>{data.vault.name}</h2><button className="pw-text-button" onClick={() => void refresh()}>刷新</button></div><label className="pw-search"><Search width={19}/><input aria-label="搜索笔记" placeholder="搜索标题或路径" value={query} onChange={e => setQuery(e.target.value)}/></label><p className="pw-subtle">{notes.length} 篇笔记</p><ul>{notes.map(note => <li key={note.path}><button className={selected?.path === note.path ? 'active' : ''} onClick={() => void openNote(note.path)}><BookOpen width={19}/><span><strong>{note.title}</strong><small>{note.path}</small></span></button></li>)}</ul>{notes.length === 0 && <p className="pw-footnote">没有找到匹配的笔记。</p>}</aside><article className="pw-note-reader" aria-busy={busy}>{error && <Notice error>{error}</Notice>}{busy && <p role="status">正在翻开笔记…</p>}{selected ? <><div className="pw-section-head"><h2>{selected.title}</h2><a className="pw-button small" href={`obsidian://open?vault=${encodeURIComponent(data.vault.name)}&file=${encodeURIComponent(selected.path)}`}>在 Obsidian 打开</a></div><p className="pw-subtle">{selected.path}</p><MarkdownPreview content={selected.content} path={selected.path} openNote={path => void openNote(path)} notes={data.vault.notes}/></> : <Empty title="选一本，慢慢读"><p>从左侧挑一篇笔记。</p></Empty>}</article></div>}
  </div>;
}
