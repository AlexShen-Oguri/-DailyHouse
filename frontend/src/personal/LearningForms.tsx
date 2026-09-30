import { useState, type FormEvent } from 'react';
import { usePreferences } from './Preferences';
import type { LearningEntry, LearningKind, LearningLink, LearningPlan, LearningStatus } from './learning-model';

export function RevisionNotice({ current, saved, accept }: { current: number; saved: number; accept: () => void }) {
  const { t } = usePreferences();
  return current !== saved ? <div className="pw-notice" role="status"><p>{t('计划有新更新。你的草稿仍在，请核对页面内容后再保存。', 'The plan has new updates. Your draft is kept; review the page before saving.')}</p><button type="button" className="pw-text-button" onClick={accept}>{t('已核对，保留草稿使用最新版本', 'Reviewed; save this draft with the latest version')}</button></div> : null;
}

export function LearningPlanForm({ plan, busy, onSave, onCancel }: { plan?: LearningPlan; busy: boolean; onSave: (body: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const { t } = usePreferences();
  const [title, setTitle] = useState(plan?.title ?? ''), [course, setCourse] = useState(plan?.course ?? ''), [goal, setGoal] = useState(plan?.goal ?? ''), [nextStep, setNextStep] = useState(plan?.nextStep ?? ''), [dueDate, setDueDate] = useState(plan?.dueDate ?? ''), [status, setStatus] = useState<LearningStatus>(plan?.status ?? 'active');
  const [revision, setRevision] = useState(plan?.revision ?? 0);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || !title.trim() || (plan && revision !== plan.revision)) return;
    await onSave({ title, course, goal, nextStep, dueDate: dueDate || null, ...(plan ? { status, revision } : {}) });
  }
  return <form className="learning-plan-form" onSubmit={submit}>
    <fieldset disabled={busy}><div className="learning-form-grid">
      <label>{t('计划名称', 'Plan name')}<input autoFocus required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder={t('例如：完成本学期的数据结构课程', 'For example: finish this semester’s data structures course')}/></label>
      <label>{t('课程 / 方向（可选）', 'Course / area (optional)')}<input maxLength={200} value={course} onChange={e => setCourse(e.target.value)} placeholder={t('课程编号，或机器学习等自学方向', 'Course code or a self-study area')}/></label>
      <label className="learning-wide">{t('学习目标', 'Learning goal')}<textarea rows={3} maxLength={4000} value={goal} onChange={e => setGoal(e.target.value)} placeholder={t('学到什么程度，或完成什么成果？', 'What do you want to understand or produce?')}/></label>
      <label className="learning-wide">{t('下一步', 'Next step')}<input maxLength={200} value={nextStep} onChange={e => setNextStep(e.target.value)} placeholder={t('写下一件可以具体开始的小事', 'One concrete step you can start')}/></label>
      <label>{t('目标日期（可选）', 'Target date (optional)')}<input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}/></label>
      {plan && <label>{t('计划状态', 'Plan status')}<select value={status} onChange={e => setStatus(e.target.value as LearningStatus)}><option value="active">{t('进行中', 'Active')}</option><option value="paused">{t('暂缓', 'Paused')}</option><option value="done">{t('已完成', 'Completed')}</option></select></label>}
    </div></fieldset>
    {plan && <RevisionNotice current={plan.revision} saved={revision} accept={() => setRevision(plan.revision)}/>}
    <div className="idea-actions"><button className="pw-button primary" disabled={busy || !title.trim() || Boolean(plan && revision !== plan.revision)}>{busy ? t('保存中…', 'Saving…') : plan ? t('保存计划', 'Save plan') : t('创建并打开计划', 'Create & open plan')}</button><button type="button" className="pw-text-button" disabled={busy} onClick={onCancel}>{t('取消', 'Cancel')}</button></div>
  </form>;
}

