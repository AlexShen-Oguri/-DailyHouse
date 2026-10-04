import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalGithubSource, readGitSnapshot, githubHistoryQuery, type GithubRepo } from '../src/personal/project-sources';
import { ProjectHistory, historyGit } from '../src/personal/project-history';
import { ProjectResumeService } from '../src/personal/project-resume';

const owner = 'AlexShen-Oguri'; const repo: GithubRepo = { name: 'Synthetic', url: `https://github.com/${owner}/Synthetic`, private: true, match: 'remote' };
const commit = (suffix = '1') => ({ sha: suffix.repeat(40), commit: { author: { name: 'Synthetic author', email: 'fixture@example.test', date: '2026-10-04T12:00:00Z' }, committer: { date: '2026-10-04T13:00:00Z' }, message: 'A synthetic commit\n\nIts full body.' }, parents: [{ sha: 'f'.repeat(40) }] });
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const directory = () => { const root = mkdtempSync(join(tmpdir(), 'dailyhouse-git-provenance-')); roots.push(root); return root; };
const exec = promisify(execFile);
const git = async (root: string, ...args: string[]) => (await exec('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true })).stdout.trim();

function serviceFixture(overrides: { match?: 'remote' | 'name'; origin?: string; history?: boolean } = {}) {
  const root = directory(), file = join(root, 'resume.json');
  const source = { login: vi.fn(async () => owner), repos: vi.fn(async () => [repo]), create: vi.fn(async () => repo), ...(overrides.history === false ? {} : { history: vi.fn(async () => ({ source: 'github_api' as const, fetchedAt: new Date().toISOString(), repoUrl: repo.url, items: [], nextPage: null, complete: false as const, page: 1, limit: 30 })) }) };
  const project = { id: 'synthetic-project', title: 'Synthetic', path: root, codexProjectId: 'local-synthetic-id', source: 'codex', repo: { ...repo, match: overrides.match || 'remote' }, git: { status: 'ready' }, threads: [], resumeCommand: 'codex' };
  writeFileSync(file, JSON.stringify({ version: 1, cache: { items: [project], trashCount: 0, updatedAt: new Date().toISOString(), integrations: { codex: { status: 'ready', message: 'Fixture' }, github: { status: 'ready', message: 'Fixture' } } }, trash: [], hidden: [], launches: [], removedLaunches: [] }));
  const snapshot = vi.fn(async () => ({ status: 'ready' as const, remote: overrides.origin || repo.url })); const commands = vi.fn(async () => '');
  const service = new ProjectResumeService(file, { handoffContext: vi.fn(() => ({ markdown: 'Synthetic' })) }, { rpc: { call: vi.fn(async () => ({})) as any, close: vi.fn() }, github: source, snapshot, git: commands, workspaceRoot: root });
  return { service, snapshot, source, commands, file, project };
}

describe('separate local Git, cached tracking refs and actual GitHub API reads', () => {
  it('labels local status with read time and never invents the remote tracking fetch time', async () => {
    const root = directory(); await git(root, 'init', '-b', 'main'); await git(root, 'config', 'user.name', 'Synthetic'); await git(root, 'config', 'user.email', 'fixture@example.test'); await git(root, 'commit', '--allow-empty', '-m', 'Local-only synthetic commit');
    const calls: string[][] = []; const reader = async (args: string[], cwd?: string) => { calls.push(args); return git(cwd!, ...args); };
    const state = await readGitSnapshot(root, reader); expect(state).toMatchObject({ status: 'ready', source: 'local_git', tipsSource: 'remote_tracking', remoteTrackingUpdatedAt: null, lastCommit: { subject: 'Local-only synthetic commit' } }); expect(Number.isFinite(Date.parse(state.readAt!))).toBe(true);
    expect(state.ahead).toBeUndefined(); expect(state.behind).toBeUndefined(); expect(calls.some(args => ['fetch', 'pull', 'checkout', 'switch', 'commit', 'push'].includes(args[0]))).toBe(false);
    expect(await readGitSnapshot(join(root, 'missing'))).toMatchObject({ status: 'missing', source: 'local_git', remoteTrackingUpdatedAt: null });
  });

  it('distinguishes locally available refs from the cached remote branch without Git mutations', async () => {
    const root = directory(); await git(root, 'init', '-b', 'main'); await git(root, 'config', 'user.name', 'Synthetic'); await git(root, 'config', 'user.email', 'fixture@example.test'); await git(root, 'commit', '--allow-empty', '-m', 'Cached baseline');
    const old = await git(root, 'rev-parse', 'HEAD'); await git(root, 'update-ref', 'refs/remotes/origin/main', old); await git(root, 'commit', '--allow-empty', '-m', 'Unpushed local work');
    const calls: string[][] = []; const history = new ProjectHistory(async (args, cwd, input) => { calls.push(args); return historyGit(args, cwd, input); }); const project = { id: 'synthetic', path: root };
    const local = await history.page(project, { ref: 'refs/heads/main' }); expect(local.source).toBe('local_git'); expect(local.items[0].subject).toBe('Unpushed local work');
    const tracking = await history.page(project, { ref: 'refs/remotes/origin/main' }); expect(tracking).toMatchObject({ source: 'remote_tracking', range: 'selected_ref', remoteTrackingUpdatedAt: null }); expect(tracking.items[0].subject).toBe('Cached baseline');
    const all = await history.page(project, {}); expect(all.range).toBe('locally_available_refs'); expect(all.refs.find(ref => ref.kind === 'remote')?.source).toBe('remote_tracking'); expect(all.source).toBe('local_git');
    expect(calls.some(args => ['fetch', 'pull', 'checkout', 'switch', 'commit', 'push'].includes(args[0]))).toBe(false);
  });

  it('returns real bounded GitHub REST rows using one verified in-memory credential and no Git fetch', async () => {
    const credentials = vi.fn(async () => 'username=fixture\npassword=SYNTHETIC_SECRET\n'); const requests: { url: string; method: string }[] = [];
    const api = vi.fn(async (url: any, options: any) => { requests.push({ url: String(url), method: options.method }); expect(options.redirect).toBe('error'); expect(options.headers.Authorization).toBe('Bearer SYNTHETIC_SECRET'); expect(options.headers['X-GitHub-Api-Version']).toBe('2026-03-10'); return String(url).endsWith('/user') ? Response.json({ login: owner }) : Response.json([commit()], { headers: { link: `<https://api.github.com/repos/${owner}/Synthetic/commits?per_page=1&page=2>; rel="next"` } }); });
    const source = new LocalGithubSource(credentials, api as typeof fetch); const page = await source.history(repo, { page: 1, limit: 1 });
    expect(page).toMatchObject({ source: 'github_api', repoUrl: repo.url, nextPage: 2, complete: false, page: 1, limit: 1 }); expect(page.items[0]).toMatchObject({ hash: '1'.repeat(40), subject: 'A synthetic commit', message: 'A synthetic commit\n\nIts full body.', refs: [], url: `${repo.url}/commit/${'1'.repeat(40)}` });
    expect(Number.isFinite(Date.parse(page.fetchedAt))).toBe(true); expect(credentials.mock.calls).toHaveLength(1); expect(credentials.mock.calls[0][0]).toEqual(['credential', 'fill']); expect(requests.every(request => request.method === 'GET')).toBe(true); expect(requests).toHaveLength(2); expect(JSON.stringify(page)).not.toContain('SYNTHETIC_SECRET');
  });

  it('never follows arbitrary upstream pagination URLs or claims full remote history', async () => {
    let fetchCount = 0; const api = async (url: any) => { fetchCount++; return String(url).endsWith('/user') ? Response.json({ login: owner }) : Response.json([commit()], { headers: { link: '<https://evil.example/steal?page=2>; rel="next"' } }); };
    const source = new LocalGithubSource(async () => 'password=synthetic\n', api as typeof fetch); const result = await source.history(repo, { limit: 1 }); expect(result.nextPage).toBeNull(); expect(result.complete).toBe(false); expect(fetchCount).toBe(2);
  });

  it('rejects unknown query fields, name-only repositories and account mismatch before the commits request', async () => {
    for (const input of [{ page: 0 }, { page: 101 }, { limit: 51 }, { limit: '30' }, { ref: 'main' }, { url: 'https://evil.example' }]) expect(() => githubHistoryQuery(input)).toThrow();
    const api = vi.fn(async () => Response.json({ login: 'AnotherAccount' })); const source = new LocalGithubSource(async () => 'password=synthetic\n', api as typeof fetch);
    await expect(source.history({ ...repo, match: 'name' })).rejects.toThrow('origin'); expect(api).not.toHaveBeenCalled();
    await expect(source.history(repo)).rejects.toThrow(owner); expect(api).toHaveBeenCalledOnce();
  });

  it('redacts failed remote responses and rejects malformed commit identities', async () => {
    const source = (result: Response) => new LocalGithubSource(async () => 'password=SYNTHETIC_SECRET\n', (async (url: any) => String(url).endsWith('/user') ? Response.json({ login: owner }) : result) as typeof fetch);
    try { await source(new Response('SYNTHETIC_SECRET upstream private content', { status: 403 })).history(repo); throw Error('Should fail'); } catch (error) { expect(String(error)).not.toContain('SYNTHETIC_SECRET'); expect(String(error)).not.toContain('private content'); }
    await expect(source(Response.json([{ ...commit(), sha: '../escape' }])).history(repo)).rejects.toThrow('无效');
  });

  it('verifies current origin and reads only an existing visible project', async () => {
    const f = serviceFixture(); const before = readFileSync(f.file, 'utf8'); const result = await f.service.githubHistory(f.project.id, { limit: 2 }); expect(result.source).toBe('github_api'); expect(f.snapshot).toHaveBeenCalledExactlyOnceWith(f.project.path, f.commands); expect(f.source.history).toHaveBeenCalledExactlyOnceWith(f.project.repo, { page: 1, limit: 2 }); expect(f.commands).not.toHaveBeenCalled(); expect(readFileSync(f.file, 'utf8')).toBe(before);
    await expect(f.service.githubHistory('unknown')).rejects.toThrow('项目不存在'); expect(f.source.history).toHaveBeenCalledOnce();
  });

  it('denies name matches, unavailable adapters, changed origin and removed projects', async () => {
    const named = serviceFixture({ match: 'name' }); await expect(named.service.githubHistory(named.project.id)).rejects.toThrow('名称匹配'); expect(named.source.history).not.toHaveBeenCalled();
    const unavailable = serviceFixture({ history: false }); await expect(unavailable.service.githubHistory(unavailable.project.id)).rejects.toThrow('不支持'); expect(unavailable.snapshot).not.toHaveBeenCalled();
    const changed = serviceFixture({ origin: `https://github.com/${owner}/Different` }); await expect(changed.service.githubHistory(changed.project.id)).rejects.toThrow('origin'); expect(changed.source.history).not.toHaveBeenCalled();
    const removed = serviceFixture(); removed.service.remove(removed.project.id); await expect(removed.service.githubHistory(removed.project.id)).rejects.toThrow('项目不存在'); expect(removed.source.history).not.toHaveBeenCalled();
  });
});
