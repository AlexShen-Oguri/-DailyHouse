import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Message, Close, Plus } from 'pixelarticons/react';
import { request, dateLabel } from './api';
import { usePreferences } from './Preferences';
import { Notice } from './shared';
import { converse, localModelName, type Bubble, type InspirationState } from './inspiration-model';
import { ToolDiscussion } from './DevelopmentTools';

export default function InspirationExplore({ bubble, ai, onChanged }: { bubble: Bubble; ai: InspirationState['ai']; onChanged: () => Promise<void> }) {
  const { t, language, locale } = usePreferences();
  const [discussionMode, setDiscussionMode] = useState<'tools' | 'local'>('tools');
  const modelName = localModelName(ai.model);
  const availabilityLabel = ai.configured ? t('已检测', 'Detected') : ai.availability === 'model_missing' ? t('未安装', 'Not installed') : ai.availability === 'invalid_config' ? t('配置有误', 'Invalid configuration') : ai.availability === 'check_failed' ? t('状态未知', 'Unverified') : t('未连接', 'Disconnected');
  const storageKey = `dailyhouse-brainstorm:${bubble.id}`;
  const [text, setText] = useState(() => { try { return sessionStorage.getItem(storageKey) || ''; } catch { return ''; } });
  const [active, setActive] = useState<string | null>(null);
  const [sources, setSources] = useState(bubble.sources.map(source => source.id));
  const [generating, setGenerating] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [feedback, setFeedback] = useState('');
  const [remove, setRemove] = useState<{ kind: 'conversation' | 'turn' | 'draft'; id: string } | null>(null);
  const confirmPanel = useRef<HTMLDivElement>(null); const controller = useRef<AbortController | null>(null); const mounted = useRef(true); const composer = useRef<HTMLTextAreaElement>(null);
  const conversations = [...(bubble.conversations ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const conversation = active === 'new' ? undefined : conversations.find(item => item.id === active) ?? conversations[0];
  const locked = generating || busy;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { try { text ? sessionStorage.setItem(storageKey, text) : sessionStorage.removeItem(storageKey); } catch { /* The visible composer still keeps the draft. */ } }, [text, storageKey]);
  useEffect(() => { if (remove) confirmPanel.current?.focus(); }, [remove]);
  async function send(event: FormEvent) {
    event.preventDefault(); if (locked || !text.trim() || !ai.configured) return;
    const abort = new AbortController(); controller.current = abort; setGenerating(true); setError(''); setFeedback('');
    try {
      const next = await converse(bubble.id, { message: text.trim(), ...(conversation ? { conversationId: conversation.id, expectedUpdatedAt: conversation.updatedAt } : { includeSourceIds: sources.filter(id => bubble.sources.some(source => source.id === id)) }), language, expectedRevision: bubble.revision }, abort.signal);
      if (!mounted.current || abort.signal.aborted) return;
      setText(''); setActive(next.id); await onChanged(); composer.current?.focus();
    } catch (err) {
      if (!mounted.current) return;
      if (abort.signal.aborted) setFeedback(t('这次思考已取消，你写的内容还在。', 'This reply was cancelled. Your message is still here.'));
      else setError(err instanceof TypeError ? t('本机模型没有响应。稍后重试，你写的内容还在。', 'The local model did not respond. Retry when ready; your message is kept.') : (err as Error).message);
    } finally { if (mounted.current) { setGenerating(false); controller.current = null; } }
  }
  async function confirmRemove() {
    if (locked || !remove) return;
    const suffix = remove.kind === 'draft' ? `/drafts/${remove.id}` : remove.kind === 'turn' ? `/conversations/${conversation?.id}/turns/${remove.id}` : `/conversations/${remove.id}`;
    setBusy(true); setError('');
    try { await request(`/inspiration/${encodeURIComponent(bubble.id)}${suffix}`, 'DELETE'); if (remove.kind === 'conversation') setActive('new'); setRemove(null); await onChanged(); setFeedback(t('已删除所选记录，原始灵感仍保留。', 'Selected conversation records deleted. The original idea is kept.')); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  const starters = bubble.sources.length ? [t('这些想法碰在一起，还能发生什么？先大胆发散，不急着定方案。', 'What could happen when these ideas meet? Explore freely before settling on a plan.'), t('找找它们之间不那么明显的联系。', 'Find the less obvious connections between them.')] : [t('陪我把这个念头往下想一想，先问我一个有意思的问题。', 'Help me think this through. Start with one interesting question.'), t('如果换一个完全不同的角度，会是什么样？', 'What might this look like from a completely different angle?')];
  return <section id="idea-explore" className="idea-explore idea-conversation" aria-labelledby="idea-explore-title">
    <div className="idea-section-title"><h2 id="idea-explore-title"><Message width={23}/>{t('接着想下去', 'Keep thinking together')}</h2>{discussionMode === 'local' && <span className={`idea-ai-presence ${ai.configured ? 'is-ready' : 'is-unavailable'}`} role="status" title={ai.message}><span aria-hidden="true"/>{modelName} · {t('本机', 'on this device')} · {availabilityLabel}</span>}</div>
    <div className="idea-discussion-mode" role="group" aria-label={t('讨论方式', 'Discussion method')}><button className={`pw-button${discussionMode === 'tools' ? ' primary' : ''}`} aria-pressed={discussionMode === 'tools'} disabled={locked} onClick={() => setDiscussionMode('tools')}>{t('Codex / Claude Code', 'Codex / Claude Code')}</button><button className={`pw-button${discussionMode === 'local' ? ' primary' : ''}`} aria-pressed={discussionMode === 'local'} disabled={locked} onClick={() => setDiscussionMode('local')}>{t('可选：本机模型与已存对话', 'Optional: local model & saved chats')}</button></div>
    {discussionMode === 'tools' ? <ToolDiscussion ideaId={bubble.id}/> : <>
    <p className="idea-help">{t('抛出一个问题、推翻一个方向，或者只是聊聊。想法可以一直生长。', 'Ask a question, challenge a direction, or simply talk it through. Give the idea room to grow.')}</p>
    {!ai.configured && <Notice>{ai.message || t('本机模型尚未就绪。', 'The local model is not ready.')} <button className="pw-text-button" disabled={locked} onClick={() => void onChanged()}>{t('重新检查', 'Check again')}</button></Notice>}
    {!!conversations.length && <div className="idea-conversation-nav"><label><span className="pw-sr-only">{t('选择对话', 'Choose conversation')}</span><select aria-label={t('选择对话', 'Choose conversation')} value={conversation?.id ?? 'new'} disabled={locked} onChange={event => { setActive(event.target.value); setRemove(null); }}><option value="new">{t('新的话题', 'A fresh conversation')}</option>{conversations.map(item => <option key={item.id} value={item.id}>{item.messages.find(message => message.role === 'user')?.content.slice(0, 45) || dateLabel(item.createdAt, locale)}</option>)}</select></label><button className="pw-text-button" disabled={locked} onClick={() => { setActive('new'); setRemove(null); composer.current?.focus(); }}><Plus width={17}/>{t('另开一个话题', 'Start another thread')}</button></div>}
    {conversation ? <div className="idea-chat-log" aria-label={t('灵感对话记录', 'Brainstorm conversation')}>
      {conversation.messages.map(message => <article key={message.id} className={`idea-chat-message is-${message.role}`}><header><strong>{message.role === 'user' ? t('我', 'You') : localModelName(conversation.model)}</strong><time dateTime={message.createdAt}>{dateLabel(message.createdAt, locale)}</time>{message.role === 'user' && <button className="pw-text-button" disabled={locked} aria-label={t('删除从这条消息开始的对话', 'Delete this turn and later replies')} onClick={() => setRemove({ kind: 'turn', id: message.id })}><Close width={15}/></button>}</header><div className="idea-chat-content">{message.content}</div></article>)}
      <button className="pw-text-button idea-danger" disabled={locked} onClick={() => setRemove({ kind: 'conversation', id: conversation.id })}>{t('删除这段对话', 'Delete this conversation')}</button>
    </div> : <div className="idea-conversation-starters"><p>{bubble.sources.length ? t('让这些灵感交叉生长', 'Let these ideas cross-pollinate') : t('从你现在好奇的地方开始', 'Start with what makes you curious')}</p>{starters.map((starter, index) => <button key={starter} className="pw-button" disabled={locked} onClick={() => { setText(starter); composer.current?.focus(); }}>{index === 0 ? t('一起打开思路', 'Explore the possibilities') : bubble.sources.length ? t('寻找意外的联系', 'Find unexpected connections') : t('换个角度试试', 'Try another perspective')}</button>)}</div>}
    <form className="idea-chat-compose" onSubmit={send}><label>{t(`对 ${modelName} 说点什么`, `Talk to ${modelName}`)}<textarea ref={composer} value={text} rows={4} maxLength={3000} disabled={locked} onChange={event => setText(event.target.value)} placeholder={t('我觉得这个方向挺有趣，不过能不能…', 'This direction is interesting, but what if…')}/></label>
      <details className="idea-chat-context"><summary>{t('这次对话会参考什么', 'What this conversation can see')}</summary><p>{t('当前灵感与时间线摘录、选中来源、最近几轮对话。完整记录仍保留，内容只交给本机模型。', 'Excerpts from this idea and its timeline, selected sources, and recent conversation turns. Full records are kept; context is sent only to the local model.')}</p>{bubble.sources.length > 0 && <fieldset disabled={locked || !!conversation}><legend>{t('融合来源', 'Combined ideas')}</legend>{bubble.sources.map(source => <label className="idea-check" key={source.id}><input type="checkbox" checked={(conversation?.sourceIds ?? sources).includes(source.id)} onChange={event => setSources(previous => event.target.checked ? [...previous, source.id] : previous.filter(id => id !== source.id))}/>{source.title}</label>)}</fieldset>}{conversation && <small>{t('另开话题时，可以重新选择参考来源。', 'Start another thread to choose different sources.')}</small>}</details>
      <div className="idea-actions"><button className="pw-button primary" disabled={locked || !text.trim() || !ai.configured}>{generating ? t(`${modelName} 正在思考…`, `${modelName} is thinking…`) : t('一起想一想', 'Think it through')}</button>{generating && <button type="button" className="pw-button" onClick={() => controller.current?.abort()}>{t('停止这次思考', 'Stop this reply')}</button>}<small>{t('对话会保存，随时可以回来继续。', 'Conversations are saved. Come back whenever you like.')}</small></div>
    </form>
    <div aria-live="polite">{error && <Notice error>{error}</Notice>}{feedback && <Notice>{feedback}</Notice>}</div>
    {remove && <div ref={confirmPanel} tabIndex={-1} className="idea-delete-confirm" role="group" aria-label={t('确认删除对话记录', 'Confirm conversation deletion')}><p>{remove.kind === 'turn' ? t('永久删除这条消息和它之后的回复。更早的对话与原始灵感保留。', 'Permanently delete this message and every later reply. Earlier messages and the original idea stay.') : remove.kind === 'draft' ? t('永久删除这份旧草稿。原始灵感和已有项目保留。', 'Permanently delete this old draft. The original idea and projects stay.') : t('永久删除这整段对话。原始灵感、时间线和项目保留。', 'Permanently delete this conversation. The original idea, timeline and projects stay.')} </p><div className="idea-actions"><button className="pw-button idea-danger-button" disabled={locked} onClick={() => void confirmRemove()}>{t('确认永久删除', 'Permanently delete')}</button><button className="pw-text-button" disabled={locked} onClick={() => setRemove(null)}>{t('取消', 'Cancel')}</button></div></div>}
    {!!bubble.drafts.length && <details className="idea-legacy-drafts"><summary>{t('以前保存的探索草稿', 'Previously saved exploration drafts')} ({bubble.drafts.length})</summary>{bubble.drafts.map(draft => <article key={draft.id}><h3>{dateLabel(draft.createdAt, locale)}</h3>{draft.directions.map((direction, index) => <details key={index}><summary>{direction.title}</summary><p>{direction.goal}</p>{[...direction.mvp, ...direction.assumptions, ...direction.risks, ...direction.acceptance, direction.firstStep].map((line, i) => <p key={i}>{line}</p>)}</details>)}<button className="pw-text-button idea-danger" disabled={locked} onClick={() => setRemove({ kind: 'draft', id: draft.id })}>{t('删除这份旧草稿', 'Delete this old draft')}</button></article>)}</details>}
    </>}
  </section>;
}
