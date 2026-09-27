import { useId, useState } from 'react';
import { Folder } from 'pixelarticons/react';
import { usePreferences } from './Preferences';
import '../styles/quick-reading.css';

export default function LocalPathPicker({ kind, label, value, onChange, onError, onBusy, disabled, placeholder }: {
  kind: 'calendar' | 'vault' | 'readingTech' | 'readingAesthetic'; label: string; value: string;
  onChange: (value: string) => void; onError: (message: string) => void; onBusy?: (busy: boolean) => void; disabled?: boolean; placeholder?: string;
}) {
  const { t } = usePreferences(); const id = useId(); const [picking, setPicking] = useState(false);
  async function pick() {
    if (picking || disabled) return;
    setPicking(true); onBusy?.(true); onError('');
    try {
      const response = await fetch('/api/personal/local-picker', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Language': document.documentElement.lang === 'en' ? 'en' : 'zh-CN' }, body: JSON.stringify({ kind }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || t('无法打开选择窗口。你仍可填写路径。', 'Could not open the picker. You can still enter a path.'));
      if (!result.cancelled && typeof result.path === 'string') onChange(result.path);
    } catch (error) { onError(error instanceof Error ? error.message : t('无法打开选择窗口。', 'Could not open the picker.')); }
    finally { setPicking(false); onBusy?.(false); }
  }
  return <div className="local-path-field"><label htmlFor={id}>{label}</label><div className="local-path-controls"><input id={id} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} spellCheck={false} disabled={disabled || picking}/><button type="button" className="pw-button" onClick={() => void pick()} disabled={disabled || picking}><Folder width={16}/>{picking ? t('选择中…', 'Choosing…') : kind === 'calendar' ? t('选择文件', 'Choose file') : t('选择文件夹', 'Choose folder')}</button></div></div>;
}
