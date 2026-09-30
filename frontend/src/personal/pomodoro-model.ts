export const POMODORO_KEY = 'dailyhouse-pomodoro';
export type PomodoroPhase = 'focus' | 'break';
export type PomodoroPreset = '25/5' | '50/10' | 'custom';
export type PomodoroState = {
  version: 1;
  preset: PomodoroPreset;
  focusMinutes: number;
  breakMinutes: number;
  phase: PomodoroPhase;
  remainingMs: number;
  deadline: number | null;
  sound: boolean;
  harvestMinutes: number | null;
};

export function duration(state: PomodoroState) {
  return (state.phase === 'focus' ? state.focusMinutes : state.breakMinutes) * 60_000;
}

export function initialPomodoro(): PomodoroState {
  return { version: 1, preset: '25/5', focusMinutes: 25, breakMinutes: 5, phase: 'focus', remainingMs: 25 * 60_000, deadline: null, sound: true, harvestMinutes: null };
}

export function validMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 180;
}

export function restorePomodoro(raw: string | null, now: number): PomodoroState {
  if (!raw) return initialPomodoro();
  try {
    const state = JSON.parse(raw) as PomodoroState;
    const harvestMinutes = state.harvestMinutes ?? null;
    if (state.version !== 1 || !['25/5', '50/10', 'custom'].includes(state.preset)
      || !validMinutes(state.focusMinutes) || !validMinutes(state.breakMinutes)
      || !['focus', 'break'].includes(state.phase) || typeof state.sound !== 'boolean'
      || !Number.isFinite(state.remainingMs) || state.remainingMs < 0 || state.remainingMs > duration(state)
      || (state.deadline !== null && (!Number.isFinite(state.deadline) || state.deadline < 0))
      || (state.preset === '25/5' && (state.focusMinutes !== 25 || state.breakMinutes !== 5))
      || (state.preset === '50/10' && (state.focusMinutes !== 50 || state.breakMinutes !== 10))
      || (harvestMinutes !== null && !validMinutes(harvestMinutes))) return initialPomodoro();
    if (state.deadline !== null) {
      const left = Math.min(duration(state), Math.max(0, state.deadline - now));
      return { ...state, remainingMs: left, deadline: left ? now + left : null, harvestMinutes: !left && state.phase === 'focus' ? state.focusMinutes : harvestMinutes };
    }
    return { ...state, harvestMinutes: !state.remainingMs && state.phase === 'focus' ? state.focusMinutes : harvestMinutes };
  } catch { return initialPomodoro(); }
}

export function clockText(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export const tomatoVariant = (minutes: number): 'small' | 'large' | 'gold' => minutes <= 30 ? 'small' : minutes <= 60 ? 'large' : 'gold';
export function tomatoFrame(progress: number, minutes: number) {
  const stage = progress >= 1 ? 4 : progress >= .65 ? 3 : progress >= .38 ? 2 : progress >= .12 ? 1 : 0;
  const variant = tomatoVariant(minutes);
  return { stage, variant, column: stage < 3 ? stage : ['small', 'large', 'gold'].indexOf(variant), row: stage < 3 ? 0 : stage - 2 };
}
