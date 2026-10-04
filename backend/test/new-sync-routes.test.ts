import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { request as httpRequest, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPersonalApp } from '../src/personal/app';
import { PersonalStore } from '../src/personal/store';
import { PrivateSyncService, type SyncSource } from '../src/personal/private-sync';
import { SharedProjectStore } from '../src/personal/shared-projects';
import { validateProjectedRecord } from '../src/personal/sync-projection';
import type { DevelopmentToolsService, DevelopmentToolsState } from '../src/personal/development-tools';
import type { ProjectResumeService, ResumeProject } from '../src/personal/project-resume';

let root: string; const servers: Server[] = [];
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dailyhouse-new-sync-routes-')); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-04T12:00:00Z')); });
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } vi.useRealTimers(); rmSync(root, { recursive: true, force: true }); });
async function fixture() {
  const store = new PersonalStore(join(root, 'personal.json'), undefined, join(root, 'reports'));
  const idea = store.addIdea({ title: 'Private title', content: 'Unselected original thought' }); store.addIdeaEntry(idea.id, { revision: idea.revision, kind: 'decision', content: 'Explicitly selected decision' }); const currentIdea = store.idea(idea.id);
  const toolsState: DevelopmentToolsState = { checkedAt: new Date().toISOString(), deviceScope: 'current_device', tools: [{ id: 'claude', state: 'authenticated', installed: true, version: '2.1.104', authentication: 'detected', modelAccess: 'unchecked', checkedAt: new Date().toISOString(), capabilities: { discussion: 'manual_only', development: 'native_confirmation', nativeResume: true, projectRead: false, threadRead: false }, reason: 'unsupported_strict_isolation', message: '本机凭证与接口已检测；模型访问未验证。灵感讨论仅准备选中内容的手动交接，不自动运行工具。' }] };
  const tools = { status: vi.fn(async () => structuredClone(toolsState)), requireAuthenticated: vi.fn(async () => toolsState.tools[0]) };
  const source: SyncSource = { exportRecords: () => store.syncExport(), apply: vi.fn((records) => store.syncApply(records)), validate: validateProjectedRecord, attachments: () => [{ name: 'local-copy.pdf', size: 10 }] };
  const sync = new PrivateSyncService(join(root, 'sync.json'), source, undefined, { id: 'device-a', name: 'Synthetic Windows' });
  const code = join(root, 'existing-code'); mkdirSync(code); const originalFile = join(code, 'keep-source.txt'); writeFileSync(originalFile, 'original external source');
  const project: ResumeProject = { id: 'existing-tool-project', codexProjectId: 'device-local-project', title: 'Existing code', source: 'codex', path: code, git: { status: 'ready', remote: 'https://github.com/example/synthetic' }, repo: { name: 'synthetic', url: 'https://github.com/example/synthetic', private: true, match: 'remote' }, threads: [], resumeCommand: 'codex' };
  const localProjects = { cachedProject: vi.fn((id: string) => id === project.id ? project : undefined) };
  const sharedFile = join(root, 'shared.json'), linkFile = join(root, 'device-links.json');
  const shared = new SharedProjectStore(sharedFile, linkFile, { id: 'device-a', name: 'Synthetic Windows' }, localProjects as Pick<ProjectResumeService, 'cachedProject'>, tools as Pick<DevelopmentToolsService, 'requireAuthenticated' | 'status'>, record => ({ deviceId: 'device-a', deviceName: 'Synthetic Windows', updatedAt: String(record.body?.updatedAt || new Date().toISOString()) }));
  const server = createPersonalApp(store, undefined, 3456, undefined, { tools: tools as unknown as DevelopmentToolsService, sync, sharedProjects: shared }).listen(0, '127.0.0.1'); servers.push(server); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/personal`;
  const send = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3456', ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { base, store, idea: currentIdea, tools, sync, source, shared, sharedFile, linkFile, localProjects, project, originalFile, send };
}
function rawStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    // Fetch implementations normalize Host and Sec-Fetch-* headers. Send these
    // negative cases through HTTP so the server receives the exact test header.
    const request = httpRequest(url, { headers }, response => { response.resume(); response.once('end', () => resolve(response.statusCode!)); });
    request.once('error', reject); request.end();
  });
}

describe('new routes retain the protected local boundary', () => {
  it.each(['/development-tools', '/private-sync/status', '/shared-projects'])('denies foreign origins and hosts before reading %s', async path => {
    const f = await fixture(); expect((await f.send(path, 'GET', undefined, { Origin: 'https://untrusted.example' })).status).toBe(403);
    expect(await rawStatus(f.base + path, { Host: 'untrusted.example', Origin: 'http://127.0.0.1:3456' })).toBe(403); expect(await rawStatus(f.base + path, { 'Sec-Fetch-Site': 'cross-site', Origin: 'http://127.0.0.1:3456' })).toBe(403); expect(f.tools.status).not.toHaveBeenCalled();
  });
  it.each(['/development-tools/refresh', '/private-sync/preview', '/shared-projects'])('requires JSON and rejects malformed request bodies for %s', async path => {
    const f = await fixture(); expect((await f.send(path, 'POST', {}, { 'Content-Type': 'text/plain' })).status).toBe(415);
    const response = await fetch(f.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3456' }, body: '{"broken":' }); expect(response.status).toBe(400);
    expect(f.tools.status).not.toHaveBeenCalled(); expect(f.source.apply).not.toHaveBeenCalled();
  });
  it.each([
    ['/development-tools/discussion-preview', 257 * 1024], ['/private-sync/preview', 8 * 1024 * 1024 + 1], ['/shared-projects', 129 * 1024],
  ] as const)('enforces the route body limit for %s', async (path, size) => { const f = await fixture(); expect((await f.send(path, 'POST', { payload: 'x'.repeat(size) })).status).toBe(413); expect(f.source.apply).not.toHaveBeenCalled(); expect(f.tools.status).not.toHaveBeenCalled(); });
  it('enforces JSON for shared project deletion and rejects unsupported private fields without creating records', async () => {
    const f = await fixture(); expect((await f.send('/shared-projects/unknown', 'DELETE', {}, { 'Content-Type': 'text/plain' })).status).toBe(415);
    for (const body of [{ title: 'Project', goal: 'Goal', absolutePath: f.project.path }, { title: 'Project', goal: 'Goal', nativeSessionId: randomUUID() }, { title: 'Project', goal: 'Goal', token: 'synthetic' }]) expect((await f.send('/shared-projects', 'POST', body)).status).toBe(400);
    expect(f.shared.list().items).toEqual([]); expect(f.tools.requireAuthenticated).not.toHaveBeenCalled();
  });
});

describe('manual context and local-only synchronization routes', () => {
  it('reports timestamped English tool state and refreshes only on the explicit refresh route', async () => {
    const f = await fixture(); const response = await f.send('/development-tools', 'GET', undefined, { 'Accept-Language': 'en' }); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('content-language')).toBe('en');
    const state = await response.json(); expect(state).toMatchObject({ deviceScope: 'current_device', tools: [{ modelAccess: 'unchecked', authentication: 'detected', capabilities: { discussion: 'manual_only' } }] }); expect(state.tools[0].message).toContain('model access has not been verified');
    expect((await f.send('/development-tools/refresh', 'POST', {})).status).toBe(200); expect(f.tools.status).toHaveBeenLastCalledWith({ refresh: true });
    expect((await f.send('/development-tools/refresh', 'POST', { command: 'untrusted' })).status).toBe(400);
  });
  it('retires inspiration discussion previews without probing tools or creating project records', async () => {
    const f = await fixture(); const response = await f.send('/development-tools/discussion-preview', 'POST', { tool: 'claude', ideaId: f.idea.id }, { 'Accept-Language': 'en' }); expect(response.status).toBe(410); const result = await response.json(); expect(result.message).toContain('have been removed'); expect(result).not.toHaveProperty('text'); expect(f.tools.status).not.toHaveBeenCalled(); expect(f.tools.requireAuthenticated).not.toHaveBeenCalled(); expect(f.shared.list().items).toHaveLength(0);
  });
  it('previews a whitelist without upload and explains unavailable private cloud in English', async () => {
    const f = await fixture(); expect(await (await f.send('/private-sync/status')).json()).toMatchObject({ mode: 'local_only', configured: false });
    const preview = await (await f.send('/private-sync/preview', 'POST', { scopes: ['ideas'] })).json(); expect(preview).toMatchObject({ destination: null, uploadCount: 1, attachmentsExcluded: [{ name: 'local-copy.pdf', size: 10 }] });
    const approve = await f.send('/private-sync/approve', 'POST', { previewId: preview.id, confirmed: true }, { 'Accept-Language': 'en' }); expect(approve.status).toBe(409); expect((await approve.json()).message).toContain('Local data has not been uploaded'); expect(f.source.apply).not.toHaveBeenCalled();
    expect((await f.send('/private-sync/run', 'POST', { shell: 'not allowed' })).status).toBe(400); expect((await f.send('/private-sync/preview', 'POST', { scopes: ['all_files'] })).status).toBe(400);
  });
});

describe('shared project record routes and device-specific bindings', () => {
  it('supports revision-protected CRUD, local linking and reviewed handoff without touching native projects or original files', async () => {
    const f = await fixture(), body = { title: 'Shared project', goal: 'Private project goal', decisions: 'Keep narrow scope', progress: 'Prototype', nextStep: 'Test it', repoUrl: f.project.repo!.url, requestId: randomUUID() };
    const response = await f.send('/shared-projects', 'POST', body); expect(response.status).toBe(201); const created = await response.json(); const id = created.id;
    expect((await (await f.send('/shared-projects', 'POST', body)).json()).id).toBe(id); expect(f.shared.list().items).toHaveLength(1);
    expect((await f.send(`/shared-projects/${id}`, 'PATCH', { revision: 0, progress: 'Stale overwrite' })).status).toBe(409);
    const updated = await (await f.send(`/shared-projects/${id}`, 'PATCH', { revision: created.revision, progress: 'Verified progress' })).json();
    expect((await f.send(`/shared-projects/${id}/link`, 'POST', { revision: updated.revision, tool: 'claude', localProjectId: f.project.id })).status).toBe(200);
    const linked = f.shared.list().items[0]; expect(linked).toMatchObject({ provenance: { deviceId: 'device-a' }, local: { tool: 'claude', path: f.project.path, available: true, nativeSessionVerified: false } });
    const handoff = await (await f.send(`/shared-projects/${id}/handoff-preview`, 'POST', { tool: 'claude', confirmed: true })).json(); expect(handoff).toMatchObject({ existingSession: false, recipe: { executable: 'claude', args: [], cwd: f.project.path, started: false, nativeSessionRestored: false } }); expect(handoff.text).toContain('not a restored native conversation');
    const projected = f.shared.syncExport(); expect(JSON.stringify(projected)).not.toContain(f.project.path); expect(JSON.stringify(projected)).not.toContain('existing-tool-project'); expect(JSON.stringify(projected)).not.toContain('nativeSession');
    expect((await f.send(`/shared-projects/${id}`, 'DELETE', { revision: updated.revision, confirmed: false })).status).toBe(400); expect((await f.send(`/shared-projects/${id}`, 'DELETE', { revision: updated.revision, confirmed: true })).status).toBe(204);
    const trash = await (await f.send('/shared-projects/trash')).json(); expect(Date.parse(trash.items[0].expiresAt) - Date.parse(trash.items[0].deletedAt)).toBe(30 * 86400000);
    expect((await f.send(`/shared-projects/${id}/restore`, 'POST', { confirmed: true })).status).toBe(200); const restored = f.shared.list().items[0];
    expect((await f.send(`/shared-projects/${id}`, 'DELETE', { revision: restored.revision, confirmed: true })).status).toBe(204); expect((await f.send(`/shared-projects/trash/${id}`, 'DELETE', { confirmed: true })).status).toBe(204);
    expect(f.shared.list().items).toHaveLength(0); expect((await f.send('/shared-projects', 'POST', body)).status).toBe(410); expect(existsSync(f.project.path)).toBe(true); expect(readFileSync(f.originalFile, 'utf8')).toBe('original external source');
    expect(readFileSync(f.sharedFile, 'utf8')).not.toContain('Private project goal'); expect(JSON.parse(readFileSync(f.sharedFile, 'utf8')).requests[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(f.linkFile, 'utf8')).not.toContain(f.project.path.replaceAll('\\', '\\\\'));
  });
  it('keeps one shared identity across devices without copying local paths or native session associations', async () => {
    const f = await fixture(); const created = f.shared.create({ title: 'Continue elsewhere', goal: 'Saved goal', repoUrl: f.project.repo!.url }); await f.shared.link(created.id, { revision: created.revision, tool: 'codex', localProjectId: f.project.id });
    const second = new SharedProjectStore(join(root, 'mac-shared.json'), join(root, 'mac-links.json'), { id: 'device-b', name: 'Synthetic Mac' }, f.localProjects, f.tools, () => ({ deviceId: 'device-a', deviceName: 'Synthetic Windows', updatedAt: new Date().toISOString() }));
    second.syncApply(f.shared.syncExport()); expect(second.list().items[0]).toMatchObject({ id: created.id, goal: 'Saved goal', provenance: { deviceId: 'device-a' } }); expect(second.list().items[0]).not.toHaveProperty('local');
    const restarted = new SharedProjectStore(f.sharedFile, f.linkFile, { id: 'device-a', name: 'Synthetic Windows' }, f.localProjects, f.tools, () => ({ deviceId: 'device-a', deviceName: 'Synthetic Windows', updatedAt: new Date().toISOString() })); expect(restarted.list().items[0].id).toBe(created.id); expect(restarted.list().items[0].local?.available).toBe(true);
    expect(() => new SharedProjectStore(f.sharedFile, f.linkFile, { id: 'device-b', name: 'Synthetic Mac' }, f.localProjects, f.tools, () => ({ deviceId: 'device-b', deviceName: 'Synthetic Mac', updatedAt: new Date().toISOString() }))).toThrow('another device');
  });
  it('blocks restore after 30 days and prevents an old creation retry from reviving a removed record', async () => {
    const f = await fixture(), body = { title: 'Temporary shared project', goal: 'Keep external files', requestId: randomUUID() }, created = f.shared.create(body); f.shared.remove(created.id, { revision: created.revision, confirmed: true });
    vi.setSystemTime(Date.now() + 31 * 86400000); expect((await f.send(`/shared-projects/${created.id}/restore`, 'POST', { confirmed: true })).status).toBe(410); expect((await f.send('/shared-projects', 'POST', body)).status).toBe(410); expect(f.shared.syncExport()).toContainEqual(expect.objectContaining({ kind: 'project', id: created.id, body: null })); expect(readFileSync(f.originalFile, 'utf8')).toBe('original external source');
  });
});
