import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePreferences } from './Preferences';
import { clockText, duration, initialPomodoro, POMODORO_KEY, restorePomodoro, validMinutes, type PomodoroPhase, type PomodoroPreset, type PomodoroState } from './pomodoro-model';
import '../styles/pomodoro.css';

type Clock = { state: PomodoroState; remaining: number; change: (update: (old: PomodoroState) => PomodoroState) => void; prepareSound: () => void; storageFailed: boolean };
const Context = createContext<Clock | null>(null);

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(() => {
    try { return restorePomodoro(localStorage.getItem(POMODORO_KEY), Date.now()); }
    catch { return initialPomodoro(); }
  });
  const [now, setNow] = useState(Date.now);
  const [storageFailed, setStorageFailed] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const prepareSound = () => {
    if (!state.sound) return;
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume().catch(() => {});
    } catch { /* The visible completion message also works without audio. */ }
  };
  const change: Clock['change'] = update => { setNow(Date.now()); setState(update); };
  useEffect(() => {
    try { localStorage.setItem(POMODORO_KEY, JSON.stringify(state)); setStorageFailed(false); }
    catch { setStorageFailed(true); }
  }, [state]);
  useEffect(() => {
    if (state.deadline === null) return;
    let finished = false;
    const tick = () => {
      if (finished) return;
      const time = Date.now(); setNow(time);
      if (time < state.deadline!) return;
      finished = true;
      setState(old => old.deadline === state.deadline ? { ...old, remainingMs: 0, deadline: null } : old);
      if (state.sound && audio.current?.state === 'running') {
        const context = audio.current;
        const tone = context.createOscillator(); const volume = context.createGain();
        tone.type = 'sine'; tone.frequency.value = 660;
        volume.gain.setValueAtTime(0, context.currentTime);
        volume.gain.linearRampToValueAtTime(.08, context.currentTime + .025);
        volume.gain.exponentialRampToValueAtTime(.001, context.currentTime + .5);
        tone.connect(volume); volume.connect(context.destination);
        tone.start(); tone.stop(context.currentTime + .55);
        tone.onended = () => { tone.disconnect(); volume.disconnect(); };
      }
    };
    const timer = window.setInterval(tick, 250);
    const refresh = () => tick();
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [state.deadline, state.sound]);
  useEffect(() => () => { void audio.current?.close().catch(() => {}); }, []);
  const remaining = state.deadline === null ? state.remainingMs : Math.min(duration(state), Math.max(0, state.deadline - now));
  return <Context.Provider value={{ state, remaining, change, prepareSound, storageFailed }}>{children}</Context.Provider>;
}

