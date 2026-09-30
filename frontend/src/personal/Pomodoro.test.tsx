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
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
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
