// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import SharedProjects from './SharedProjects';
import { PreferencesProvider } from './Preferences';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./api', async original => ({ ...(await original<typeof import('./api')>()), request: mocks.request }));
let host: HTMLDivElement; let root: Root; let failure = ''; let present = true;
const now = '2026-10-04T12:00:00Z';
const project = { id: 'shared-fixture', title: 'Synthetic garden', goal: 'Make a small experiment', decisions: 'Use pixels', progress: 'First scene ready', nextStep: 'Playtest', repoUrl: 'https://github.com/fixture/project', createdAt: now, updatedAt: now, revision: 3, provenance: { deviceId: 'mac-fixture', deviceName: 'Fixture Mac', updatedAt: now } };
async function mount() { await act(async () => root.render(<PreferencesProvider><SharedProjects localProjects={[{ id: 'local-codex', title: 'Fixture local', path: 'C:\\Fixture', threads: [] }]}/></PreferencesProvider>)); }
function button(name: string) { const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === name); if (!found) throw new Error(name); return found; }
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function change(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) { await act(async () => { const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }); }
beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); localStorage.clear(); sessionStorage.clear(); failure = ''; present = true; mocks.request.mockReset(); mocks.request.mockImplementation(async (path, method = 'GET') => { if (method === 'GET') return path === '/shared-projects/trash' ? { items: present ? [] : [{ project, deletedAt: now, expiresAt: '2099-01-01T00:00:00Z' }] } : { items: present ? [project] : [] }; if (failure) throw new Error(failure); if (method === 'DELETE' && path === '/shared-projects/shared-fixture') { present = false; return; } if (path.endsWith('/restore')) present = true; if (path.endsWith('/handoff-preview')) return { text: 'Synthetic reviewed project context', recipe: { executable: 'codex', args: [], started: false, nativeSessionRestored: false }, existingSession: false }; return project; }); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
describe('shared project identity and local links', () => {
  it('uses one stable creation request id across a failed save and retry', async () => {
    await mount(); await click(button('添加项目上下文')); await change(host.querySelector<HTMLInputElement>('input')!, 'Fixture new context'); await change(host.querySelector<HTMLTextAreaElement>('textarea')!, 'Fixture goal'); failure = 'Request timed out'; await click(button('保存项目上下文')); const first = mocks.request.mock.calls.find(([path, method]) => path === '/shared-projects' && method === 'POST')!; failure = ''; await click(button('保存项目上下文')); const writes = mocks.request.mock.calls.filter(([path, method]) => path === '/shared-projects' && method === 'POST'); expect(writes).toHaveLength(2); expect(writes[1][2].requestId).toBe(first[2].requestId); expect(first[2].requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('shows provenance without copying another device directory or claiming native conversation recovery', async () => {
    await mount(); expect(host.textContent).toContain('Fixture Mac'); expect(host.textContent).toContain('当前设备尚未关联代码目录'); expect(host.textContent).toContain('不会自动互通'); expect(mocks.request.mock.calls.some(([, method]) => method && method !== 'GET')).toBe(false); expect(host.querySelector('a[href^="codex:"]')).toBeNull();
  });
  it('only links an explicit verified local project, without creating external resources', async () => {
    await mount(); await click(button('关联当前设备')); const selects = host.querySelectorAll<HTMLSelectElement>('select'); await change(selects[1], 'local-codex'); expect(mocks.request.mock.calls.some(([, method]) => method === 'POST')).toBe(false); await click(button('确认关联当前设备'));
    expect(mocks.request).toHaveBeenCalledWith('/shared-projects/shared-fixture/link', 'POST', { revision: 3, tool: 'codex', localProjectId: 'local-codex' }); expect(mocks.request.mock.calls.some(([path]) => String(path).includes('/launch'))).toBe(false);
  });
  it('keeps failed edits and requires review after reloading a newer revision', async () => {
    await mount(); await click(button('更新项目上下文')); const progress = host.querySelectorAll<HTMLTextAreaElement>('textarea')[2]; await change(progress, 'Keep this offline edit'); failure = 'Changed on another device'; await click(button('保存项目上下文')); expect(progress.value).toBe('Keep this offline edit'); expect(host.textContent).toContain(failure); failure = ''; await click(button('重新读取并保留草稿')); expect(button('保存项目上下文').disabled).toBe(true); await click(button('已核对，继续保存草稿')); await click(button('保存项目上下文'));
    expect(mocks.request).toHaveBeenCalledWith('/shared-projects/shared-fixture', 'PATCH', expect.objectContaining({ progress: 'Keep this offline edit', revision: 3 }));
  });
  it('confirms deletion, retains recovery and limits permanent deletion to DailyHouse records', async () => {
    await mount(); await click(button('移除项目上下文')); expect(mocks.request.mock.calls.some(([, method]) => method === 'DELETE')).toBe(false); expect(host.textContent).toContain('外部工具对话、代码目录、GitHub 仓库和原始文件保留'); await click(button('确认仅移除小院记录')); expect(mocks.request).toHaveBeenCalledWith('/shared-projects/shared-fixture', 'DELETE', { revision: 3, confirmed: true }); await click(button('项目回收站 (1)')); await click(button('永久删除项目上下文')); expect(mocks.request.mock.calls.some(([path]) => String(path).startsWith('/shared-projects/trash/'))).toBe(false); await click(button('取消')); await click(button('恢复项目上下文')); expect(mocks.request).toHaveBeenCalledWith('/shared-projects/shared-fixture/restore', 'POST', { confirmed: true });
  });
  it('only prepares selected project context on confirmation and states missing local code truthfully', async () => {
    await mount(); await click(button('准备继续工作')); expect(mocks.request.mock.calls.some(([path]) => String(path).endsWith('/handoff-preview'))).toBe(false); await click(button('确认并检查继续工作的上下文')); expect(mocks.request).toHaveBeenCalledWith('/shared-projects/shared-fixture/handoff-preview', 'POST', { tool: 'codex', confirmed: true }); expect(host.textContent).toContain('没有已验证的代码目录'); expect(host.textContent).toContain('没有恢复原生对话'); expect(host.querySelector<HTMLTextAreaElement>('textarea[readonly]')?.value).toBe('Synthetic reviewed project context');
  });
  it('protects changed text before New or another project replaces the editor', async () => {
    const second = { ...project, id: 'other-fixture', title: 'Another project', goal: 'Another goal' };
    mocks.request.mockImplementation(async path => path === '/shared-projects/trash' ? { items: [] } : { items: [project, second] });
    await mount(); await click(button('更新项目上下文')); await change(host.querySelectorAll<HTMLTextAreaElement>('textarea')[2], 'Keep my new progress');
    await click(button('添加项目上下文')); expect(host.querySelectorAll<HTMLTextAreaElement>('textarea')[2].value).toBe('Keep my new progress'); expect(host.textContent).toContain('保留还是放弃未保存草稿');
    expect(JSON.parse(sessionStorage.getItem('dailyhouse.shared-project-draft.v1')!).editor.draft.progress).toBe('Keep my new progress');
    await click(button('保留草稿，继续编辑')); const updates = [...host.querySelectorAll<HTMLButtonElement>('button')].filter(node => node.textContent?.trim() === '更新项目上下文'); await click(updates[1]);
    expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('Synthetic garden'); await click(button('放弃草稿并继续')); expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('Another project');
    expect(sessionStorage.getItem('dailyhouse.shared-project-draft.v1')).toBeNull(); expect(mocks.request.mock.calls.some(([, method]) => method && method !== 'GET')).toBe(false);
  });
  it('requires explicit discard before Cancel clears a nonempty new-project draft', async () => {
    await mount(); await click(button('添加项目上下文')); await change(host.querySelector<HTMLInputElement>('input')!, 'An incomplete private thought');
    await click(button('取消编辑')); expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('An incomplete private thought'); await click(button('保留草稿，继续编辑'));
    expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('An incomplete private thought'); await click(button('取消编辑')); await click(button('放弃草稿并继续'));
    expect(host.querySelector('.shared-project-editor')).toBeNull(); expect(sessionStorage.getItem('dailyhouse.shared-project-draft.v1')).toBeNull(); expect(mocks.request.mock.calls.some(([, method]) => method && method !== 'GET')).toBe(false);
  });
  it('restores a tab-local draft after route unmount and keeps its creation retry identity', async () => {
    await mount(); await click(button('添加项目上下文')); await change(host.querySelector<HTMLInputElement>('input')!, 'A draft kept on this device'); await change(host.querySelector<HTMLTextAreaElement>('textarea')!, 'A small goal');
    const closing = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(closing); expect(closing.defaultPrevented).toBe(true);
    failure = 'Connection lost'; await click(button('保存项目上下文')); const firstWrite = mocks.request.mock.calls.find(([, method]) => method === 'POST')!;
    await act(async () => root.render(<div>Another page</div>)); await mount(); expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('A draft kept on this device'); expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('A small goal');
    expect(host.textContent).toContain('它不会同步到云端'); failure = ''; await click(button('保存项目上下文')); const writes = mocks.request.mock.calls.filter(([, method]) => method === 'POST');
    expect(writes).toHaveLength(2); expect(writes[1][2].requestId).toBe(firstWrite[2].requestId); expect(sessionStorage.getItem('dailyhouse.shared-project-draft.v1')).toBeNull();
    const saved = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(saved); expect(saved.defaultPrevented).toBe(false);
  });
  it('warns when tab storage is unavailable without claiming the draft will be restored', async () => {
    await mount(); await click(button('添加项目上下文')); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota unavailable'); });
    await change(host.querySelector<HTMLInputElement>('input')!, 'Text still in the editor'); expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('Text still in the editor');
    expect(host.textContent).toContain('无法读取或保存本机标签页草稿'); expect(host.textContent).not.toContain('离开此页再返回会恢复'); expect(mocks.request.mock.calls.some(([, method]) => method && method !== 'GET')).toBe(false);
  });
});
