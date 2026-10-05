import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Pomodoro, { PomodoroProvider } from './Pomodoro';
import { initialPomodoro, POMODORO_KEY, restorePomodoro, tomatoVariant } from './pomodoro-model';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T14:00:00Z')); localStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function render(show = true) { await act(async () => root.render(<PomodoroProvider>{show ? <Pomodoro/> : <p>Another page</p>}</PomodoroProvider>)); }
function timer() { return host.querySelector('[role="timer"]')!.textContent; }
async function click(label: string) { const button = [...host.querySelectorAll('button')].find(x => x.textContent === label)!; expect(button).toBeTruthy(); await act(async () => button.click()); }
async function preset(value: string) { const select = host.querySelector('select')!; await act(async () => { select.value = value; select.dispatchEvent(new Event('change', {bubbles:true})); }); }
async function input(index: number, value: string) { const field = host.querySelectorAll<HTMLInputElement>('input[type="number"]')[index]; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', {bubbles:true})); }); }

describe('homepage pomodoro', () => {
  it('uses the requested fruit size boundaries and accepts legacy timers', () => {
    expect([1, 30, 31, 60, 61, 180].map(tomatoVariant)).toEqual(['small', 'small', 'large', 'large', 'gold', 'gold']);
    const { harvestMinutes: _oldField, ...legacy } = initialPomodoro();
    expect(restorePomodoro(JSON.stringify(legacy), Date.now()).harvestMinutes).toBeNull();
  });
  it('grows through leaves, flowers and fruit; pause freezes growth and reset returns to a seedling', async () => {
    await render(); await preset('custom'); await input(0, '1'); await click('应用'); await click('开始');
    const stage = () => host.querySelector('.tomato-growth')!.getAttribute('data-stage');
    expect(stage()).toBe('0'); await act(async () => vi.advanceTimersByTime(10_000)); expect(stage()).toBe('1');
    await act(async () => vi.advanceTimersByTime(15_000)); expect(stage()).toBe('2');
    await click('暂停'); await act(async () => vi.advanceTimersByTime(60_000)); expect(stage()).toBe('2'); expect(host.querySelector('.is-growing')).toBeNull();
    await click('继续'); await act(async () => vi.advanceTimersByTime(15_000)); expect(stage()).toBe('3');
    await act(async () => vi.advanceTimersByTime(20_000)); expect(stage()).toBe('4');
    await click('开始休息'); expect(stage()).toBe('4'); expect(host.textContent).toContain('收成留在这里');
    await click('暂停'); await click('专注'); expect(stage()).toBe('0');
    await click('开始'); await act(async () => vi.advanceTimersByTime(30_000)); await click('重置'); expect(stage()).toBe('0');
  });
  it('keeps a completed metallic gold harvest across reload and a break', async () => {
    localStorage.setItem(POMODORO_KEY, JSON.stringify({ ...initialPomodoro(), preset: 'custom', focusMinutes: 61, deadline: Date.now() - 1000 }));
    await render(); expect(host.querySelector('.tomato-growth')?.getAttribute('data-fruit')).toBe('gold'); expect(host.querySelector('.tomato-growth')?.getAttribute('data-stage')).toBe('4');
    await click('开始休息'); await click('暂停');
    expect(JSON.parse(localStorage.getItem(POMODORO_KEY)!).harvestMinutes).toBe(61);
    await act(async () => root.unmount()); root = createRoot(host); await render();
    expect(host.querySelector('.tomato-growth')?.getAttribute('data-fruit')).toBe('gold'); expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('金色大番茄');
    await click('专注'); expect(host.querySelector('.tomato-growth')?.getAttribute('data-stage')).toBe('0');
  });
  it('counts actual wall-clock time after throttling and keeps pause/continue exact', async () => {
    await render(); await click('开始');
    vi.setSystemTime(new Date('2026-09-29T14:07:00Z')); await act(async () => vi.advanceTimersByTime(250));
    expect(timer()).toBe('18:00'); await click('暂停');
    await act(async () => vi.advanceTimersByTime(60_000)); expect(timer()).toBe('18:00');
    await click('继续'); await act(async () => vi.advanceTimersByTime(30_000)); expect(timer()).toBe('17:30');
    await click('重置'); expect(timer()).toBe('25:00'); expect(host.textContent).not.toContain('继续');
  });
  it('continues when the homepage is unmounted and returns to the same round', async () => {
    await render(); await click('开始'); await render(false);
    await act(async () => vi.advanceTimersByTime(120_000)); await render(); expect(timer()).toBe('23:00');
  });
  it('restores a running timer after reload and does not add time', async () => {
    localStorage.setItem(POMODORO_KEY, JSON.stringify({ ...initialPomodoro(), deadline: Date.now() + 120_000 }));
    await render(); expect(timer()).toBe('02:00'); expect(host.textContent).toContain('暂停');
    await click('暂停'); const saved = JSON.parse(localStorage.getItem(POMODORO_KEY)!); expect(saved.deadline).toBeNull(); expect(saved.remainingMs).toBe(120_000);
  });
  it('marks an expired round complete and waits for a deliberate break', async () => {
    localStorage.setItem(POMODORO_KEY, JSON.stringify({ ...initialPomodoro(), deadline: Date.now() - 60_000 }));
    await render(); expect(timer()).toBe('00:00'); expect(host.textContent).toContain('这轮专注完成了');
    await act(async () => vi.advanceTimersByTime(10_000)); expect(timer()).toBe('00:00');
    await click('开始休息'); expect(timer()).toBe('05:00'); expect(host.querySelectorAll('.pomodoro-phases button')[1].getAttribute('aria-pressed')).toBe('true');
  });
  it('supports both presets, phase selection and explicit custom durations', async () => {
    await render(); await preset('50/10'); expect(timer()).toBe('50:00'); await click('休息'); expect(timer()).toBe('10:00');
    await preset('custom'); await input(0, '40'); await input(1, '8'); await click('应用'); expect(timer()).toBe('08:00');
    await click('专注'); expect(timer()).toBe('40:00'); await click('开始'); expect(host.querySelector('select')?.disabled).toBe(true);
  });
  it('rejects invalid custom minutes while preserving inputs and the saved round', async () => {
    await render(); await preset('custom'); await input(0, '0'); await input(1, '181'); await click('应用');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('1–180'); expect(timer()).toBe('25:00');
    expect(host.querySelectorAll<HTMLInputElement>('input[type="number"]')[1].value).toBe('181');
    await input(0, '1.5'); await input(1, '5'); await click('应用'); expect(timer()).toBe('25:00');
  });
  it('remains usable with blocked browser storage', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await render(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('浏览器无法保存');
    await click('开始'); await act(async () => vi.advanceTimersByTime(1000)); expect(timer()).toBe('24:59');
  });
  it('falls back safely from corrupt or out-of-range persisted state', async () => {
    localStorage.setItem(POMODORO_KEY, JSON.stringify({ ...initialPomodoro(), focusMinutes: -3 }));
    await render(); expect(timer()).toBe('25:00'); expect(host.querySelector('select')?.value).toBe('25/5');
  });
});

describe('pomodoro completion reminders', () => {
  function mockAudio() {
    const tones: { frequency: { value: number }; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; onended: (() => void) | null }[] = [];
    const gains: { gain: { setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn> }; disconnect: ReturnType<typeof vi.fn> }[] = [];
    const context = {
      state: 'running', currentTime: 12, destination: {}, resume: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
      createOscillator: vi.fn(() => { const tone = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), onended: null as (() => void) | null }; tones.push(tone); return tone; }),
      createGain: vi.fn(() => { const volume = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }; gains.push(volume); return volume; }),
    };
    const constructor = vi.fn(function () { return context; });
    vi.stubGlobal('AudioContext', constructor);
    return { context, tones, gains, constructor };
  }
  async function finishFocus() { await click('开始'); await act(async () => vi.advanceTimersByTime(25 * 60_000)); }
  async function muteToggle() { await act(async () => host.querySelector<HTMLInputElement>('.pomodoro-sound input')!.click()); }

  it('plays a louder finite sequence once for each focus/break completion and frees finished notes', async () => {
    const { tones, gains } = mockAudio(); await render(); await finishFocus();
    expect(timer()).toBe('00:00'); expect(tones).toHaveLength(6);
    expect(tones.map(tone => tone.frequency.value)).toEqual([880, 1174.66, 880, 1174.66, 880, 1174.66]);
    const starts = tones.map(tone => tone.start.mock.calls[0][0] as number);
    expect(starts[0]).toBe(12); expect(starts[2] - starts[0]).toBeCloseTo(1.8); expect(starts[4] - starts[2]).toBeCloseTo(1.8);
    expect(tones[5].stop.mock.calls[0][0] - starts[0]).toBeCloseTo(4.55);
    expect(gains.every(volume => volume.gain.linearRampToValueAtTime.mock.calls[0][0] > .08)).toBe(true);
    await act(async () => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); vi.advanceTimersByTime(10_000); });
    expect(tones).toHaveLength(6);
    for (const tone of tones) tone.onended!();
    expect(tones.every(tone => tone.disconnect.mock.calls.length === 1)).toBe(true); expect(gains.every(volume => volume.disconnect.mock.calls.length === 1)).toBe(true);
    await click('开始休息'); await act(async () => vi.advanceTimersByTime(5 * 60_000));
    expect(host.textContent).toContain('休息结束'); expect(tones).toHaveLength(12);
  });
  it('previews the same sound without changing the timer, replacing previews and cancelling immediately on mute', async () => {
    const { tones, gains } = mockAudio(); await render(); const saved = localStorage.getItem(POMODORO_KEY);
    await click('试听提示音'); expect(tones).toHaveLength(6); expect(timer()).toBe('25:00'); expect(localStorage.getItem(POMODORO_KEY)).toBe(saved);
    await click('试听提示音'); expect(tones).toHaveLength(12); expect(tones.slice(0, 6).every(tone => tone.stop.mock.calls.at(-1)?.length === 0)).toBe(true);
    await muteToggle(); expect(tones.every(tone => tone.disconnect.mock.calls.length === 1)).toBe(true); expect(gains.every(volume => volume.disconnect.mock.calls.length === 1)).toBe(true);
    expect([...host.querySelectorAll('button')].find(button => button.textContent === '试听提示音')?.disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(10_000)); expect(tones).toHaveLength(12);
  });
  it.each(['重置', '开始休息'])('stops the current completion sound when choosing %s', async action => {
    const { tones } = mockAudio(); await render(); await finishFocus(); await click(action);
    expect(tones).toHaveLength(6); expect(tones.every(tone => tone.stop.mock.calls.at(-1)?.length === 0)).toBe(true);
    expect(tones.every(tone => tone.disconnect.mock.calls.length === 1)).toBe(true);
  });
  it('keeps muted completions silent and unlocks audio when enabled during a running timer', async () => {
    const { tones, constructor, context } = mockAudio(); localStorage.setItem(POMODORO_KEY, JSON.stringify({ ...initialPomodoro(), sound: false }));
    await render(); await finishFocus(); expect(tones).toHaveLength(0); expect(constructor).not.toHaveBeenCalled(); expect(host.textContent).toContain('这轮专注完成了');
    await click('重置'); await click('开始'); await muteToggle(); expect(constructor).toHaveBeenCalledOnce(); expect(context.resume).toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(25 * 60_000)); expect(tones).toHaveLength(6);
  });
  it('does not replay a restored expired round or a preview cancelled before audio resumes', async () => {
    const { tones, context } = mockAudio(); localStorage.setItem(POMODORO_KEY, JSON.stringify({ ...initialPomodoro(), deadline: Date.now() - 1000 }));
    await render(); await act(async () => vi.advanceTimersByTime(5000)); expect(tones).toHaveLength(0);
    let resume!: () => void; context.resume.mockImplementation(() => new Promise<void>(resolve => { resume = resolve; }));
    await click('试听提示音'); await muteToggle(); await act(async () => resume()); expect(tones).toHaveLength(0);
  });
  it('cancels scheduled notes and closes the audio context on provider teardown', async () => {
    const { tones, context } = mockAudio(); await render(); await click('试听提示音');
    await act(async () => root.unmount()); root = createRoot(host);
    expect(context.close).toHaveBeenCalledOnce(); expect(tones.every(tone => tone.disconnect.mock.calls.length === 1)).toBe(true);
  });
});