export default function Pomodoro() {
  const clock = useContext(Context);
  if (!clock) throw new Error('Pomodoro needs its provider');
  const { state, remaining, change, prepareSound, storageFailed } = clock;
  const { t } = usePreferences();
  const [custom, setCustom] = useState(state.preset === 'custom');
  const [focus, setFocus] = useState(String(state.focusMinutes));
  const [rest, setRest] = useState(String(state.breakMinutes));
  const [error, setError] = useState('');
  const running = state.deadline !== null;
  const complete = remaining === 0 && !running;
  const phaseName = state.phase === 'focus' ? t('专注', 'Focus') : t('休息', 'Break');
  const setPhase = (phase: PomodoroPhase) => change(old => ({ ...old, phase, deadline: null, remainingMs: (phase === 'focus' ? old.focusMinutes : old.breakMinutes) * 60_000 }));
  const setPreset = (preset: PomodoroPreset) => {
    setError('');
    if (preset === 'custom') { setFocus(String(state.focusMinutes)); setRest(String(state.breakMinutes)); setCustom(true); return; }
    setCustom(false);
    const focusMinutes = preset === '25/5' ? 25 : 50; const breakMinutes = preset === '25/5' ? 5 : 10;
    change(old => ({ ...old, preset, focusMinutes, breakMinutes, deadline: null, remainingMs: (old.phase === 'focus' ? focusMinutes : breakMinutes) * 60_000 }));
  };
  const start = () => {
    prepareSound();
    change(old => ({ ...old, deadline: Date.now() + (old.remainingMs || duration(old)), remainingMs: old.remainingMs || duration(old) }));
  };
  const next = () => {
    prepareSound();
    change(old => {
      const phase = old.phase === 'focus' ? 'break' : 'focus';
      const remainingMs = (phase === 'focus' ? old.focusMinutes : old.breakMinutes) * 60_000;
      return { ...old, phase, remainingMs, deadline: Date.now() + remainingMs };
    });
  };
  return <section className="pomodoro" aria-labelledby="pomodoro-title">
    <header className="pomodoro-head"><h2 id="pomodoro-title">{t('小番茄钟', 'Pomodoro')}</h2><select aria-label={t('番茄钟时长', 'Pomodoro durations')} value={custom ? 'custom' : state.preset} disabled={running} onChange={e => setPreset(e.target.value as PomodoroPreset)}>
      <option value="25/5">{t('25 / 5 分钟', '25 / 5 min')}</option><option value="50/10">{t('50 / 10 分钟', '50 / 10 min')}</option><option value="custom">{t('自定义', 'Custom')}</option>
    </select></header>
    {custom && <form className="pomodoro-custom" onSubmit={e => {
      e.preventDefault(); const focusMinutes = Number(focus), breakMinutes = Number(rest);
      if (!validMinutes(focusMinutes) || !validMinutes(breakMinutes)) { setError(t('请填写 1–180 的整数分钟。', 'Enter whole minutes from 1 to 180.')); return; }
      setError(''); change(old => ({ ...old, preset: 'custom', focusMinutes, breakMinutes, deadline: null, remainingMs: (old.phase === 'focus' ? focusMinutes : breakMinutes) * 60_000 }));
    }} noValidate>
      <label>{t('专注（分钟）', 'Focus (min)')}<input type="number" min="1" max="180" step="1" value={focus} disabled={running} onChange={e => setFocus(e.target.value)}/></label>
      <label>{t('休息（分钟）', 'Break (min)')}<input type="number" min="1" max="180" step="1" value={rest} disabled={running} onChange={e => setRest(e.target.value)}/></label>
      <button className="pw-button" disabled={running} type="submit">{t('应用', 'Apply')}</button>
      {error && <p className="pomodoro-error" role="alert">{error}</p>}
    </form>}
    <div className="pomodoro-phases" aria-label={t('计时阶段', 'Timer phase')}>
      <button type="button" aria-pressed={state.phase === 'focus'} disabled={running} onClick={() => setPhase('focus')}>{t('专注', 'Focus')}</button>
      <button type="button" aria-pressed={state.phase === 'break'} disabled={running} onClick={() => setPhase('break')}>{t('休息', 'Break')}</button>
    </div>
    <div className="pomodoro-display"><span role="timer" aria-live="off" aria-label={`${phaseName}${t('剩余时间', ' time remaining')}`}>{clockText(remaining)}</span><p role="status">{complete ? state.phase === 'focus' ? t('这轮专注完成了，休息一下。', 'Focus complete. Take a break.') : t('休息结束，准备好再开始。', 'Break complete. Start when ready.') : running ? t('专心做眼前这一件事。', 'Stay with the task at hand.') : remaining < duration(state) ? t('已暂停，按自己的节奏继续。', 'Paused. Continue at your own pace.') : t(`${state.focusMinutes} 分钟专注 · ${state.breakMinutes} 分钟休息`, `${state.focusMinutes} min focus · ${state.breakMinutes} min break`)}</p></div>
    <div className="pomodoro-actions">
      {running ? <button className="pw-button primary" type="button" onClick={() => change(old => ({ ...old, remainingMs: Math.max(0, (old.deadline ?? Date.now()) - Date.now()), deadline: null }))}>{t('暂停', 'Pause')}</button>
        : <button className="pw-button primary" type="button" onClick={complete ? next : start}>{complete ? state.phase === 'focus' ? t('开始休息', 'Start break') : t('开始专注', 'Start focus') : remaining < duration(state) ? t('继续', 'Continue') : t('开始', 'Start')}</button>}
      <button className="pw-button" type="button" onClick={() => change(old => ({ ...old, deadline: null, remainingMs: duration(old) }))}>{t('重置', 'Reset')}</button>
    </div>
    <label className="pomodoro-sound"><input type="checkbox" checked={state.sound} onChange={e => change(old => ({ ...old, sound: e.target.checked }))}/>{t('结束时轻响', 'Completion sound')}</label>
    {storageFailed && <p role="alert" className="pomodoro-error">{t('浏览器无法保存计时，刷新会重置。', 'Timer cannot be saved in this browser. Reloading will reset it.')}</p>}
  </section>;
}
