import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JournalPage, { JournalDetailPage } from './Journal';
import { journalDay, type JournalEntry } from './journal-model';
import { PreferencesProvider } from './Preferences';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./api', async () => ({ ...await vi.importActual('./api'), request: mocks.request }));
let host: HTMLDivElement, root: Root, entry: JournalEntry;
function sample(): JournalEntry { return { date: '2026-10-03', timezone: 'America/New_York', title: '示例工作日记', codex: '完成示例功能', life: '', reflection: '检查下一步', status: 'final', lifeState: 'skipped', revision: 1, editedFields: [], writer: 'codex', createdAt: '2026-10-04T03:30:00Z', updatedAt: '2026-10-04T03:30:00Z' }; }
function summary() { const { codex, life: _life, reflection: _reflection, editedFields: _locks, ...rest } = entry; return { ...rest, preview: codex }; }
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); document.documentElement.lang = 'zh-CN';
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); entry = sample();
  mocks.request.mockReset().mockImplementation(async (url: string) => url === '/journal/trash' ? { items: [] } : url.includes('?') ? { items: [summary()], total: 1 } : structuredClone(entry));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function render(url = '/journal/2026-10-03') { await act(async () => root.render(<PreferencesProvider><MemoryRouter initialEntries={[url]}><Routes><Route path="/journal" element={<JournalPage/>}/><Route path="/journal/:date" element={<JournalDetailPage/>}/></Routes></MemoryRouter></PreferencesProvider>)); }
const button = (name: string) => { const result = [...host.querySelectorAll('button')].find(item => item.textContent === name); expect(result, name).toBeTruthy(); return result!; };
async function click(name: string) { await act(async () => button(name).click()); }
async function field(name: string, value: string) {
  const label = [...host.querySelectorAll('label')].find(item => item.textContent?.startsWith(name));
  const input = label?.querySelector('input,textarea,select') as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  expect(input, name).toBeTruthy();
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
async function submit() { await act(async () => host.querySelector('.journal-editor')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }

describe('work journal pages', () => {
  it('lists dated pages and searches the full journal through the API', async () => {
    await render('/journal');
    expect(host.querySelector('.journal-card h2 a')?.getAttribute('href')).toBe('/journal/2026-10-03');
    expect(host.textContent).toContain('已记录 1 天');
    await field('搜索日记', '现实中的练习'); await field('月份', '2026-10');
    await act(async () => host.querySelector('.journal-filters')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(mocks.request.mock.calls.at(-1)![0]).toBe('/journal?q=%E7%8E%B0%E5%AE%9E%E4%B8%AD%E7%9A%84%E7%BB%83%E4%B9%A0&month=2026-10');
  });
  it('keeps personal markup inert and distinguishes skipped life notes from no real-world activity', async () => {
    entry.codex = '<img src=x onerror=alert(1)>'; await render();
    expect(host.querySelector('.journal-text')?.textContent).toBe(entry.codex);
    expect(host.querySelector('.journal-text img')).toBeNull();
    expect(host.textContent).toContain('本次未补充现实活动');
  });
  it('adds life notes without changing the date or unrelated sections', async () => {
    await render(); await click('编辑日记'); await field('现实中的工作与生活', '完成现实中的练习');
    mocks.request.mockImplementation(async (url: string, method: string, payload: Record<string, unknown>) => { if (method === 'PATCH') { expect(url).toBe('/journal/2026-10-03'); expect(payload).toEqual({ revision: 1, life: '完成现实中的练习', lifeState: 'provided' }); entry = { ...entry, ...payload, revision: 2 } as JournalEntry; } return structuredClone(entry); });
    await submit(); expect(host.querySelector('form')).toBeNull(); expect(host.textContent).toContain('完成现实中的练习'); expect(host.textContent).toContain('完成示例功能');
  });
  it('keeps the draft after a concurrent update and requires review before retrying', async () => {
    await render(); await click('编辑日记'); await field('现实中的工作与生活', '我的补充草稿');
    mocks.request.mockImplementation(async (_url: string, method: string) => { if (method === 'PATCH') { entry.revision = 2; entry.codex = '聊天里新增的进展'; throw new Error('日记已更新，请核对最新内容后重试'); } return structuredClone(entry); });
    await submit(); expect(button('保存日记').disabled).toBe(true); expect(host.querySelectorAll('textarea')[1].value).toBe('我的补充草稿');
    expect(host.textContent).toContain('聊天里新增的进展'); await click('已核对，保存我修改的部分');
    mocks.request.mockImplementation(async (_url: string, method: string, payload: Record<string, unknown>) => { if (method === 'PATCH') { expect(payload).toEqual({ revision: 2, life: '我的补充草稿', lifeState: 'provided' }); entry = { ...entry, ...payload, revision: 3 } as JournalEntry; } return structuredClone(entry); });
    await submit(); expect(host.textContent).toContain('聊天里新增的进展'); expect(host.textContent).toContain('我的补充草稿');
  });
  it('cancels deletion, confirms its scope, removes and restores the original date', async () => {
    await render(); await click('删除这篇日记'); expect(host.textContent).toContain('Codex 聊天、项目、书架和其他日期的日记都会保留');
    await click('保留日记'); expect(mocks.request.mock.calls.some(call => call[1] === 'DELETE')).toBe(false);
    mocks.request.mockImplementation(async (url: string, method: string, payload: Record<string, unknown>) => {
      if (method === 'DELETE') { expect(payload).toEqual({ revision: 1, confirmed: true }); return {}; }
      if (url === '/journal/trash') return { items: [{ ...summary(), expiresAt: '2026-11-03T03:30:00Z' }] };
      if (url.endsWith('/restore')) { expect(payload).toEqual({ revision: 1 }); entry.revision++; }
      return structuredClone(entry);
    });
    await click('删除这篇日记'); await click('确认删除日记'); expect(host.textContent).toContain('恢复并打开');
    await click('恢复并打开'); expect(host.querySelector('h1')?.textContent).toBe(entry.title); expect(host.textContent).toContain('完成示例功能');
  });
  it('creates a dated journal and moves to its saved page', async () => {
    await render('/journal'); await click('写日记'); await field('日记日期', '2026-10-01'); await field('现实中的工作与生活', '示例散步');
    mocks.request.mockImplementation(async (_url: string, method: string, payload: Record<string, unknown>) => { if (method === 'POST') { expect(payload.date).toBe('2026-10-01'); expect(payload.lifeState).toBe('provided'); entry = { ...entry, ...payload } as JournalEntry; } return structuredClone(entry); });
    await submit(); expect(host.querySelector('h1')?.textContent).toBe(entry.title); expect(host.textContent).toContain('示例散步');
  });
  it('switches interface language without changing the authored journal', async () => {
    localStorage.setItem('dailyhouse-language', 'en'); await render();
    expect(host.textContent).toContain('Work and life outside Codex'); expect(host.textContent).toContain('完成示例功能');
  });
  it('uses New York dates across midnight and daylight-saving changes', () => {
    expect(journalDay(new Date('2026-10-04T03:59:00Z'))).toBe('2026-10-03');
    expect(journalDay(new Date('2026-10-04T04:00:00Z'))).toBe('2026-10-04');
    expect(journalDay(new Date('2026-11-02T04:59:00Z'))).toBe('2026-11-01');
    expect(journalDay(new Date('2026-11-02T05:00:00Z'))).toBe('2026-11-02');
  });
});
