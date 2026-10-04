import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectResumeService, latestTurnSummary } from '../src/personal/project-resume';
import { type ProjectRpc } from '../src/personal/codex-project-client';
import { once } from 'node:events';
import { createPersonalApp } from '../src/personal/app';
import { PersonalStore } from '../src/personal/store';
import type { GithubSource } from '../src/personal/project-sources';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dailyhouse-projects-')); dirs.push(dir);
  const repoPath = join(dir, 'existing'); mkdirSync(repoPath); writeFileSync(join(repoPath, 'keep.txt'), 'original');
  let origin = ''; let initialized = false;
  const git = vi.fn(async (args: string[], cwd?: string) => { if (args[0] === 'init') { initialized = true; mkdirSync(join(cwd!, '.git'), { recursive: true }); } if (args[0] === 'rev-parse') { if (!initialized) throw Error(); return 'abc'; } if (args[0] === 'remote' && args[1] === 'get-url') return origin; if (args[0] === 'remote' && args[1] === 'add') origin = args[3]; return ''; });
  const rpc: ProjectRpc = { call: vi.fn(async (method: string, params: any) => { if (method === 'project/list') return { data: [{ id: 'old', name: 'Old', roots: [{ path: repoPath }], updatedAt: 1 }, { id: 'existing', name: 'Garden', roots: [{ path: repoPath }], updatedAt: 2 }] }; if (method === 'thread/loaded/list') return { data: [] }; if (method === 'thread/list') return { data: params.projectId ? [] : [{ id: 'thread-1', name: 'Real task', preview: 'Last user context', cwd: repoPath, updatedAt: 1000 }] }; if (method === 'project/create') return { project: { id: 'created-project' } }; if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: 'created-thread' } }; if (method === 'turn/start') return { turn: { id: 'first-turn' } }; if (method === 'thread/read') return { thread: { turns: [] } }; throw Error(method); }) as any, close: vi.fn() };
  const github: GithubSource = { login: vi.fn(async () => 'AlexShen-Oguri'), repos: vi.fn(async () => [{ name: 'Garden', url: 'https://github.com/AlexShen-Oguri/Garden', private: true }]), create: vi.fn(async name => ({ name, url: `https://github.com/AlexShen-Oguri/${name}`, private: true })) };
  const ideas = { repositoryTitle: vi.fn(() => 'My idea') };
  const file = join(dir, 'state.json');
  const developmentTools = { requireAuthenticated: vi.fn(async () => ({})) };
  const service = new ProjectResumeService(file, ideas, { rpc, github, git, developmentTools: developmentTools as any, workspaceRoot: join(dir, 'new'), snapshot: async () => ({ status: 'ready', branch: 'main', changedFiles: 2, remote: 'https://github.com/AlexShen-Oguri/Garden', hasOrigin: true }) });
  return { dir, repoPath, service, rpc, github, git, ideas, file, developmentTools };
}
describe('actual project resume state', () => {
  it('allows history only for an active known project, never an arbitrary path or a removed project', async () => { const f = fixture(); await f.service.refresh(); await expect(f.service.history('C:/private/arbitrary-repository', {})).rejects.toMatchObject({ status: 404 }); expect((await f.service.history('existing', {})).status).toBe('not_repository'); f.service.remove('existing'); await expect(f.service.history('existing', {})).rejects.toMatchObject({ status: 404 }); });
  it('removes only the known leading ambient envelope before truncating the actual user request', () => { const summarize = (text: string) => latestTurnSummary({ items: [{ type: 'userMessage', content: [{ type: 'text', text }] }] })?.request; const request = '请继续完善项目续航。\n保留这些 <notes>我的内容</notes>。'; expect(summarize(`\n<in-app-browser-context source="ambient-ui-state">${'Browser metadata '.repeat(200)}</in-app-browser-context>\n\n## My request:\n${request}`)).toBe(request); expect(summarize(`## My request:\n${request}`)).toBe(request); for (const original of ['<in-app-browser-context source="my-example">Keep this</in-app-browser-context>', '```xml\n<in-app-browser-context source="ambient-ui-state">Quoted example</in-app-browser-context>\n```', '<send_user_message_question_reply>Keep the answer</send_user_message_question_reply>']) expect(summarize(original)).toBe(original); });
  it('rejects a stale purge dialog after restore and re-delete, even within the same millisecond', async () => { const f = fixture(); await f.service.refresh(); const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now()); try { f.service.remove('existing'); const stale = f.service.trash().items[0].deletedAt; f.service.restore({ ids: ['existing'] }); f.service.remove('existing'); const current = f.service.trash().items[0].deletedAt; expect(current).not.toBe(stale); expect(() => f.service.purge({ ids: ['existing'], confirm: true, deletedAt: { existing: stale } })).toThrow('已变化'); expect(f.service.trash().items).toHaveLength(1); expect(() => f.service.purge({ ids: ['existing'], confirm: true, deletedAt: {} })).toThrow('已变化'); f.service.purge({ ids: ['existing'], confirm: true, deletedAt: { existing: current } }); expect(f.service.trash().items).toHaveLength(0); } finally { clock.mockRestore(); } });
  it('extracts only actual user and assistant text from the latest turn, excluding tool outputs', () => { expect(latestTurnSummary({ startedAt: 123000, status: 'completed', items: [{ type: 'userMessage', content: [{ type: 'text', text: 'Latest request' }] }, { type: 'commandExecution', text: 'secret command output' }, { type: 'agentMessage', text: 'Verified latest work' }] })).toMatchObject({ request: 'Latest request', response: 'Verified latest work', status: 'completed' }); expect(latestTurnSummary({ items: [{ type: 'commandExecution', text: 'not a summary' }] })).toBeUndefined(); });
  it('deduplicates Codex roots, prioritizes newest registration and presents real Git and thread evidence', async () => { const f = fixture(); const state = await f.service.refresh(); expect(state.items).toHaveLength(1); expect(state.items[0]).toMatchObject({ id: 'existing', title: 'Garden', git: { changedFiles: 2 }, repo: { match: 'remote' }, threads: [{ title: 'Real task', preview: 'Last user context' }] }); expect(state.integrations.github.status).toBe('ready'); });
  it('remove, restore, purge never changes external repositories or Codex registry', async () => { const f = fixture(); await f.service.refresh(); f.service.remove('existing'); expect((await f.service.list()).items).toHaveLength(0); expect(f.service.trash().items).toHaveLength(1); f.service.restore({ ids: ['existing'] }); expect((await f.service.list()).items).toHaveLength(1); f.service.remove('existing'); expect(() => f.service.purge({ ids: ['existing'] })).toThrow(); f.service.purge({ ids: ['existing'], confirm: true, deletedAt: { existing: f.service.trash().items[0].deletedAt } }); vi.mocked(f.rpc.call).mockClear(); await f.service.refresh(); expect((await f.service.list()).items).toHaveLength(0); expect(f.service.trash().items).toHaveLength(0); expect(vi.mocked(f.rpc.call).mock.calls.map(c => c[0])).toEqual(['project/list']); expect(readFileSync(join(f.repoPath, 'keep.txt'), 'utf8')).toBe('original'); expect(f.git).not.toHaveBeenCalled(); expect(readFileSync(f.file, 'utf8')).not.toContain('Last user context'); });
  it('retains cached evidence with explicit offline status', async () => { const f = fixture(); await f.service.refresh(); vi.mocked(f.rpc.call).mockRejectedValue(Error('offline')); vi.mocked(f.github.repos).mockRejectedValue(Error('offline')); const state = await f.service.refresh(); expect(state.items).toHaveLength(1); expect(state.integrations.codex.status).toBe('error'); expect(state.integrations.github.status).toBe('error'); });
  it('gives each root a stable identity and hides only the selected root', async () => { const f = fixture(); const second = join(f.dir, 'second'); mkdirSync(second); const original = f.rpc.call; f.rpc.call = vi.fn(async (method, params) => method === 'project/list' ? { data: [{ id: 'multi', name: 'Multi', roots: [{ path: f.repoPath }, { path: second }], updatedAt: 1 }] } : original(method, params)) as any; const before = await f.service.refresh(); expect(new Set(before.items.map(p => p.id)).size).toBe(2); f.service.remove(before.items[0].id); const after = await f.service.refresh(); expect(after.items).toHaveLength(1); expect(after.items[0].id).toBe(before.items[1].id); f.service.purge({ ids: [before.items[0].id], confirm: true, deletedAt: { [before.items[0].id]: f.service.trash().items[0].deletedAt } }); expect((await f.service.list()).items).toHaveLength(1); });
  it('does not resurrect purged private previews during an in-flight refresh', async () => { const f = fixture(); await f.service.refresh(); let release!: () => void; const block = new Promise<void>(resolve => { release = resolve; }); const original = f.rpc.call; let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); f.rpc.call = vi.fn(async (method, params) => { if (method === 'thread/list') { entered(); await block; } return original(method, params); }) as any; const refresh = f.service.refresh(); await started; f.service.remove('existing'); f.service.purge({ ids: ['existing'], confirm: true, deletedAt: { existing: f.service.trash().items[0].deletedAt } }); release(); await refresh; expect(readFileSync(f.file, 'utf8')).not.toContain('Last user context'); expect((await f.service.list()).items).toHaveLength(0); });
});
describe('confirmed private repository creation', () => {
  const body = { repoName: 'my-idea', confirm: true };
  it('requires confirmation, validates names and rejects extra scope', () => {
    const f = fixture();
    for (const bad of [{ ...body, confirm: false }, { ...body, repoName: '../escape' }, { ...body, repoName: 'CON' }, { ...body, repoName: 'idea.git' }, { ...body, path: f.dir }, { ...body, private: false }]) expect(() => f.service.launch('idea', bad)).toThrow();
    expect(f.ideas.repositoryTitle).not.toHaveBeenCalled(); expect(f.github.create).not.toHaveBeenCalled();
  });
  it('creates only an empty private remote repository once, without a workspace, private context or Codex', async () => {
    const f = fixture(); const first = f.service.launch('idea', body); const repeated = f.service.launch('idea', body);
    expect(first.operation.id).toBe(repeated.operation.id); await f.service.idle();
    expect(f.service.operation(first.operation.id).operation).toMatchObject({ kind: 'repository', path: '', status: 'ready', step: 'complete', repoUrl: 'https://github.com/AlexShen-Oguri/my-idea' });
    expect(f.github.create).toHaveBeenCalledExactlyOnceWith('my-idea', first.operation.id); expect(f.rpc.call).not.toHaveBeenCalled(); expect(f.developmentTools.requireAuthenticated).not.toHaveBeenCalled(); expect(f.git).not.toHaveBeenCalled(); expect(existsSync(join(f.dir, 'new'))).toBe(false);
    const saved = JSON.parse(readFileSync(f.file, 'utf8')).launches[0]; for (const field of ['context', 'markdown', 'threadId', 'codexProjectId']) expect(saved).not.toHaveProperty(field);
    f.service.retry(first.operation.id); await f.service.idle(); expect(f.github.create).toHaveBeenCalledOnce();
  });
  it('does not depend on or touch an existing local folder or unavailable Codex', async () => {
    const f = fixture(); mkdirSync(join(f.dir, 'new', 'my-idea'), { recursive: true }); writeFileSync(join(f.dir, 'new', 'my-idea', 'keep.txt'), 'keep'); vi.mocked(f.rpc.call).mockRejectedValue(Error('Codex absent'));
    const { operation } = f.service.launch('idea', { ...body, name: 'Ignored old-client title' }); await f.service.idle(); expect(f.service.operation(operation.id).operation.status).toBe('ready'); expect(readFileSync(join(f.dir, 'new', 'my-idea', 'keep.txt'), 'utf8')).toBe('keep'); expect(f.git).not.toHaveBeenCalled(); expect(f.rpc.call).not.toHaveBeenCalled();
  });
  it('retries GitHub failure with the same marker and no other external work', async () => {
    const f = fixture(); vi.mocked(f.github.create).mockRejectedValueOnce(Error('offline'));
    const { operation } = f.service.launch('idea', body); await f.service.idle(); expect(f.service.operation(operation.id).operation).toMatchObject({ status: 'failed', step: 'github' });
    f.service.retry(operation.id); await f.service.idle(); expect(f.service.operation(operation.id).operation.status).toBe('ready'); expect(vi.mocked(f.github.create).mock.calls).toEqual([['my-idea', operation.id], ['my-idea', operation.id]]); expect(f.rpc.call).not.toHaveBeenCalled(); expect(f.git).not.toHaveBeenCalled();
  });
  it('failed account preflight does not create a repository or workspace', async () => {
    const f = fixture(); vi.mocked(f.github.login).mockRejectedValue(Error('wrong account')); const { operation } = f.service.launch('idea', body); await f.service.idle();
    expect(f.service.operation(operation.id).operation.status).toBe('failed'); expect(f.github.create).not.toHaveBeenCalled(); expect(existsSync(join(f.dir, 'new'))).toBe(false); expect(f.rpc.call).not.toHaveBeenCalled();
  });
  it.each([{ private: false }, { name: 'other' }, { url: 'https://github.com/another/my-idea' }])('does not claim success for an unverified repository: %j', async invalid => {
    const f = fixture(); vi.mocked(f.github.create).mockResolvedValue({ name: 'my-idea', url: 'https://github.com/AlexShen-Oguri/my-idea', private: true, ...invalid }); const { operation } = f.service.launch('idea', body); await f.service.idle(); expect(f.service.operation(operation.id).operation).toMatchObject({ status: 'failed', message: expect.stringContaining('核验') }); expect(f.service.operation(operation.id).operation.repoUrl).toBeUndefined();
  });
  it('confirmed record removal preserves external resources and prevents duplicate creation', async () => {
    const f = fixture(); const { operation } = f.service.launch('idea', body); expect(() => f.service.removeOperation(operation.id, { confirm: true })).toThrow('正在创建'); await f.service.idle(); expect(() => f.service.removeOperation(operation.id, {})).toThrow('确认');
    f.service.removeOperation(operation.id, { confirm: true }); expect(f.service.launchForIdea('idea')).toMatchObject({ operation: null, removed: true }); expect(() => f.service.launch('idea', { repoName: 'another', confirm: true })).toThrow('避免重复'); expect(f.github.create).toHaveBeenCalledOnce(); expect(f.rpc.call).not.toHaveBeenCalled(); expect(f.git).not.toHaveBeenCalled(); expect(readFileSync(join(f.repoPath, 'keep.txt'), 'utf8')).toBe('original');
  });
  it('retains legacy Claude project continuation, without restarting its removed creation workflow', async () => {
    const f = fixture(); const { operation } = f.service.launch('idea', body); await f.service.idle(); const data = JSON.parse(readFileSync(f.file, 'utf8'));
    data.launches[0] = { ...data.launches[0], kind: undefined, developmentTool: 'claude', status: 'awaiting_manual_handoff', step: 'handoff', path: f.repoPath, context: { note: 'Original context' }, markdown: '# Legacy' }; writeFileSync(f.file, JSON.stringify(data));
    const service = new ProjectResumeService(f.file, f.ideas, { rpc: f.rpc, github: f.github, git: f.git, snapshot: async () => ({ status: 'ready' }) });
    expect(service.retry(operation.id).operation.status).toBe('awaiting_manual_handoff'); await service.idle(); expect(f.github.create).toHaveBeenCalledOnce();
    const project = (await service.refresh()).items.find(item => item.id === operation.id); expect(project).toMatchObject({ developmentTool: 'claude', manualHandoff: { started: false, nativeSessionRestored: false }, threads: [] });
    service.remove(operation.id); service.restore({ ids: [operation.id] }); expect((await service.list()).items.some(item => item.id === operation.id)).toBe(true);
    service.remove(operation.id); service.purge({ ids: [operation.id], confirm: true, deletedAt: { [operation.id]: service.trash().items[0].deletedAt } }); expect(service.launchForIdea('idea')).toMatchObject({ operation: null, removed: true }); expect(readFileSync(join(f.repoPath, 'keep.txt'), 'utf8')).toBe('original'); expect(f.git).not.toHaveBeenCalled();
    expect(vi.mocked(f.rpc.call).mock.calls.every(([method]) => ['project/list', 'thread/list', 'thread/turns/list'].includes(method))).toBe(true);
  });
  it('preserves legacy data on restart and limits legacy retries to GitHub', async () => {
    const f = fixture(); const { operation } = f.service.launch('idea', body); await f.service.idle(); const data = JSON.parse(readFileSync(f.file, 'utf8'));
    const legacy = { ...data.launches[0], kind: undefined, status: 'running', step: 'handoff', path: f.repoPath, context: { privateNote: 'Legacy private context' }, markdown: '# Legacy', codexProjectId: 'old-project', threadId: 'old-thread', repoUrl: 'https://github.com/AlexShen-Oguri/my-idea' }; data.launches = [legacy]; writeFileSync(f.file, JSON.stringify(data)); const before = readFileSync(f.file, 'utf8');
    const service = new ProjectResumeService(f.file, f.ideas, { rpc: f.rpc, github: f.github, git: f.git, workspaceRoot: join(f.dir, 'new') }); expect(readFileSync(f.file, 'utf8')).toBe(before); expect(service.operation(operation.id).operation.status).toBe('failed');
    expect(() => service.retry(operation.id, { replaceEmptyThread: true, confirm: true })).toThrow('无效字段'); service.retry(operation.id); await service.idle();
    expect(service.operation(operation.id).operation).toMatchObject({ status: 'ready', path: f.repoPath, codexProjectId: 'old-project', threadId: 'old-thread' }); const preserved = JSON.parse(readFileSync(f.file, 'utf8')).launches[0]; expect(preserved.context).toEqual(legacy.context); expect(preserved.markdown).toBe(legacy.markdown); expect(f.rpc.call).not.toHaveBeenCalled(); expect(f.git).not.toHaveBeenCalled(); expect(readFileSync(join(f.repoPath, 'keep.txt'), 'utf8')).toBe('original');
  });
});

it('protects repository creation and retry routes and rejects retired Codex-repair options', async () => {
  const f = fixture(); const store = new PersonalStore(join(f.dir, 'personal.json'), undefined, join(f.dir, 'reports')); const server = createPersonalApp(store, undefined, 3456, undefined, { projects: f.service }).listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/personal`;
  const send = (path: string, body: unknown, origin?: string) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  try {
    expect((await send('/inspiration/idea/launch', { repoName: 'route', confirm: true }, 'https://untrusted.example')).status).toBe(403); expect(f.github.create).not.toHaveBeenCalled();
    const response = await send('/inspiration/idea/launch', { repoName: 'route', confirm: true }); expect(response.status).toBe(202); const { operation } = await response.json(); await f.service.idle();
    expect((await send(`/project-launches/${operation.id}/retry`, { replaceEmptyThread: true, confirm: true })).status).toBe(400); expect((await send(`/project-launches/${operation.id}/retry`, {})).status).toBe(202); await f.service.idle(); expect(f.github.create).toHaveBeenCalledOnce(); expect(f.rpc.call).not.toHaveBeenCalled(); expect(f.git).not.toHaveBeenCalled();
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); f.service.close(); }
});