export function LearningEntryForm({ plan, entry, busy, onSave, onCancel }: { plan: LearningPlan; entry?: LearningEntry; busy: boolean; onSave: (body: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const { t } = usePreferences();
  const [kind, setKind] = useState<LearningKind>(entry?.kind ?? 'progress'), [content, setContent] = useState(entry?.content ?? ''), [nextStep, setNextStep] = useState(entry?.nextStep ?? ''), [links, setLinks] = useState<LearningLink[]>(() => structuredClone(entry?.links ?? []));
  const [url, setUrl] = useState(''), [linkTitle, setLinkTitle] = useState(''), [error, setError] = useState(''), [removeLink, setRemoveLink] = useState(''), [revision, setRevision] = useState(plan.revision);
  const persisted = new Set(entry?.links.map(item => item.id) ?? []);
  function addLink() {
    try {
      const parsed = new URL(url.trim());
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
      if (links.length >= 20) { setError(t('每条记录最多 20 个链接。', 'Each entry can hold up to 20 links.')); return; }
      if (links.some(item => item.url === parsed.href)) { setError(t('这条记录已有相同链接。', 'This entry already has that link.')); return; }
      setLinks(old => [...old, { id: crypto.randomUUID(), url: parsed.href, title: linkTitle.trim() || parsed.hostname }]); setUrl(''); setLinkTitle(''); setError('');
    } catch { setError(t('请粘贴完整的 HTTP 或 HTTPS 链接。', 'Paste a complete HTTP or HTTPS link.')); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || revision !== plan.revision) return;
    if (url.trim()) { setError(t('还有未添加的链接，请先点“添加链接”。', 'There is an unadded link. Select “Add link” first.')); return; }
    if (!content.trim() && !links.length) { setError(t('请写下记录或添加链接。', 'Write an entry or add a link.')); return; }
    setError(''); await onSave({ revision, kind, content, nextStep, links });
  }
  return <form className="learning-entry-form" onSubmit={submit}>
    <fieldset disabled={busy}><label className="idea-kind-field">{t('记录类型', 'Entry type')}<select value={kind} onChange={e => setKind(e.target.value as LearningKind)}>{entry?.kind === 'initial' && <option value="initial">{t('学习起点', 'Starting point')}</option>}<option value="progress">{t('进展', 'Progress')}</option><option value="question">{t('疑问', 'Question')}</option><option value="milestone">{t('阶段成果', 'Milestone')}</option><option value="resource">{t('资料', 'Resource')}</option></select></label>
      <label>{t('这次的记录', 'This update')}<textarea autoFocus rows={5} maxLength={20000} value={content} onChange={e => setContent(e.target.value)} placeholder={t('学到了什么、卡在哪里，或记下一项资料…', 'What did you learn, where are you stuck, or what resource did you find?')}/></label>
      <div className="learning-link-editor"><label>{t('资料链接', 'Resource link')}<input type="url" maxLength={2048} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…"/></label><label>{t('链接名称（可选）', 'Link name (optional)')}<input maxLength={200} value={linkTitle} onChange={e => setLinkTitle(e.target.value)} placeholder={t('例如：课程讲义、论文、视频', 'For example: lecture notes, paper, video')}/></label><button type="button" className="pw-button" onClick={addLink} disabled={!url.trim()}>{t('添加链接', 'Add link')}</button></div>
      {!!links.length && <ul className="learning-link-drafts">{links.map(item => <li key={item.id}><span><strong>{item.title}</strong><small>{item.url}</small></span><button type="button" className="pw-text-button learning-danger" aria-label={`${t('移除链接', 'Remove link')}: ${item.title}`} onClick={() => persisted.has(item.id) ? setRemoveLink(item.id) : setLinks(old => old.filter(link => link.id !== item.id))}>{t('移除', 'Remove')}</button></li>)}</ul>}
      {removeLink && <div className="idea-delete-confirm" role="alert"><p>{t('保存后移除此链接关联。原网页、论文与其他链接会保留。', 'Saving will remove this link reference. The original page, paper and other links are kept.')}</p><div className="idea-actions"><button type="button" className="pw-button" onClick={() => { setLinks(old => old.filter(item => item.id !== removeLink)); setRemoveLink(''); }}>{t('确认移除链接', 'Confirm remove link')}</button><button type="button" className="pw-text-button" onClick={() => setRemoveLink('')}>{t('保留链接', 'Keep link')}</button></div></div>}
      <label>{t('下一步（可加入今日待办）', 'Next step (can become a task)')}<input maxLength={200} value={nextStep} onChange={e => setNextStep(e.target.value)}/></label>
    </fieldset>
    {error && <p className="learning-error" role="alert">{error}</p>}
    <RevisionNotice current={plan.revision} saved={revision} accept={() => setRevision(plan.revision)}/>
    <div className="idea-actions"><button className="pw-button primary" disabled={busy || !!removeLink || revision !== plan.revision}>{busy ? t('保存中…', 'Saving…') : entry ? t('保存记录', 'Save entry') : t('加入时间线', 'Add to timeline')}</button><button type="button" className="pw-text-button" disabled={busy} onClick={onCancel}>{t('取消', 'Cancel')}</button></div>
  </form>;
}
