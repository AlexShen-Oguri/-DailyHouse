import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { CodexProjectClient, type CodexProject, type CodexThread, type ProjectRpc } from './codex-project-client';
import { GITHUB_OWNER, LocalGithubSource, githubHistoryQuery, matchGithubRepo, readGitSnapshot, runGit, type GithubRepo, type GithubSource, type GitSnapshot } from './project-sources';
import { PersonalError } from './types';
import { ProjectHistory } from './project-history';
import { nativeHandoffRecipe, type DevelopmentToolsService, type DevelopmentTool, type NativeHandoffRecipe } from './development-tools';

export interface ResumeThread { id: string; title: string; preview: string; updatedAt: string; url: string; status: string; latest?: { request: string; response: string; status: string; updatedAt: string | null } }
export interface ResumeProject { id: string; title: string; path: string; source: 'codex' | 'launched'; codexProjectId?: string; developmentTool?: DevelopmentTool; manualHandoff?: NativeHandoffRecipe; repo?: GithubRepo; git: GitSnapshot; threads: ResumeThread[]; resumeCommand: string }
interface Integration { status: 'ready' | 'error' | 'unconfigured'; message: string; login?: string }
export interface ResumeState { items: ResumeProject[]; trashCount: number; updatedAt: string | null; integrations: { codex: Integration; github: Integration } }
export interface ProjectLaunch { id: string; ideaId: string; name: string; repoName: string; path: string; kind?: 'repository'; developmentTool?: DevelopmentTool; manualHandoff?: NativeHandoffRecipe; status: 'running' | 'failed' | 'ready' | 'awaiting_manual_handoff'; step: 'workspace' | 'github' | 'codex' | 'handoff' | 'complete'; message?: string; issue?: 'empty_thread' | 'thread_busy'; repoUrl?: string; codexProjectId?: string; threadId?: string; threadUrl?: string; createdAt: string; updatedAt: string }
interface SavedLaunch extends ProjectLaunch { context?: unknown; markdown?: string; workspaceReady?: boolean; repositoryPushed?: boolean; handoffAttempted?: boolean; replacedThreadIds?: string[] }
interface ProjectTrash { item: ResumeProject; deletedAt: string; expiresAt: string }
interface SavedProjects { version: 1; cache: ResumeState; trash: ProjectTrash[]; hidden: string[]; launches: SavedLaunch[]; removedLaunches: { ideaId: string; repoName: string }[]; lastDeletedAt?: string; actionPurgeIds?: string[] }
export interface IdeaHandoff { repositoryTitle(id: string): string }
export interface ProjectResumeOptions { rpc?: ProjectRpc; github?: GithubSource; git?: typeof runGit; workspaceRoot?: string; snapshot?: typeof readGitSnapshot; history?: ProjectHistory; developmentTools?: Pick<DevelopmentToolsService, 'requireAuthenticated'> }
const TRASH_MS = 30 * 86400000;
const timestamp = () => new Date().toISOString();
const pathKey = (path: string) => { const normalized = resolve(path); return process.platform === 'win32' ? normalized.toLowerCase() : normalized; };
function fields(value: unknown, keys: string[]) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new PersonalError('请求包含无效字段'); return value as Record<string, unknown>; }
function selectedIds(value: unknown) { if (!Array.isArray(value) || value.length < 1 || value.length > 100 || value.some(id => typeof id !== 'string' || id.length > 150)) throw new PersonalError('请选择有效项目'); return [...new Set(value)] as string[]; }
function publicLaunch(item: SavedLaunch): ProjectLaunch { const { context: _context, markdown: _markdown, workspaceReady: _workspaceReady, repositoryPushed: _repositoryPushed, handoffAttempted: _handoffAttempted, replacedThreadIds: _replacedThreadIds, ...result } = item; return structuredClone(result); }
function cleanThread(thread: CodexThread): ResumeThread { return { id: thread.id, title: thread.name || thread.preview.slice(0, 80) || 'Codex', preview: thread.preview.slice(0, 1200), updatedAt: new Date(thread.updatedAt * 1000).toISOString(), url: `codex://threads/${encodeURIComponent(thread.id)}`, status: thread.status?.type || 'notLoaded' }; }
function userRequestText(value: string) {
  // Only remove the app's leading ambient-browser envelope. User-authored XML,
  // quoted examples and question-reply blocks retain their original content.
  return value.trimStart().replace(/^<in-app-browser-context\s+source=(['"])ambient-ui-state\1>[^]*?<\/in-app-browser-context>\s*/, '').replace(/^## My request:[ \t]*(?:\r?\n)?/, '').trimStart();
}
export function latestTurnSummary(turn: any): ResumeThread['latest'] {
  if (!turn || !Array.isArray(turn.items)) return undefined;
  const user = turn.items.find((item: any) => item.type === 'userMessage');
  const assistant = [...turn.items].reverse().find((item: any) => item.type === 'agentMessage' && typeof item.text === 'string');
  const request = Array.isArray(user?.content) ? userRequestText(user.content.filter((c: any) => c.type === 'text' && typeof c.text === 'string').map((c: any) => c.text).join('\n')).slice(0, 2000) : '';
  const response = typeof assistant?.text === 'string' ? assistant.text.slice(0, 3000) : '';
  if (!request && !response) return undefined;
  const time = turn.completedAt || turn.startedAt;
  return { request, response, status: String(turn.status || 'unknown'), updatedAt: typeof time === 'number' ? new Date(time > 100000000000 ? time : time * 1000).toISOString() : null };
}

export class ProjectResumeService {
  private data: SavedProjects;
  private rpc: ProjectRpc;
  private github: GithubSource;
  private git: typeof runGit;
  private snapshot: typeof readGitSnapshot;
  private commitHistory: ProjectHistory;
  readonly workspaceRoot: string;
  private refreshing?: Promise<ResumeState>;
  private running = new Map<string, Promise<void>>();
  constructor(private file: string, private ideas: IdeaHandoff, options: ProjectResumeOptions = {}) {
    this.rpc = options.rpc || new CodexProjectClient(); this.github = options.github || new LocalGithubSource(); this.git = options.git || runGit; this.snapshot = options.snapshot || readGitSnapshot;
    this.commitHistory = options.history || new ProjectHistory();
    this.workspaceRoot = resolve(options.workspaceRoot || process.env.WORKBENCH_PROJECTS_DIR || join(homedir(), 'Documents', 'DailyHouseProjects'));
    this.data = { version: 1, cache: { items: [], trashCount: 0, updatedAt: null, integrations: { codex: { status: 'unconfigured', message: '尚未读取 Codex 项目' }, github: { status: 'unconfigured', message: '尚未验证 GitHub' } } }, trash: [], hidden: [], launches: [], removedLaunches: [] };
    if (existsSync(file)) { const data = JSON.parse(readFileSync(file, 'utf8')); if (data.version !== 1 || !Array.isArray(data.hidden) || !Array.isArray(data.trash) || !Array.isArray(data.launches) || !Array.isArray(data.cache?.items)) throw new Error('Project resume data is invalid. Restore a backup before starting.'); this.data = { ...data, removedLaunches: data.removedLaunches || [] }; for (const launch of this.data.launches) if (launch.status === 'running') { launch.status = 'failed'; launch.message = '工作台已重启。可手动重试 GitHub 私有仓库创建；原有外部资源保留，不再自动交接。'; } }
  }
  private save() {
    this.data.actionPurgeIds = this.actionPurgeIds();
    const expired = new Set(this.data.trash.filter(t => Date.parse(t.expiresAt) <= Date.now()).map(t => t.item.codexProjectId || t.item.id));
    this.forgetOperations(this.data.launches.filter(l => expired.has(l.codexProjectId || l.id) && l.status !== 'running'));
    this.data.trash = this.data.trash.filter(t => Date.parse(t.expiresAt) > Date.now());
    this.data.cache.items = this.data.cache.items.filter(p => !this.data.hidden.includes(pathKey(p.path)));
    mkdirSync(dirname(this.file), { recursive: true }); writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 }); renameSync(`${this.file}.tmp`, this.file);
  }
  private visible() { const hidden = new Set(this.data.hidden); return structuredClone({ ...this.data.cache, items: this.data.cache.items.filter(p => !hidden.has(pathKey(p.path))), trashCount: this.data.trash.filter(t => Date.parse(t.expiresAt) > Date.now()).length }); }
  cachedProject(id: string): ResumeProject | undefined { return this.visible().items.find(item => item.id === id); }
  actionPurgeIds(): string[] { return [...new Set([...(this.data.actionPurgeIds || []), ...this.data.trash.filter(item => Date.parse(item.expiresAt) <= Date.now()).map(item => item.item.id)])]; }
  async list() { return this.data.cache.updatedAt ? this.visible() : this.refresh(); }
  async history(id: string, query: unknown) {
    const project = (await this.list()).items.find(item => item.id === id);
    if (!project) throw new PersonalError('项目不存在或已从小院移除，请刷新项目列表', 404);
    const page = await this.commitHistory.page(project, query);
    if (this.data.hidden.includes(pathKey(project.path))) { this.commitHistory.invalidate(id); throw new PersonalError('项目不存在或已从小院移除，请刷新项目列表', 404); }
    return page;
  }
  async githubHistory(id: string, query: unknown = {}) {
    const input = githubHistoryQuery(query);
    // Use the established visible cache; this explicit read never registers a project.
    const project = this.cachedProject(id);
    if (!project) throw new PersonalError('项目不存在或已从小院移除，请刷新项目列表', 404);
    if (!project.repo || project.repo.match !== 'remote') throw new PersonalError('请先通过当前项目 origin 验证 GitHub 仓库，名称匹配不能用于远程历史', 409);
    if (!this.github.history) throw new PersonalError('当前 GitHub 连接不支持提交历史读取，请检查本机连接', 503);
    const snapshot = await this.snapshot(project.path, this.git);
    if (snapshot.status !== 'ready' || snapshot.remote?.toLowerCase() !== project.repo.url.toLowerCase() || this.data.hidden.includes(pathKey(project.path))) throw new PersonalError('当前 origin 与已关联仓库不一致，未读取 GitHub 历史；请刷新后核对', 409);
    const page = await this.github.history(project.repo, input);
    if (this.data.hidden.includes(pathKey(project.path))) throw new PersonalError('项目已从小院移除，未显示提交历史', 404);
    return page;
  }
  refresh() { if (!this.refreshing) this.refreshing = this.collect().finally(() => { this.refreshing = undefined; }); return this.refreshing; }
  private async collect() {
    let projects: CodexProject[] = []; let repos: GithubRepo[] = []; const integrations = structuredClone(this.data.cache.integrations);
    await Promise.all([
      (async () => { try { let cursor: string | undefined; for (let page = 0; page < 20; page++) { const result: { data: CodexProject[]; nextCursor?: string } = await this.rpc.call('project/list', { limit: 100, ...(cursor ? { cursor } : {}) }); projects.push(...result.data); cursor = result.nextCursor; if (!cursor) break; } integrations.codex = { status: 'ready', message: '已从 Codex 读取项目与最近对话' }; } catch { integrations.codex = { status: 'error', message: 'Codex 暂时无法读取，保留上次结果；请检查本机 Codex CLI 后刷新' }; } })(),
      (async () => { try { repos = await this.github.repos(); integrations.github = { status: 'ready', login: GITHUB_OWNER, message: '已验证 GitHub 账号并匹配仓库' }; } catch (error) { integrations.github = { status: 'error', message: error instanceof PersonalError ? error.message : 'GitHub 暂时无法连接' }; } })(),
    ]);
    if (integrations.codex.status === 'ready') {
      // Codex can contain historical duplicate registrations. One local folder
      // is one resume card; preserving the newest registration avoids duplicates.
      const unique = new Map<string, { project: CodexProject; path: string }>();
      for (const project of projects) for (const root of project.roots) { if (!root.path || !/^(?:[A-Za-z]:[\\/]|\/)/.test(root.path) || root.path.startsWith('\\\\') || root.path.startsWith('//')) continue; const key = pathKey(root.path); const previous = unique.get(key); if (!previous || previous.project.updatedAt < project.updatedAt) unique.set(key, { project, path: root.path }); }
      const items: ResumeProject[] = [];
      // Bound child-process fan-out: repositories are read, never fetched or changed.
      for (const { project, path } of unique.values()) {
        if (this.data.hidden.includes(pathKey(path))) continue;
        const git = await this.snapshot(path, this.git); let threads: ResumeThread[] = [];
        try { const result = await this.rpc.call<{ data: CodexThread[] }>('thread/list', { cwd: [...new Set([path, git.path].filter(Boolean))], limit: 5, sortKey: 'updated_at', useStateDbOnly: true, sourceKinds: ['cli', 'vscode', 'exec', 'appServer'] }); threads = result.data.filter(t => /^[A-Za-z0-9-]+$/.test(t.id)).map(cleanThread); } catch { /* Git remains useful when thread history is unavailable. */ }
        if (threads[0]) { try { const recent = await this.rpc.call<{ data: unknown[] }>('thread/turns/list', { threadId: threads[0].id, limit: 1, sortDirection: 'desc', itemsView: 'summary' }); const summary = latestTurnSummary(recent.data[0]); if (summary) threads[0].latest = summary; } catch { /* Opening preview remains explicitly distinguishable from a latest turn. */ } }
        const repo = matchGithubRepo(project.name, path, git, repos); const latest = threads[0];
        const id = project.roots.length > 1 ? `${project.id}:${createHash('sha256').update(pathKey(path)).digest('hex').slice(0, 12)}` : project.id;
        items.push({ id, title: project.name, path, source: this.data.launches.some(l => l.codexProjectId === project.id) ? 'launched' : 'codex', codexProjectId: project.id, ...(repo ? { repo } : {}), git, threads, resumeCommand: latest ? `codex resume ${latest.id}` : `codex -C '${path.replaceAll("'", "''")}'` });
      }
      this.data.cache.items = items.filter(p => !this.data.hidden.includes(pathKey(p.path)));
    }
    // Claude's native sessions stay device-local and are not discoverable from
    // Codex. Keep the website-owned launch identity visible without fabricating
    // an external project or conversation ID.
    this.data.cache.items = this.data.cache.items.filter(p => p.developmentTool !== 'claude');
    for (const launch of this.data.launches.filter(item => item.developmentTool === 'claude' && item.status === 'awaiting_manual_handoff')) {
      if (this.data.hidden.includes(pathKey(launch.path))) continue;
      const git = await this.snapshot(launch.path, this.git);
      this.data.cache.items.push({ id: launch.id, title: launch.name, path: launch.path, source: 'launched', developmentTool: 'claude', git, threads: [], resumeCommand: 'claude', manualHandoff: nativeHandoffRecipe('claude', launch.path, '.dailyhouse/inspiration.md'), ...(launch.repoUrl ? { repo: { name: launch.repoName, url: launch.repoUrl, private: true, match: 'remote' } } : {}) });
    }
    this.data.cache.integrations = integrations; this.data.cache.updatedAt = timestamp(); this.save(); return this.visible();
  }
  trash() { return { items: structuredClone(this.data.trash.filter(t => Date.parse(t.expiresAt) > Date.now())) }; }
  remove(id: string) { const item = this.data.cache.items.find(p => p.id === id); if (!item) throw new PersonalError('项目不存在，请先刷新', 404); this.commitHistory.invalidate(id); const key = pathKey(item.path); if (!this.data.hidden.includes(key)) this.data.hidden.push(key); if (!this.data.trash.some(t => t.item.id === id)) { const deleted = Math.max(Date.now(), (Date.parse(this.data.lastDeletedAt || '') || 0) + 1); const deletedAt = new Date(deleted).toISOString(); this.data.lastDeletedAt = deletedAt; this.data.trash.unshift({ item: structuredClone(item), deletedAt, expiresAt: new Date(deleted + TRASH_MS).toISOString() }); } this.save(); }
  restore(value: unknown) { const ids = selectedIds(fields(value, ['ids']).ids); const available = this.trash().items; if (ids.some(id => !available.some(t => t.item.id === id))) throw new PersonalError('回收站记录不存在或已到期', 410); const restored = available.filter(t => ids.includes(t.item.id)); const paths = new Set(restored.map(t => pathKey(t.item.path))); this.data.hidden = this.data.hidden.filter(p => !paths.has(p)); this.data.cache.items = [...this.data.cache.items.filter(p => !paths.has(pathKey(p.path))), ...restored.map(t => t.item)]; this.data.trash = this.data.trash.filter(t => !ids.includes(t.item.id)); this.save(); return { restoredIds: ids }; }
  purge(value: unknown) { const body = fields(value, ['ids', 'confirm', 'deletedAt']); if (body.confirm !== true) throw new PersonalError('请确认永久移除网站记录'); const ids = selectedIds(body.ids); if (ids.some(id => !this.data.trash.some(t => t.item.id === id))) throw new PersonalError('回收站记录不存在', 404); const deletedAt = fields(body.deletedAt, ids); if (ids.some(id => !Object.hasOwn(deletedAt, id) || deletedAt[id] !== this.data.trash.find(t => t.item.id === id)!.deletedAt)) throw new PersonalError('回收站记录已变化，请刷新后重新确认永久删除', 409); const projects = new Set(this.data.trash.filter(t => ids.includes(t.item.id)).map(t => t.item.codexProjectId || t.item.id)); const operations = this.data.launches.filter(l => projects.has(l.codexProjectId || l.id)); if (operations.some(l => l.status === 'running')) throw new PersonalError('项目仍在交接，完成后才能永久移除网站记录', 409); this.forgetOperations(operations); this.data.actionPurgeIds = [...new Set([...(this.data.actionPurgeIds || []), ...ids])]; this.data.cache.items = this.data.cache.items.filter(p => !ids.includes(p.id)); this.data.trash = this.data.trash.filter(t => !ids.includes(t.item.id)); this.save(); return { purgedIds: ids }; }
  private forgetOperations(items: SavedLaunch[]) { const ids = new Set(items.map(l => l.id)); this.data.removedLaunches.push(...items.map(l => ({ ideaId: l.ideaId, repoName: l.repoName }))); this.data.launches = this.data.launches.filter(l => !ids.has(l.id)); }
  removeOperation(id: string, value: unknown) { const body = fields(value, ['confirm']); if (body.confirm !== true) throw new PersonalError('请确认永久移除小院仓库记录，GitHub 仓库与其他外部资源会保留'); const item = this.data.launches.find(l => l.id === id); if (!item) throw new PersonalError('立项记录不存在', 404); if (item.status === 'running' || this.running.has(id)) throw new PersonalError('正在创建的记录暂时不能删除', 409); this.forgetOperations([item]); this.save(); }
  launchForIdea(id: string) { const item = this.data.launches.find(l => l.ideaId === id); return { operation: item ? publicLaunch(item) : null, removed: this.data.removedLaunches.some(l => l.ideaId === id), defaults: { githubOwner: GITHUB_OWNER, repositoryVisibility: 'private' as const } }; }
  operation(id: string) { const item = this.data.launches.find(l => l.id === id); if (!item) throw new PersonalError('立项记录不存在', 404); return { operation: publicLaunch(item) }; }
  launch(ideaId: string, value: unknown) {
    // Keep the old URL and optional name compatible with cached pages. Creation
    // now has one purpose: an empty private remote repository, with no handoff.
    const body = fields(value, ['name', 'repoName', 'confirm']);
    if (body.confirm !== true) throw new PersonalError('请确认创建空的 GitHub 私有仓库');
    if (typeof body.repoName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(body.repoName) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(body.repoName) || body.repoName.endsWith('.') || body.repoName.endsWith('.git')) throw new PersonalError('仓库名称请使用英文字母、数字、短横线或下划线（最长 80 字符）');
    const existing = this.data.launches.find(l => l.ideaId === ideaId); if (existing) return { operation: publicLaunch(existing) };
    if (this.data.removedLaunches.some(l => l.ideaId === ideaId)) throw new PersonalError('这个灵感的仓库记录已移除，外部资源仍保留。请打开原仓库，避免重复创建。', 409);
    if ([...this.data.launches, ...this.data.removedLaunches].some(l => l.repoName.toLowerCase() === (body.repoName as string).toLowerCase())) throw new PersonalError('这个仓库名已用于另一个灵感，请更换名称', 409);
    const name = this.ideas.repositoryTitle(ideaId); const now = timestamp();
    const item: SavedLaunch = { id: randomUUID(), ideaId, name, repoName: body.repoName, path: '', kind: 'repository', status: 'running', step: 'github', createdAt: now, updatedAt: now };
    this.data.launches.unshift(item); this.save(); this.schedule(item); return { operation: publicLaunch(item) };
  }
  retry(id: string, value: unknown = {}) {
    fields(value, []); // Removed Codex-repair options must never create a thread.
    const item = this.data.launches.find(l => l.id === id); if (!item) throw new PersonalError('仓库记录不存在', 404);
    if (item.status === 'ready' || item.status === 'awaiting_manual_handoff' || this.running.has(id)) return { operation: publicLaunch(item) };
    item.status = 'running'; item.step = 'github'; delete item.message; delete item.issue;
    this.save(); this.schedule(item); return { operation: publicLaunch(item) };
  }
  private schedule(item: SavedLaunch) {
    const promise = this.provision(item).catch(error => {
      item.status = 'failed'; item.message = error instanceof PersonalError ? error.message : 'GitHub 仓库创建未完成，请检查本机 GitHub 登录与连接后重试。';
      item.updatedAt = timestamp(); this.save();
    }).finally(() => this.running.delete(item.id));
    this.running.set(item.id, promise);
  }
  async idle() { await Promise.all(this.running.values()); }
  private async provision(item: SavedLaunch) {
    await this.github.login();
    const repository = await this.github.create(item.repoName, item.id);
    if (repository.private !== true || repository.name !== item.repoName || repository.url !== `https://github.com/${GITHUB_OWNER}/${item.repoName}`) throw new PersonalError('未能核验仓库名称、归属或私有状态，停止并保留当前记录。请在 GitHub 核对后重试。', 409);
    // Legacy launch context and external identities remain untouched. A retry
    // verifies only this operation's marked repository, never its old workflow.
    item.repoUrl = repository.url; item.kind = 'repository'; item.status = 'ready'; item.step = 'complete'; delete item.message; delete item.issue;
    item.updatedAt = timestamp(); this.save();
  }
  close() { this.rpc.close(); }
}
