import { execFile } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { PersonalError } from './types';
import type { HistoryCommit } from './project-history';

export const GITHUB_OWNER = 'AlexShen-Oguri';
export function runGit(args: string[], cwd?: string, input?: string): Promise<string> {
  return new Promise((resolveValue, reject) => {
    const child = execFile('git', ['--no-optional-locks', ...args], { cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 30000, env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } }, (error, stdout) => error ? reject(new Error('Git operation failed.')) : resolveValue(stdout));
    if (input) child.stdin?.end(input);
  });
}
export interface GithubRepo { name: string; url: string; private: boolean; description?: string; match?: 'remote' | 'name' }
export interface GithubHistoryPage { source: 'github_api'; fetchedAt: string; repoUrl: string; items: HistoryCommit[]; nextPage: number | null; complete: false; page: number; limit: number }
export interface GithubSource { login(): Promise<string>; repos(): Promise<GithubRepo[]>; create(name: string, operationId: string): Promise<GithubRepo>; history?(repo: GithubRepo, value?: unknown): Promise<GithubHistoryPage> }
export function githubHistoryQuery(value: unknown = {}): { page: number; limit: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['page', 'limit'].includes(key))) throw new PersonalError('GitHub 提交历史查询无效');
  const input = value as Record<string, unknown>; const page = input.page ?? 1, limit = input.limit ?? 30;
  if (!Number.isInteger(page) || Number(page) < 1 || Number(page) > 100 || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 50) throw new PersonalError('GitHub 历史页码须为 1 至 100，每页提交数须为 1 至 50');
  return { page: Number(page), limit: Number(limit) };
}
export class LocalGithubSource implements GithubSource {
  constructor(private git: typeof runGit = runGit, private request: typeof fetch = fetch) {}
  private async credential(): Promise<string> {
    let credential = '';
    try { credential = await this.git(['credential', 'fill'], undefined, 'protocol=https\nhost=github.com\n\n'); } catch { throw new PersonalError('GitHub 登录不可用，请先使用 Git Credential Manager 登录 GitHub', 503); }
    const token = credential.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
    if (!token) throw new PersonalError('GitHub 登录不可用，请先登录 GitHub', 503);
    return token;
  }
  private async api(path: string, method = 'GET', body?: unknown, verifiedCredential?: string, metadata = false) {
    const token = verifiedCredential || await this.credential();
    let response;
    try { response = await this.request(`https://api.github.com${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'DailyHouse', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(20000) }); }
    catch { throw new PersonalError('GitHub 暂时无法连接，请稍后重试', 503); }
    if (!response.ok) throw new PersonalError(response.status === 404 ? 'GitHub 仓库不存在' : response.status === 422 ? 'GitHub 仓库名称已存在或无效' : 'GitHub 登录或权限验证失败，请检查账号权限', response.status === 404 ? 404 : response.status === 422 ? 409 : 503);
    let data: unknown; try { data = await response.json(); } catch { throw new PersonalError('GitHub 返回的资料格式无效，请稍后重试', 503); }
    return metadata ? { data, link: response.headers.get('link') } : data as any;
  }
  async login() { const data = await this.api('/user'); if (typeof data.login !== 'string' || data.login.toLowerCase() !== GITHUB_OWNER.toLowerCase()) throw new PersonalError(`请登录 ${GITHUB_OWNER} GitHub 账号`, 409); return data.login as string; }
  async repos() {
    await this.login(); const result: GithubRepo[] = [];
    for (let page = 1; page <= 10; page++) { const rows = await this.api(`/user/repos?affiliation=owner&per_page=100&page=${page}`); if (!Array.isArray(rows)) throw new PersonalError('GitHub 返回的仓库列表无效', 503); result.push(...rows.filter(r => r.owner?.login?.toLowerCase() === GITHUB_OWNER.toLowerCase()).map(r => this.present(r))); if (rows.length < 100) break; }
    return result;
  }
  private present(row: any): GithubRepo { if (typeof row.name !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(row.name) || row.owner?.login?.toLowerCase() !== GITHUB_OWNER.toLowerCase()) throw new PersonalError('GitHub 仓库资料无效', 503); return { name: row.name, url: `https://github.com/${GITHUB_OWNER}/${row.name}`, private: row.private === true, description: String(row.description || '') }; }
  async create(name: string, operationId: string) {
    await this.login(); const marker = `DailyHouse idea launch ${operationId}`;
    try { const existing = await this.api(`/repos/${GITHUB_OWNER}/${encodeURIComponent(name)}`); if (existing.description !== marker || existing.private !== true) throw new PersonalError('同名 GitHub 仓库已存在，请改一个名称；已有仓库不会被覆盖', 409); return this.present(existing); }
    catch (error) { if (!(error instanceof PersonalError) || error.status !== 404) throw error; }
    return this.present(await this.api('/user/repos', 'POST', { name, private: true, description: marker, auto_init: false }));
  }
  async history(repo: GithubRepo, value: unknown = {}): Promise<GithubHistoryPage> {
    const input = githubHistoryQuery(value);
    const canonical = githubRemote(repo.url); const match = canonical?.match(/^https:\/\/github\.com\/AlexShen-Oguri\/([A-Za-z0-9_.-]+)$/);
    if (repo.match !== 'remote' || !match || ['.', '..'].includes(match[1]) || match[1].toLowerCase() !== repo.name.toLowerCase()) throw new PersonalError('仅可查询已由当前 origin 验证的 GitHub 仓库', 409);
    // A single in-memory credential authorizes both the account check and this read.
    const token = await this.credential(); const actor = await this.api('/user', 'GET', undefined, token);
    if (typeof actor.login !== 'string' || actor.login.toLowerCase() !== GITHUB_OWNER.toLowerCase()) throw new PersonalError(`请登录 ${GITHUB_OWNER} GitHub 账号`, 409);
    const endpoint = `/repos/${GITHUB_OWNER}/${encodeURIComponent(match[1])}/commits`;
    const response = await this.api(`${endpoint}?per_page=${input.limit}&page=${input.page}`, 'GET', undefined, token, true);
    if (!Array.isArray(response.data) || response.data.length > input.limit) throw new PersonalError('GitHub 返回的提交历史无效', 503);
    const oid = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
    const items: HistoryCommit[] = response.data.map((row: any) => {
      const author = row?.commit?.author, committer = row?.commit?.committer, message = row?.commit?.message;
      if (!oid.test(row?.sha) || !author || !committer || typeof author.name !== 'string' || author.name.length > 4096 || typeof author.email !== 'string' || author.email.length > 4096 || typeof message !== 'string' || message.length > 65536 || typeof author.date !== 'string' || !Number.isFinite(Date.parse(author.date)) || typeof committer.date !== 'string' || !Number.isFinite(Date.parse(committer.date)) || !Array.isArray(row.parents) || row.parents.length > 100 || row.parents.some((parent: any) => !oid.test(parent?.sha))) throw new PersonalError('GitHub 返回的提交历史无效', 503);
      return { hash: row.sha, shortHash: row.sha.slice(0, 7), subject: message.split(/\r?\n/, 1)[0], message, author: { name: author.name, email: author.email }, authoredAt: author.date, committedAt: committer.date, parents: row.parents.map((parent: any) => parent.sha), refs: [], url: `${canonical}/commit/${row.sha}` };
    });
    let nextPage: number | null = null;
    if (input.page < 100) {
      const next = typeof response.link === 'string' ? /<([^>]+)>;\s*rel="next"/.exec(response.link)?.[1] : undefined;
      if (next) { try { const link = new URL(next); const nextNumber = Number(link.searchParams.get('page')); if (link.origin === 'https://api.github.com' && link.pathname.toLowerCase() === endpoint.toLowerCase() && Number.isInteger(nextNumber) && nextNumber === input.page + 1) nextPage = nextNumber; } catch { /* Never follow an upstream URL. */ } }
      else if (!response.link && items.length === input.limit) nextPage = input.page + 1;
    }
    return { source: 'github_api', fetchedAt: new Date().toISOString(), repoUrl: canonical!, items, nextPage, complete: false, ...input };
  }
}

export interface GitSnapshot { status: 'ready' | 'not_repository' | 'missing' | 'error'; source?: 'local_git'; readAt?: string; tipsSource?: 'remote_tracking'; remoteTrackingUpdatedAt?: string | null; path?: string; branch?: string; changedFiles?: number; ahead?: number; behind?: number; lastCommit?: { hash: string; subject: string; date: string }; remote?: string; hasOrigin?: boolean }
export function githubRemote(value: string) { const match = value.trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i); if (!match || match[1].toLowerCase() !== GITHUB_OWNER.toLowerCase()) return undefined; return `https://github.com/${GITHUB_OWNER}/${match[2]}`; }
export async function readGitSnapshot(root: string, git: typeof runGit = runGit): Promise<GitSnapshot> {
  const observed = () => ({ source: 'local_git' as const, readAt: new Date().toISOString(), tipsSource: 'remote_tracking' as const, remoteTrackingUpdatedAt: null });
  if (!existsSync(root)) return { status: 'missing', ...observed() };
  try {
    if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) return { status: 'error', ...observed() };
    let path = resolve(root);
    if (!existsSync(join(path, '.git'))) {
      const children = readdirSync(path, { withFileTypes: true }).filter(e => e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith('.') && !['node_modules', 'vendor', 'dist'].includes(e.name)).slice(0, 40).map(e => join(path, e.name)).filter(p => existsSync(join(p, '.git')));
      if (children.length !== 1) return { status: 'not_repository', ...observed() };
      path = children[0];
    }
    const [status, last, remote] = await Promise.all([git(['status', '--porcelain=v2', '--branch', '--untracked-files=all'], path), git(['log', '-1', '--format=%h%x00%s%x00%cI'], path).catch(() => ''), git(['remote', 'get-url', 'origin'], path).catch(() => '')]);
    const lines = status.split(/\r?\n/); const branch = lines.find(l => l.startsWith('# branch.head '))?.slice(14); const ab = lines.find(l => l.startsWith('# branch.ab '))?.match(/\+(\d+) -(\d+)/); const [hash, subject, date] = last.trim().split('\0');
    return { status: 'ready', ...observed(), path: realpathSync(path), branch, changedFiles: lines.filter(l => l && !l.startsWith('#')).length, ...(ab ? { ahead: Number(ab[1]), behind: Number(ab[2]) } : {}), ...(hash ? { lastCommit: { hash, subject, date } } : {}), hasOrigin: !!remote.trim(), ...(githubRemote(remote) ? { remote: githubRemote(remote) } : {}) };
  } catch { return { status: 'error', ...observed() }; }
}
export function matchGithubRepo(title: string, path: string, snapshot: GitSnapshot, repos: GithubRepo[]) {
  if (snapshot.remote) { const match = repos.find(r => r.url.toLowerCase() === snapshot.remote!.toLowerCase()); if (match) return { ...match, match: 'remote' as const }; }
  if (snapshot.hasOrigin || snapshot.remote) return undefined;
  const names = new Set([title.toLowerCase(), basename(snapshot.path || path).toLowerCase()]); const matches = repos.filter(r => names.has(r.name.toLowerCase()));
  return matches.length === 1 ? { ...matches[0], match: 'name' as const } : undefined;
}
