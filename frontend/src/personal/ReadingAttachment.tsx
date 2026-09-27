import { useEffect, useId, useRef, useState } from 'react';
import { usePreferences } from './Preferences';
import type { ReadingItem } from './reading-model';

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export function isTextAttachment(attachment: ReadingItem['attachment']) {
  return !!attachment && ['md', 'txt'].includes(attachment.extension.replace(/^\./, '').toLowerCase());
}

export default function ReadingAttachment({ attachment }: { attachment: NonNullable<ReadingItem['attachment']> }) {
  const { t } = usePreferences(); const id = useId(); const [open, setOpen] = useState(false);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { setOpen(false); setText(''); setError(''); return () => { controller.current?.abort(); controller.current = null; }; }, [attachment.url]);
  function close() { controller.current?.abort(); controller.current = null; setOpen(false); setBusy(false); setText(''); setError(''); }
  async function load() {
    controller.current?.abort(); const current = new AbortController(); controller.current = current;
    setOpen(true); setBusy(true); setError(''); setText('');
    try {
      const response = await fetch(attachment.url, { signal: current.signal, headers: { 'Accept': 'text/plain', 'Accept-Language': document.documentElement.lang === 'en' ? 'en' : 'zh-CN' } });
      if (!response.ok) throw new Error(t('无法读取这份文件，请重试。', 'Could not read this file. Please try again.'));
      const tooLarge = () => new Error(t('文件超过 2 MB，无法在此预览，请使用下载文件。', 'This file exceeds 2 MB. Download it instead of previewing it here.'));
      if (Number(response.headers.get('Content-Length')) > MAX_TEXT_BYTES) throw tooLarge();
      const bytes = await response.arrayBuffer(); if (bytes.byteLength > MAX_TEXT_BYTES) throw tooLarge();
      if (controller.current === current && !current.signal.aborted) setText(new TextDecoder().decode(bytes));
    } catch (error) {
      if (controller.current === current && !current.signal.aborted) setError(error instanceof Error ? error.message : t('读取失败，请重试。', 'Could not read the file. Please retry.'));
    } finally { if (controller.current === current && !current.signal.aborted) setBusy(false); }
  }
  return <><button className="pw-text-button" aria-expanded={open} aria-controls={id} onClick={() => open ? close() : void load()}>{open ? t('关闭预览', 'Close preview') : t('打开文件', 'Open file')}</button>{open && <section id={id} className="reading-attachment-preview" aria-label={t('文件预览：', 'File preview: ') + attachment.name} aria-busy={busy}>
    <p className="reading-attachment-name">{attachment.name}</p>
    {busy ? <p role="status">{t('正在读取文件…', 'Loading your file…')}</p> : error ? <><p role="alert">{error}</p><button className="pw-text-button" onClick={() => void load()}>{t('重试预览', 'Retry preview')}</button></> : text ? <pre tabIndex={0}>{text}</pre> : <p>{t('这份文件没有文字内容。', 'This file is empty.')}</p>}
  </section>}</>;
}
