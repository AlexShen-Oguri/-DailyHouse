import { useEffect, useId, useRef } from 'react';
import { usePreferences } from './Preferences';
import { lines } from './inspiration-model';
export type ProjectPlan = { title: string; goal: string; mvp: string[]; acceptance: string[]; nextStep: string };
export function PlanListField({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }) {
  const { t } = usePreferences(); const input = useRef<HTMLTextAreaElement>(null); const id = useId();
  const meaningful = lines(value.join('\n')); const invalid = meaningful.length > 12 || meaningful.some(line => line.length > 500);
  const hint = t('最多 12 项，每项不超过 500 字。', 'Up to 12 items, at most 500 characters each.');
  useEffect(() => { input.current?.setCustomValidity(invalid ? hint : ''); }, [invalid, hint]);
  return <label>{label}<textarea ref={input} value={value.join('\n')} rows={3} maxLength={6012} aria-invalid={invalid || undefined} aria-describedby={invalid ? id : undefined} onChange={e => onChange(e.target.value.split('\n'))} onBlur={() => onChange(lines(value.join('\n')))}/>{invalid && <small id={id} className="idea-danger">{hint}</small>}</label>;
}
export default function ProjectFields({ value, onChange, disabled = false, goalLimit = 2000 }: { value: ProjectPlan; onChange: (value: ProjectPlan) => void; disabled?: boolean; goalLimit?: number }) {
  const { t } = usePreferences();
  return <fieldset className="idea-fields" disabled={disabled}>
    <label>{t('项目标题', 'Project title')}<input value={value.title} maxLength={120} required onChange={e => onChange({ ...value, title: e.target.value })}/></label>
    <label>{t('一句话目标', 'One-sentence goal')}<textarea value={value.goal} rows={2} maxLength={goalLimit} required onChange={e => onChange({ ...value, goal: e.target.value })}/></label>
    <PlanListField label={t('MVP 范围（每行一项）', 'MVP scope (one item per line)')} value={value.mvp} onChange={mvp => onChange({ ...value, mvp })}/>
    <PlanListField label={t('验收标准（每行一项）', 'Acceptance criteria (one per line)')} value={value.acceptance} onChange={acceptance => onChange({ ...value, acceptance })}/>
    <label>{t('下一步', 'Next step')}<input value={value.nextStep} maxLength={200} required onChange={e => onChange({ ...value, nextStep: e.target.value })}/></label>
  </fieldset>;
}
