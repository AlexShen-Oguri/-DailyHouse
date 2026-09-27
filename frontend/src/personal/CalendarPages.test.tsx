import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TodosPage from './Todos';
import SettingsPage from './Settings';
import type { Workspace } from './api';

const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn(), data: null as Workspace | null }));
vi.mock('./api', async original => ({ ...(await original<typeof import('./api')>()), request: mocks.request }));
vi.mock('./Workspace', () => ({ useWorkspace: () => ({ data: mocks.data, refresh: mocks.refresh }) }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mocks.request.mockReset(); mocks.refresh.mockReset();
  mocks.data = {
    settings: { calendarFile: 'C:\\fixtures\\semester.ics', calendarConfigured: true, calendarUrlConfigured: false, vaultPath: '', animationEnabled: true, readingTechPath: '', readingAestheticPath: '' },
    todos: [],
    calendar: { status: 'ready', provider: 'file', updatedAt: '2026-09-27T12:00:00Z', message: '未来 180 天', range: { from: '2026-09-27T00:00:00', to: '2027-03-26T00:00:00', days: 180 }, events: [
      { id: 'oct', title: 'October lesson', start: '2026-10-01', end: '2026-10-02', allDay: true, location: '' },
      { id: 'dec', title: 'December lesson', start: '2026-12-15', end: '2026-12-16', allDay: true, location: '' },
    ] },
    vault: { status: 'unconfigured', name: '', notes: [], lastReadAt: null, message: '' },
    finance: { status: 'unconnected', provider: 'Chase', message: '', accounts: [], transactions: [] },
  };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('calendar connection and month controls', () => {
  it('lets the user find December and empty months without changing source data', async () => {
    await act(async () => root.render(<MemoryRouter><TodosPage/></MemoryRouter>));
    const select = host.querySelector<HTMLSelectElement>('.pw-calendar-toolbar select')!;
    expect([...select.options].some(option => option.value === '2026-12')).toBe(true);
    await act(async () => { select.value = '2026-12'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.querySelector('.pw-events')?.textContent).toContain('December lesson');
    expect(host.querySelector('.pw-events')?.textContent).not.toContain('October lesson');
    await act(async () => { select.value = '2027-02'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.textContent).toContain('这个月暂无日程');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('does not accidentally disconnect a local calendar when an empty new subscription is submitted', async () => {
    await act(async () => root.render(<MemoryRouter><SettingsPage/></MemoryRouter>));
    await act(async () => host.querySelectorAll<HTMLInputElement>('input[name="calendar-source"]')[1].click());
    const form = host.querySelector('input[type="password"]')!.closest('form')!;
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('请填写日历订阅地址');
    expect(mocks.request).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Windows 优先使用 Google Calendar');
  });
});
