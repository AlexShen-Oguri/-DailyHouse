// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectCommitHistory from './ProjectCommitHistory';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./api', async original => ({ ...(await original<typeof import('./api')>()), request: mocks.request }));
const commit = (id: string) => ({ hash: id.repeat(40), shortHash: id.repeat(7), subject: `Commit ${id}`, message: `Commit ${id}\n\nThe complete multiline rationale for ${id}.`, author: { name: 'Alex', email: 'alex@example.com' }, authoredAt: '2026-09-20T12:00:00Z', committedAt: '2026-09-21T12:00:00Z', parents: [], refs: id === 'a' ? ['HEAD -> main', 'tag: v1'] : [], url: id === 'a' ? 'https://github.com/example/project/commit/' + id.repeat(40) : undefined });
const page = { status: 'ready', items: [commit('a')], refs: [{ name: 'refs/heads/main', label: 'main', kind: 'branch', hash: 'a'.repeat(40) }, { name: 'refs/tags/main', label: 'main', kind: 'tag', hash: 'b'.repeat(40) }], selectedRef: 'all', shallow: false, snapshotAt: '2026-09-27T12:00:00Z', nextCursor: 'opaque-next', total: 2 };
let host: HTMLDivElement; let root: Root;
const click = async (node: HTMLElement) => { await act(async () => { node.click(); }); };
function button(text: string) { const target = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.includes(text)); if (!target) throw new Error(`Missing ${text}`); return target; }
const mount = async (githubAvailable = false) => { await act(async () => { root.render(<ProjectCommitHistory projectId="project:one" projectTitle="Flower game" githubAvailable={githubAvailable}/>); }); };
beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); mocks.request.mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe('complete local commit history', () => {
  it('loads on demand, follows opaque pagination and shows complete details with trusted links', async () => {
    mocks.request.mockResolvedValueOnce(page).mockResolvedValueOnce({ ...page, items: [commit('b')], nextCursor: null }); await mount(); expect(mocks.request).not.toHaveBeenCalled(); await click(button('查看本机提交历史'));
    expect(mocks.request).toHaveBeenCalledWith('/project-resume/project%3Aone/history?limit=30&ref=all'); expect(host.textContent).toContain('The complete multiline rationale for a.'); expect(host.textContent).toContain('2026'); expect(host.textContent).toContain('分支 · main'); expect(host.textContent).toContain('标签 · main');
    await click(button('加载更多提交')); expect(mocks.request).toHaveBeenLastCalledWith('/project-resume/project%3Aone/history?limit=30&cursor=opaque-next'); expect(host.textContent).toContain('Commit a'); expect(host.textContent).toContain('Commit b'); expect(host.textContent).toContain('已下载的记录已展示完'); expect(host.querySelectorAll('a')).toHaveLength(1);
  });
  it('keeps a loaded page on pagination failure and reloads a fresh snapshot explicitly', async () => {
    mocks.request.mockResolvedValueOnce(page).mockRejectedValueOnce(new Error('Snapshot expired')).mockResolvedValueOnce({ ...page, items: [commit('c')], nextCursor: null, total: 1 }); await mount(); await click(button('查看本机提交历史')); await click(button('加载更多提交')); expect(host.textContent).toContain('Commit a'); expect(host.textContent).toContain('Snapshot expired'); await click(button('重新读取历史')); expect(host.textContent).not.toContain('Commit a'); expect(host.textContent).toContain('Commit c');
  });
  it('reports shallow and empty history without inventing commits', async () => {
    mocks.request.mockResolvedValue({ ...page, status: 'empty', shallow: true, items: [], nextCursor: null, total: 0 }); await mount(); await click(button('查看本机提交历史')); expect(host.textContent).toContain('浅克隆'); expect(host.textContent).toContain('还没有提交'); expect(host.querySelectorAll('.project-commits li')).toHaveLength(0);
  });
  it('labels local and GitHub results separately and queries the API only after explicit action', async () => {
    mocks.request.mockImplementation(async (_path, method) => method === 'POST' ? { source: 'github_api', fetchedAt: '2026-10-04T12:00:00Z', repoUrl: 'https://github.com/fixture/project', items: [commit('b')], nextPage: 2, complete: false, page: 1, limit: 30 } : { ...page, source: 'local_git' });
    await mount(true); await click(button('查看本机提交历史')); expect(mocks.request.mock.calls.some(([, method]) => method === 'POST')).toBe(false); expect(host.textContent).toContain('来源：本机 Git'); expect(host.textContent).toContain('未推送的提交');
    await click(button('查询 GitHub 提交')); expect(mocks.request).toHaveBeenCalledWith('/project-resume/project%3Aone/github-history', 'POST', { page: 1, limit: 30 }); expect(host.textContent).toContain('来源：GitHub API'); expect(host.textContent).toContain('不称为完整历史'); expect(host.querySelectorAll('.project-commits')).toHaveLength(2);
    await click(button('查询下一页 GitHub 提交')); expect(mocks.request).toHaveBeenLastCalledWith('/project-resume/project%3Aone/github-history', 'POST', { page: 2, limit: 30 }); expect(host.querySelectorAll('.project-github-history .project-commits li')).toHaveLength(1);
  });
});
