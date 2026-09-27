import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Article, BookOpen, Close, Folder } from 'pixelarticons/react';
import { request } from './api';
import { usePreferences } from './Preferences';
import { Notice } from './shared';
import { categoryNames, typeNames, type ReadingCategory, type ReadingType } from './reading-model';
import { linkEntries, parseLinkFile, QUICK_FILE_ACCEPT, QUICK_MAX_ITEMS, type QuickEntry, type QuickPreview } from './quick-reading-model';
import '../styles/quick-reading.css';

type Method = 'links' | 'files' | 'manual';
export default function QuickReadingImport({ onClose, onImported, onBusy }: { onClose: () => void; onImported: (count: number) => Promise<void>; onBusy: (busy: boolean) => void }) {
  const { t } = usePreferences(); const [method, setMethod] = useState<Method>('links');
  const [links, setLinks] = useState(''); const [manual, setManual] = useState<QuickEntry>({ title: '', type: 'book', notes: '' });
  const [entries, setEntries] = useState<QuickEntry[]>([]); const [preview, setPreview] = useState<QuickPreview | null>(null);
  const [busy, setBusy] = useState(''); const [progress, setProgress] = useState(''); const [error, setError] = useState('');
  const uploads = useRef(new Set<string>()); const applying = useRef(false); const mounted = useRef(true); const input = useRef<HTMLInputElement>(null); const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { onBusy(!!busy); return () => onBusy(false); }, [busy, onBusy]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (!applying.current) for (const id of uploads.current) void request(`/reading/quick-import/uploads/${encodeURIComponent(id)}`, 'DELETE').catch(() => {}); }; }, []);
  async function discardUploads() { const ids = [...uploads.current]; uploads.current.clear(); await Promise.all(ids.map(id => request(`/reading/quick-import/uploads/${encodeURIComponent(id)}`, 'DELETE').catch(() => {}))); }
  async function inspect(next: QuickEntry[]) {
    if (!next.length || next.length > QUICK_MAX_ITEMS) throw new Error(t('每次请导入 1–30 项。', 'Import between 1 and 30 items at a time.'));
    const result = await request<QuickPreview>('/reading/quick-import/preview', 'POST', { items: next });
    if (!mounted.current) return;
    setEntries(result.candidates.map((candidate, index) => ({ ...next[index], title: candidate.title, type: candidate.type, url: candidate.url, notes: candidate.notes })));
    setPreview(result);
    window.setTimeout(() => heading.current?.focus(), 0);
    return result;
  }
  async function prepare(event?: FormEvent) {
    event?.preventDefault(); if (busy) return; setBusy('preview'); setError('');
    try { await inspect(method === 'manual' ? [manual] : linkEntries(links)); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(''); }
  }
  async function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]; if (!files.length || busy) return;
    setError(''); setPreview(null); setEntries([]); setBusy('upload');
    try {
      if (files.length > QUICK_MAX_ITEMS) throw new Error(t('每次最多选择 30 个文件。', 'Choose up to 30 files at a time.'));
      await discardUploads(); const next: QuickEntry[] = [];
      for (let index = 0; index < files.length; index++) {
        const file = files[index]; const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
        setProgress(t(`正在读取 ${index + 1}/${files.length}：${file.name}`, `Reading ${index + 1}/${files.length}: ${file.name}`));
        const parseLinks = ['url', 'webloc', 'json', 'csv'].includes(extension);
        const maxSize = ['pdf', 'epub'].includes(extension) ? 50 * 1024 * 1024 : 2 * 1024 * 1024;
        if (file.size > maxSize) throw new Error(t(`${file.name} 超过 ${maxSize / 1024 / 1024} MB。`, `${file.name} exceeds ${maxSize / 1024 / 1024} MB.`));
        if (parseLinks) {
          try { next.push(...parseLinkFile(file.name, await file.text())); }
          catch { throw new Error(t(`${file.name} 无法读取。链接文件需要有效网址；JSON / CSV 请按下方格式填写。`, `Could not read ${file.name}. Link files need valid URLs; see the JSON / CSV format below.`)); }
        } else if (['pdf', 'epub', 'md', 'txt'].includes(extension)) {
          const response = await fetch(`/api/personal/reading/quick-import/upload?filename=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Accept-Language': document.documentElement.lang === 'en' ? 'en' : 'zh-CN' }, body: file });
          const result = await response.json(); if (!response.ok) throw new Error(result.message || t('文件上传失败，请重试。', 'File upload failed. Please try again.'));
          if (!mounted.current) { await request(`/reading/quick-import/uploads/${encodeURIComponent(result.uploadId)}`, 'DELETE').catch(() => {}); return; }
          uploads.current.add(result.uploadId); next.push({ uploadId: result.uploadId, title: result.title, type: result.type });
        } else throw new Error(t(`不支持 .${extension} 文件。`, `.${extension} files are not supported.`));
        if (next.length > QUICK_MAX_ITEMS) throw new Error(t('这些文件合计超过 30 项，请拆成小批次。', 'These files contain more than 30 items. Split them into smaller batches.'));
      }
      setProgress(t('正在检查重复内容…', 'Checking for duplicates…')); await inspect(next);
    } catch (error) { setError((error as Error).message); await discardUploads(); if (input.current) input.current.value = ''; }
    finally { setBusy(''); setProgress(''); }
  }
  async function changeMethod(next: Method) { if (busy || method === next) return; await discardUploads(); setMethod(next); setEntries([]); setPreview(null); setError(''); }
  function edit(index: number, patch: Partial<QuickEntry>) { setEntries(previous => previous.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)); }
  async function commit() {
    if (busy || !preview || !preview.counts.accepted) return; setBusy('apply'); setError(''); applying.current = true;
    try {
      const eligible = new Set(preview.candidates.filter(item => item.decision === 'import').map(item => item.index));
      const chosen = entries.filter((_, index) => eligible.has(index));
      const result = await request<{ items: unknown[] }>('/reading/quick-import/apply', 'POST', { items: chosen });
      chosen.forEach(item => { if (item.uploadId) uploads.current.delete(item.uploadId); }); await discardUploads();
      if (mounted.current) await onImported(result.items.length);
    } catch (error) { setError((error as Error).message); }
    finally { applying.current = false; if (mounted.current) setBusy(''); else await discardUploads(); }
  }
  return <section className="quick-reading" aria-label={t('快捷导入', 'Quick import')}>
    <div className="pw-section-head"><h2>{t('把好奇收进书架', 'Make room for your next discovery')}</h2><button className="pw-icon-button" onClick={onClose} disabled={!!busy} aria-label={t('关闭快捷导入', 'Close quick import')}><Close width={19}/></button></div>
    <p className="quick-reading-intro">{t('粘贴链接、选择文件，或记下书名。内容自动分类，也可以自己修改。', 'Paste links, choose files, or note a book title. Categories are sorted automatically and remain editable.')}</p>
    <div className="quick-reading-methods" role="group" aria-label={t('导入方式', 'Import method')}><button onClick={() => void changeMethod('links')} aria-pressed={method === 'links'} disabled={!!busy}><Article width={17}/>{t('粘贴链接', 'Paste links')}</button><button onClick={() => void changeMethod('files')} aria-pressed={method === 'files'} disabled={!!busy}><Folder width={17}/>{t('选本机文件', 'Choose local files')}</button><button onClick={() => void changeMethod('manual')} aria-pressed={method === 'manual'} disabled={!!busy}><BookOpen width={17}/>{t('记一本书', 'Add a book')}</button></div>
    {error && <Notice error>{error}</Notice>}
    {method === 'files' ? <div className="quick-reading-upload"><label>{t('选择文件（可多选）', 'Select files (multiple allowed)')}<input ref={input} type="file" multiple accept={QUICK_FILE_ACCEPT} onChange={event => void chooseFiles(event)} disabled={!!busy}/></label><small>{t('PDF、EPUB 每份最多 50 MB；Markdown、TXT、URL、webloc、JSON、CSV 每份最多 2 MB。每批最多 30 项。', 'PDF / EPUB: up to 50 MB each. Markdown, TXT, URL, webloc, JSON / CSV: up to 2 MB each. Up to 30 items per batch.')}</small><details className="reading-import-help"><summary>{t('文件如何导入？', 'How are files imported?')}</summary><p>{t('文档保留一份本机副本，入架后可打开或下载；快捷方式与清单读取其中的网页链接。取消预览会丢弃临时副本，原文件始终保留。', 'Documents are copied locally so you can open or download them from the shelf. Shortcuts and lists supply web links. Cancelling removes staged copies; original files stay untouched.')}</p><p>{t('JSON：items 数组，每项包含 url，可选 title、type、notes、category。CSV：首行为 url,title,type,notes,category。类型使用 book、video、course、tutorial、github、article。', 'JSON: an items array with url and optional title, type, notes, category. CSV headers: url,title,type,notes,category. Types: book, video, course, tutorial, github, article.')}</p></details></div> : <form className="quick-reading-form" onSubmit={event => void prepare(event)}>
      {method === 'links' ? <label>{t('每行一个链接', 'One link per line')}<textarea rows={3} value={links} onChange={event => { setLinks(event.target.value); setPreview(null); }} placeholder={t('B站视频、文章、GitHub、网课或教程链接…', 'Bilibili videos, articles, GitHub, courses or tutorials…')} disabled={!!busy} maxLength={65536} required/></label> : <><div className="quick-reading-fields"><label>{t('书名', 'Book title')}<input value={manual.title ?? ''} onChange={event => { setManual({ ...manual, title: event.target.value }); setPreview(null); }} required maxLength={200} disabled={!!busy} placeholder={t('想读哪一本？', 'What would you like to read?')}/></label><label>{t('分类', 'Category')}<select value={manual.category ?? ''} onChange={event => { setManual({ ...manual, category: (event.target.value || undefined) as ReadingCategory | undefined }); setPreview(null); }} disabled={!!busy}><option value="">{t('自动分类', 'Sort automatically')}</option>{Object.entries(categoryNames).map(([key, names]) => <option key={key} value={key}>{t(...names)}</option>)}</select></label></div><label>{t('随手记（可选）', 'A note (optional)')}<textarea value={manual.notes ?? ''} onChange={event => { setManual({ ...manual, notes: event.target.value }); setPreview(null); }} rows={2} maxLength={4000} disabled={!!busy}/></label></>}
      {!preview && <div className="reading-import-actions"><button className="pw-button" disabled={!!busy || (method === 'links' ? !links.trim() : !manual.title?.trim())}>{busy === 'preview' ? t('检查中…', 'Checking…') : t('继续', 'Continue')}</button></div>}
    </form>}
    {busy && <p className="quick-reading-progress" role="status">{progress || (busy === 'apply' ? t('正在收进书架…', 'Saving to your shelf…') : t('正在准备预览…', 'Preparing your preview…'))}</p>}
    {preview && <section className="quick-reading-preview" aria-label={t('快捷导入预览', 'Quick import preview')}><h3 ref={heading} tabIndex={-1}>{t('准备收进书架', 'Ready for your shelf')}</h3><p>{t( `将收录 ${preview.counts.accepted} 项。已有或曾移出的内容会自动跳过。`, `${preview.counts.accepted} items will be saved. Previously saved or removed items are skipped automatically.`)}</p>
      <ul className="quick-reading-rows">{preview.candidates.map(candidate => { const entry = entries[candidate.index]; const eligible = candidate.decision === 'import'; return <li className={`quick-reading-row${eligible ? '' : ' is-skipped'}`} key={candidate.index}><div className="quick-reading-row-head"><strong>{candidate.attachment?.name || candidate.title}</strong><span>{candidate.decision === 'duplicate' ? t('已在书架', 'Already saved') : candidate.decision === 'suppressed' ? t('已移除', 'Previously removed') : t('待入架', 'Ready to save')}</span></div>
        {eligible ? <><div className="quick-reading-row-fields"><label>{t('标题', 'Title')}<input aria-label={t('标题：', 'Title: ') + (candidate.index + 1)} value={entry?.title ?? ''} onChange={event => edit(candidate.index, { title: event.target.value })} maxLength={200} disabled={!!busy}/></label><label>{t('类型', 'Type')}<select aria-label={t('类型：', 'Type: ') + (candidate.index + 1)} value={entry?.type ?? candidate.type} onChange={event => edit(candidate.index, { type: event.target.value as ReadingType })} disabled={!!busy}>{Object.entries(typeNames).map(([key, names]) => <option key={key} value={key}>{t(...names)}</option>)}</select></label><label>{t('分类', 'Category')}<select aria-label={t('分类：', 'Category: ') + (candidate.index + 1)} value={entry?.category ?? ''} onChange={event => edit(candidate.index, { category: (event.target.value || undefined) as ReadingCategory | undefined })} disabled={!!busy}><option value="">{t('自动分类', 'Sort automatically')}</option>{Object.entries(categoryNames).map(([key, names]) => <option key={key} value={key}>{t(...names)}</option>)}</select></label></div><details><summary>{t('随手记', 'Notes')}</summary><textarea aria-label={t('随手记：', 'Notes: ') + (candidate.index + 1)} value={entry?.notes ?? ''} onChange={event => edit(candidate.index, { notes: event.target.value })} disabled={!!busy} rows={2} maxLength={4000}/></details></> : <p>{candidate.reason} {candidate.decision === 'suppressed' && t('需要时请到回收站恢复。', 'Restore it from the recycle bin if needed.')}</p>}{candidate.url && <p>{candidate.url}</p>}</li>; })}</ul>
      <p className="pw-footnote">{t('标题、类型和分类都可以修改。未选择的分类会自动整理；入架后也能继续编辑。', 'You can edit titles, types and categories now or later. Categories you leave blank are sorted automatically.')}</p>
      <div className="reading-import-actions"><button className="pw-button primary" onClick={() => void commit()} disabled={!!busy || !preview.counts.accepted}>{t(`收进书架（${preview.counts.accepted}）`, `Save to shelf (${preview.counts.accepted})`)}</button><button className="pw-text-button" onClick={onClose} disabled={!!busy}>{t('取消本次导入', 'Cancel import')}</button></div>
    </section>}
  </section>;
}
