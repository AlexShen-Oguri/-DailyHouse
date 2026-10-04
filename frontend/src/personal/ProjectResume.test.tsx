// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Projects from './Projects';
import InspirationLaunch from './InspirationLaunch';
import { PreferencesProvider } from './Preferences';
import type { Bubble } from './inspiration-model';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./api', async original => ({ ...(await original<typeof import('./api')>()), request: mocks.request }));
vi.mock('./SharedProjects', () => ({ default: () => null }));
let host: HTMLDivElement; let root: Root;
const now = '2026-09-27T12:00:00Z';
const item = { id: 'p', title: 'Flower game', path: 'C:\\Projects\\Flower', source: 'codex', codexProjectId: 'project-p', git: { status: 'ready', branch: 'main', changedFiles: 2, ahead: 1, behind: 0, lastCommit: { hash: 'abcdef123', subject: 'Grow the first flower', date: now } }, repo: { name: 'flower', url: 'https://github.com/AlexShen-Oguri/flower', private: true, match: 'remote' }, threads: [{ id: 'thread', title: 'Build a garden', preview: 'OLD OPENING PROMPT', updatedAt: now, url: 'codex://threads/thread', status: 'idle', latest: { request: 'Add petals', response: 'Petal animation is ready', status: 'completed', updatedAt: now } }], resumeCommand: 'codex -C "C:\\Projects\\Flower"' };
const state = { items: [item], trashCount: 0, updatedAt: now, integrations: { codex: { status: 'ready', message: '' }, github: { status: 'ready', message: '', login: 'AlexShen-Oguri' } } };
const bubble: Bubble = { id: 'idea', title: 'A flower gift', body: 'A blooming letter', revision: 1, createdAt: now, updatedAt: now, tags: [], sources: [], drafts: [], status: 'active', pinned: false };
function button(text: string) { const result = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text); if (!result) throw new Error(`Missing ${text}`); return result; }
async function click(node: HTMLElement) { await act(async () => { node.click(); }); }
async function mount(element: React.ReactNode) { await act(async () => { root.render(<MemoryRouter><PreferencesProvider>{element}</PreferencesProvider></MemoryRouter>); }); }
async function fill(label: string, text: string) { const input = [...host.querySelectorAll<HTMLInputElement>('input')].find(node => node.closest('label')?.firstChild?.textContent === label)!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); localStorage.clear(); mocks.request.mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe('real project resumption', () => {
  it('shows latest turn, actual Git state and only removes the website entry after confirmation', async () => {
    mocks.request.mockImplementation(async (path: string) => path === '/project-resume' ? state : { items: [] });
    await mount(<Projects/>); expect(host.textContent).toContain('Petal animation is ready'); expect(host.textContent).not.toContain('OLD OPENING PROMPT'); expect(host.textContent).toContain('2 个未提交文件'); expect(host.querySelector('a[href="codex://threads/thread"]')).not.toBeNull();
    await click(button('从小院移除')); expect(mocks.request.mock.calls.some(([, method]) => method === 'DELETE')).toBe(false); expect(host.textContent).toContain('GitHub 仓库不会被删除'); await click(button('确认仅移除小院入口')); expect(mocks.request).toHaveBeenCalledWith('/project-resume/p', 'DELETE');
  });
  it('does not report refresh success when integrations fail to refresh', async () => {
    mocks.request.mockImplementation(async (path: string) => { if (path === '/project-resume/refresh') throw new Error('Codex is offline'); return path === '/project-resume' ? state : { items: [] }; });
    await mount(<Projects/>); await click(button('重新读取本机项目')); expect(host.textContent).toContain('Codex is offline'); expect(host.textContent).not.toContain('本机项目与仓库关联已重新读取，没有 fetch 或修改代码。');
  });
  it('permanently deletes only a reviewed project trash record', async () => {
    mocks.request.mockImplementation(async (path: string) => path === '/project-resume' ? { ...state, items: [] } : { items: [{ item, deletedAt: now, expiresAt: '2099-01-01T00:00:00Z' }] });
    await mount(<Projects/>); const bin = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.startsWith('回收站'))!; await click(bin); await click(button('永久删除')); expect(mocks.request.mock.calls.some(([path]) => path.endsWith('/purge'))).toBe(false); await click(button('确认永久删除')); expect(mocks.request).toHaveBeenCalledWith('/project-resume/trash/purge', 'POST', { ids: ['p'], confirm: true, deletedAt: { p: now } });
  });
});
describe('independent project launch', () => {
  it('blocks unavailable tools and treats Claude as a manual prepared handoff', async () => {
    const manual = { id: 'claude-op', developmentTool: 'claude', status: 'awaiting_manual_handoff', step: 'handoff', path: '/fixture/project', manualHandoff: { cwd: '/fixture/project', executable: 'claude', args: [], contextPath: '/fixture/project/.dailyhouse/inspiration.md', started: false, nativeSessionRestored: false } };
    mocks.request.mockImplementation(async (path, method = 'GET') => path === '/development-tools' ? { tools: [{ id: 'codex', state: 'not_installed', message: 'fixture missing Codex' }, { id: 'claude', state: 'authenticated' }] } : method === 'GET' ? { operation: null, defaults: {} } : { operation: manual });
    await mount(<InspirationLaunch bubble={bubble}/>); await click(button('开始一个项目')); await fill('GitHub 仓库名', 'fixture-project'); expect(button('确认创建并交给 Codex').disabled).toBe(true);
    await click(host.querySelectorAll<HTMLInputElement>('input[type=radio]')[1]); expect(mocks.request.mock.calls.some(([, method]) => method === 'POST')).toBe(false); await click(button('确认创建并准备 Claude Code 交接')); expect(mocks.request).toHaveBeenCalledWith('/inspiration/idea/launch', 'POST', { name: 'A flower gift', repoName: 'fixture-project', developmentTool: 'claude', confirm: true }); expect(host.textContent).toContain('Claude Code 尚未启动'); expect(host.textContent).toContain('没有恢复其他设备的原生对话'); expect(host.querySelector('a[href^="codex:"]')).toBeNull();
  });
  it('waits for explicit reviewed confirmation before creating external work', async () => {
    mocks.request.mockImplementation(async (_path: string, method = 'GET') => _path === '/development-tools' ? { tools: [{ id: 'codex', state: 'authenticated' }, { id: 'claude', state: 'not_installed' }] } : method === 'GET' ? { operation: null, defaults: { workspaceRoot: 'C:\\Projects', githubOwner: 'AlexShen-Oguri', repositoryVisibility: 'private' } } : { operation: { id: 'op', status: 'ready', step: 'complete', name: 'A flower gift', path: 'C:\\Projects\\flower-gift' } });
    await mount(<InspirationLaunch bubble={bubble}/>); await click(button('开始一个项目')); await fill('GitHub 仓库名', 'flower-gift'); expect(mocks.request.mock.calls.some(([, method]) => method === 'POST')).toBe(false); expect(host.textContent).toContain('私有 GitHub 仓库'); await click(button('确认创建并交给 Codex')); expect(mocks.request).toHaveBeenCalledWith('/inspiration/idea/launch', 'POST', { name: 'A flower gift', repoName: 'flower-gift', developmentTool: 'codex', confirm: true });
    await click(button('移除交接记录')); expect(mocks.request.mock.calls.some(([, method]) => method === 'DELETE')).toBe(false); await click(button('确认移除交接记录')); expect(mocks.request).toHaveBeenCalledWith('/project-launches/op', 'DELETE', { confirm: true }); expect(host.textContent).toContain('外部项目仍保留'); expect(host.textContent).not.toContain('开始一个项目');
  });
  it('respects a removed launch tombstone and never offers duplicate creation', async () => {
    mocks.request.mockResolvedValue({ operation: null, removed: true, defaults: {} }); await mount(<InspirationLaunch bubble={bubble}/>); expect(host.textContent).toContain('交接记录已从小院移除'); expect(host.textContent).not.toContain('开始一个项目');
  });
});

it('confirms empty-thread repair separately and reuses the existing launch operation', async () => {
  const operation = { id: 'empty-op', status: 'failed', step: 'handoff', issue: 'empty_thread', message: 'Empty conversation', path: '/fixture/existing', threadUrl: 'codex://threads/empty', repoUrl: 'https://github.com/fixture/existing' };
  mocks.request.mockImplementation(async (path, method = 'GET') => method === 'POST' ? { operation: { ...operation, status: 'running' } } : { operation });
  await mount(<InspirationLaunch bubble={bubble}/>); expect(host.textContent).toContain('把上下文交给 Codex · 未完成'); await click(button('修复空对话交接')); expect(mocks.request.mock.calls.some(([, method]) => method === 'POST')).toBe(false); expect(host.textContent).toContain('原空对话、代码、灵感和 GitHub 仓库都保留');
  await click(button('确认新建替代对话并交接')); expect(mocks.request).toHaveBeenCalledWith('/project-launches/empty-op/retry', 'POST', { replaceEmptyThread: true, confirm: true });
});
