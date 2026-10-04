import { useId, useRef, useState, type FormEvent } from 'react';
import { usePreferences } from './Preferences';
import { Notice } from './shared';
import { ideaDate, ideaKindNames, type Idea } from './ideas-model';
import { buildIdeaPrompt, prepareIdeaPrompt } from './idea-prompt';
import '../styles/idea-prompt.css';

export default function IdeaPromptBuilder({ idea }: { idea: Idea }) {
  const { language, locale, t } = usePreferences();
  const id = useId();
  const [initialIdea, setInitialIdea] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [generated, setGenerated] = useState<{ text: string; signature: string } | null>(null);
  const [feedback, setFeedback] = useState('');
  const [copying, setCopying] = useState(false);
  const output = useRef<HTMLTextAreaElement>(null);
  const generateButton = useRef<HTMLButtonElement>(null);
  const prepared = prepareIdeaPrompt(idea, selectedIds, initialIdea, language);
  const stale = !!generated && generated.signature !== prepared.signature;
  const entries = [...idea.entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const canGenerate = !prepared.error;

  function generate(event: FormEvent) {
    event.preventDefault();
    if (prepared.error || !prepared.json || !prepared.signature) return;
    setGenerated({ text: buildIdeaPrompt(prepared.json, language), signature: prepared.signature });
    setFeedback('');
    window.setTimeout(() => output.current?.focus(), 0);
  }
  async function copy() {
    if (!generated || stale || copying) return;
    setCopying(true); setFeedback('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(generated.text);
      setFeedback(t('已复制，可以粘贴给你使用的 AI。', 'Copied. Paste it into your preferred AI tool.'));
    } catch {
      output.current?.focus(); output.current?.select();
      setFeedback(t('无法自动复制，已选中 Prompt；请按 ⌘C 或 Ctrl+C 复制。', 'Automatic copy is unavailable. The prompt is selected; press ⌘C or Ctrl+C.'));
    } finally { setCopying(false); }
  }
  return <details className="idea-prompt">
    <summary>{t('生成探索 Prompt', 'Create exploration prompt')}</summary>
    <div className="idea-prompt-body">
      <p className="idea-prompt-help" id={`${id}-scope`}>{t('先写初始想法，再选择时间线片段。仅包含当前标题、这次填写的初始想法和勾选的已保存记录，在本页生成并预览；复制后由你决定发给哪个 AI。', 'Write your initial idea, then select timeline entries. Only the current title, your initial idea, and checked saved entries are included. Generate and preview here; you choose where to paste it.')}</p>
      <ol className="idea-prompt-steps"><li>{t('确认初始想法', 'Confirm the initial idea')}</li><li>grill-me {t('逐轮探索', 'interview')}</li><li>{t('调研同类与细分机会', 'Research alternatives & specialization')}</li></ol>
      <form onSubmit={generate} aria-describedby={`${id}-scope`}>
        <label>{t('这次的初始想法', 'Initial idea for this session')}<textarea rows={3} value={initialIdea} maxLength={4000} required onChange={event => { setInitialIdea(event.target.value); setFeedback(''); }} placeholder={t('我想为谁做什么，解决什么问题？目前的边界是什么？', 'What do I want to build, for whom, and why? What are the boundaries?')}/></label>
        <fieldset className="idea-prompt-selection"><legend>{t('选择时间线记录', 'Choose timeline entries')}</legend>
          <p className="idea-prompt-help">{t(`已选 ${selectedIds.filter(value => idea.entries.some(entry => entry.id === value)).length} 条 · 按时间顺序带入完整内容`, `${selectedIds.filter(value => idea.entries.some(entry => entry.id === value)).length} selected · Full content in chronological order`)}</p>
          <div className="idea-prompt-options">{entries.map((entry, index) => <div className="idea-prompt-option" key={entry.id}>
            <label><input type="checkbox" checked={selectedIds.includes(entry.id)} aria-label={t(`选择时间线记录 ${index + 1}：${ideaKindNames[entry.kind][0]}`, `Select timeline entry ${index + 1}: ${ideaKindNames[entry.kind][1]}`)} onChange={event => { setSelectedIds(event.target.checked ? [...selectedIds, entry.id] : selectedIds.filter(value => value !== entry.id)); setFeedback(''); }}/><span><span className="idea-prompt-entry-head">{t(...ideaKindNames[entry.kind])}<time dateTime={entry.createdAt}>{ideaDate(entry.createdAt, locale)}</time></span><span className="idea-prompt-entry-text">{entry.content.length > 240 ? `${entry.content.slice(0, 240)}…` : entry.content}</span></span></label>
            {entry.content.length > 240 && <details className="idea-prompt-full"><summary>{t('查看完整内容', 'View full content')}</summary><p>{entry.content}</p></details>}
          </div>)}</div>
          {selectedIds.some(value => !idea.entries.some(entry => entry.id === value)) && <button type="button" className="pw-text-button" onClick={() => { setSelectedIds(selectedIds.filter(value => idea.entries.some(entry => entry.id === value))); setFeedback(''); }}>{t('移除已删除记录的选择', 'Remove deleted entries from selection')}</button>}
        </fieldset>
        {prepared.error && initialIdea.trim() && selectedIds.length > 0 && <Notice error>{prepared.error}</Notice>}
        <div className="idea-actions"><button ref={generateButton} className="pw-button primary" disabled={!canGenerate || copying}>{generated ? t('重新生成 Prompt', 'Regenerate prompt') : t('生成 Prompt', 'Generate prompt')}</button><small>{t('填写初始想法并至少勾选一条记录。', 'Write an initial idea and select at least one entry.')}</small></div>
      </form>
      {generated && <div className="idea-prompt-preview">
        {stale && <Notice error>{t('初始想法、选择范围或所选记录已变化，请重新生成后再复制。', 'The idea, selection, or selected entries changed. Regenerate before copying.')}</Notice>}
        <label>{t('Prompt 预览', 'Prompt preview')}<textarea ref={output} value={generated.text} readOnly rows={15}/></label>
        <div className="idea-actions"><button className="pw-button" disabled={stale || copying} onClick={() => void copy()}>{copying ? t('复制中…', 'Copying…') : t('复制 Prompt', 'Copy prompt')}</button><button className="pw-text-button" disabled={copying} onClick={() => { setGenerated(null); setFeedback(''); generateButton.current?.focus(); }}>{t('清除预览', 'Clear preview')}</button></div>
        <p className="idea-prompt-help">{t('预览仅留在本页，刷新或离开后清除。清除预览保留输入、选择和原时间线，可随时重新生成。', 'The preview lasts only on this page and is cleared on refresh or navigation. Clearing it keeps your input, selection, and timeline so you can regenerate.')}</p>
      </div>}
      {feedback && !stale && <Notice>{feedback}</Notice>}
    </div>
  </details>;
}
