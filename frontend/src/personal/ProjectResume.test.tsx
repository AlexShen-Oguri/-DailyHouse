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
    await mount(<Projects/>); await click(button('重新读取本机项目')); expect(host.textContent).toContain('Codex is offline'); expect(host.textContent).not.toContain('Codex 项目与 GitHub 关联已重新读取。');
  });
  it('permanently deletes only a reviewed project trash record', async () => {
    mocks.request.mockImplementation(async (path: string) => path === '/shared-projects' ? { items: [] } : path === '/project-resume' ? { ...state, items: [] } : { items: [{ item, deletedAt: now, expiresAt: '2099-01-01T00:00:00Z' }] });
    await mount(<Projects/>); const bin = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.startsWith('回收站'))!; await click(bin); await click(button('永久删除')); expect(mocks.request.mock.calls.some(([path]) => path.endsWith('/purge'))).toBe(false); await click(button('确认永久删除')); expect(mocks.request).toHaveBeenCalledWith('/project-resume/trash/purge', 'POST', { ids: ['p'], confirm: true, deletedAt: { p: now } });
  });
});
describe('private repository creation', () => {
  const defaults = { githubOwner: 'AlexShen-Oguri', repositoryVisibility: 'private' };
  it('requires reviewed creation and scoped removal, with no project or conversation creation', async () => {
    mocks.request.mockImplementation(async (_path: string, method = 'GET') => method === 'GET' ? { operation: null, defaults } : { operation: { id: 'op', kind: 'repository', status: 'ready', repoUrl: 'https://github.com/AlexShen-Oguri/flower-gift' } });
    await mount(<InspirationLaunch bubble={bubble}/>); await click(button('创建 GitHub 私有仓库')); await fill('GitHub 仓库名', 'flower-gift'); expect(host.querySelectorAll('input')).toHaveLength(1); expect(mocks.request.mock.calls.some(([, method]) => method === 'POST')).toBe(false);
    expect(host.textContent).toContain('仅创建空的 GitHub 私有仓库'); await click(button('确认创建私有仓库')); expect(mocks.request).toHaveBeenCalledWith('/inspiration/idea/launch', 'POST', { repoName: 'flower-gift', confirm: true }); expect(host.textContent).toContain('私有仓库已创建'); expect(host.querySelector('a[href="https://github.com/AlexShen-Oguri/flower-gift"]')).not.toBeNull(); expect(host.querySelector('a[href^="codex:"]')).toBeNull();
    await click(button('移除小院仓库记录')); expect(mocks.request.mock.calls.some(([, method]) => method === 'DELETE')).toBe(false); expect(host.textContent).toContain('Codex 对话都保留'); await click(button('取消')); expect(mocks.request.mock.calls.some(([, method]) => method === 'DELETE')).toBe(false); await click(button('移除小院仓库记录')); await click(button('确认仅移除小院记录')); expect(mocks.request).toHaveBeenCalledWith('/project-launches/op', 'DELETE', { confirm: true }); expect(host.textContent).toContain('外部资源仍保留'); expect(host.textContent).not.toContain('创建 GitHub 私有仓库');
  });
  it('retains repository name after failure', async () => {
    mocks.request.mockImplementation(async (_path, method = 'GET') => { if (method === 'POST') throw Error('GitHub unavailable'); return { operation: null, defaults }; }); await mount(<InspirationLaunch bubble={bubble}/>); await click(button('创建 GitHub 私有仓库')); await fill('GitHub 仓库名', 'keep-this-name'); await click(button('确认创建私有仓库')); expect(host.textContent).toContain('GitHub unavailable'); expect(host.querySelector('input')?.value).toBe('keep-this-name');
  });
  it('respects a removed record and offers no duplicate creation', async () => {
    mocks.request.mockResolvedValue({ operation: null, removed: true, defaults }); await mount(<InspirationLaunch bubble={bubble}/>); expect(host.textContent).toContain('小院仓库记录已移除'); expect(host.textContent).not.toContain('创建 GitHub 私有仓库');
  });
  it('shows legacy repository associations without the failed Codex handoff or repair controls', async () => {
    mocks.request.mockResolvedValue({ operation: { id: 'legacy', status: 'failed', step: 'handoff', message: 'Old Codex error', path: '/old/private-folder', threadUrl: 'codex://threads/old', repoUrl: 'https://github.com/AlexShen-Oguri/old' }, defaults }); await mount(<InspirationLaunch bubble={bubble}/>); expect(host.textContent).toContain('已有 GitHub 仓库'); expect(host.querySelector('a[href="https://github.com/AlexShen-Oguri/old"]')).not.toBeNull(); for (const text of ['Old Codex error', '/old/private-folder', '修复空对话', '私有仓库已创建', '重试创建私有仓库']) expect(host.textContent).not.toContain(text); expect(host.querySelector('a[href^="codex:"]')).toBeNull(); expect(mocks.request).toHaveBeenCalledOnce();
  });
  it('retries an unfinished legacy record only through repository creation', async () => {
    const operation = { id: 'legacy', status: 'failed' }; mocks.request.mockResolvedValue({ operation, defaults }); await mount(<InspirationLaunch bubble={bubble}/>); expect(host.textContent).toContain('旧立项流程已停用'); await click(button('重试创建私有仓库')); expect(mocks.request).toHaveBeenCalledWith('/project-launches/legacy/retry', 'POST', {});
  });
});
