import { describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { DevelopmentToolsService, discussionPreview, nativeHandoffRecipe, runToolProbe, type DevelopmentTool, type ToolProcessRunner } from '../src/personal/development-tools';
import type { ProjectRpc } from '../src/personal/codex-project-client';
import type { Idea } from '../src/personal/types';
import { englishPayload } from '../src/personal/locale';

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), execFile: vi.fn() }));

const now = new Date('2026-10-04T14:00:00Z');
function fixture(overrides: { missing?: DevelopmentTool; signedOut?: DevelopmentTool; fail?: DevelopmentTool; badAuth?: boolean; badCodexAuth?: boolean; missingRpcAccount?: boolean; unsupportedRpc?: boolean } = {}) {
  const run: ToolProcessRunner = vi.fn(async (command, args) => {
    const id = command.file as DevelopmentTool;
    if (overrides.fail === id) throw new Error('private diagnostic includes account@example.invalid and secret');
    if (args[0] === '--version') return { stdout: id === 'codex' ? 'codex-cli 0.160.0' : '2.1.104 (Claude Code)', exitCode: 0 };
    if (args[0] === '--help') return { stdout: id === 'codex' ? 'resume Resume an existing session' : '--resume [value] --tools <tools...>', exitCode: 0 };
    if (id === 'codex') return { stdout: overrides.badCodexAuth ? '' : overrides.signedOut === id ? 'Not logged in' : 'Logged in using ChatGPT', exitCode: overrides.badCodexAuth || overrides.signedOut === id ? 1 : 0 };
    return { stdout: overrides.badAuth ? 'malformed' : JSON.stringify({ loggedIn: overrides.signedOut !== id, authMethod: 'claude.ai', email: 'account@example.invalid', secret: 'never-forward' }), exitCode: overrides.signedOut === id ? 1 : 0 };
  });
  const rpc: ProjectRpc = { call: vi.fn(async method => { if (overrides.unsupportedRpc) throw Error('unsupported'); return method === 'account/read' ? { account: overrides.missingRpcAccount ? null : { type: 'chatgpt', email: 'private@example.invalid' }, requiresOpenaiAuth: true } : { data: [] }; }) as any, close: vi.fn() };
  const rpcFactory = vi.fn(() => rpc);
  const tools = new DevelopmentToolsService({ resolveCommand: id => overrides.missing === id ? undefined : { file: id, args: [] }, run, rpcFactory, now: () => now });
  return { tools, run: vi.mocked(run), rpc, rpcFactory };
}
describe('official device tool status', () => {
  it('runs probes with bounded argv, no shell, and extracts only the fixed Codex status from stderr', async () => {
    const command = { file: '/trusted/codex', args: [] };
    vi.mocked(execFile).mockImplementationOnce(((file: unknown, args: unknown, options: unknown, callback: Function) => { callback(null, '', 'Logged in using ChatGPT\nprivate@example.invalid /private/local/secret'); }) as any);
    expect(await runToolProbe(command, ['login', 'status'])).toEqual({ stdout: 'Logged in using ChatGPT', exitCode: 0 });
    expect(execFile).toHaveBeenLastCalledWith('/trusted/codex', ['login', 'status'], expect.objectContaining({ shell: false, windowsHide: true, timeout: 8000, maxBuffer: 128 * 1024 }), expect.any(Function));
    vi.mocked(execFile).mockImplementationOnce(((file: unknown, args: unknown, options: unknown, callback: Function) => { callback({ code: 'ETIMEDOUT', killed: true, message: 'private token diagnostic' }, '', 'private token diagnostic'); }) as any);
    await expect(runToolProbe(command, ['--help'])).rejects.toThrow('Tool status probe unavailable.');
  });
  it('reports installed credentials separately from unverified model access and emits no identity or diagnostics', async () => {
    const f = fixture(); const state = await f.tools.status();
    expect(state).toMatchObject({ checkedAt: now.toISOString(), deviceScope: 'current_device' });
    for (const tool of state.tools) expect(tool).toMatchObject({ state: 'authenticated', authentication: 'detected', modelAccess: 'unchecked', reason: 'unsupported_strict_isolation', capabilities: { discussion: 'manual_only', development: 'native_confirmation', nativeResume: true } });
    expect(state.tools[0].capabilities).toMatchObject({ projectRead: true, threadRead: true });
    expect(state.tools[1].capabilities).toMatchObject({ projectRead: false, threadRead: false });
    expect(JSON.stringify(state)).not.toMatch(/example\.invalid|never-forward|secret/);
    expect(vi.mocked(f.rpc.call).mock.calls.map(call => call[0])).toEqual(['account/read', 'project/list', 'thread/list']);
    expect(f.rpc.close).toHaveBeenCalledOnce();
  });
  it('localizes fixed tool messages and dynamic auth errors while keeping authored content intact', async () => {
    const original = await fixture().tools.status(), translated = englishPayload(original) as typeof original;
    expect(translated.tools[0].message).toContain('model access has not been verified'); expect(original.tools[0].message).toContain('模型访问未验证');
    const content = '当前设备未检测到此工具，未发送任何内容。'; expect(englishPayload({ title: content, question: content, text: content, message: content })).toEqual({ title: content, question: content, text: content, message: 'This tool was not detected on this device. No content was sent.' });
    const message = 'Claude Code 尚未检测到可用的本机安装、登录与原生继续工作接口，请在对应工具中检查后重试'; expect((englishPayload({ message }) as { message: string }).message).toContain('Claude Code installation, login and native resume interfaces could not be verified');
  });
  it('returns missing installation without spawning it or pretending to be connected', async () => {
    const f = fixture({ missing: 'claude' }); const state = await f.tools.status();
    expect(state.tools[1]).toMatchObject({ state: 'not_installed', installed: false, authentication: 'unknown', reason: 'not_installed' });
    expect(f.run.mock.calls.some(([command]) => command.file === 'claude')).toBe(false);
    await expect(f.tools.requireAuthenticated('claude')).rejects.toMatchObject({ status: 503 });
  });
  it.each(['codex', 'claude'] as const)('distinguishes %s signed out from service failure', async id => {
    const f = fixture({ signedOut: id }); const status = (await f.tools.status()).tools.find(item => item.id === id)!;
    expect(status).toMatchObject({ state: 'signed_out', installed: true, authentication: 'missing', reason: 'login_required' });
    await expect(f.tools.requireAuthenticated(id)).rejects.toMatchObject({ status: 503 });
    if (id === 'codex') expect(f.rpcFactory).not.toHaveBeenCalled();
  });
  it('fails closed when a bounded probe fails or malformed authentication cannot be verified', async () => {
    for (const options of [{ fail: 'claude' as const }, { badAuth: true }]) {
      const f = fixture(options); const status = (await f.tools.status()).tools[1];
      expect(status).toMatchObject({ state: 'unavailable', reason: 'probe_failed' });
      expect(JSON.stringify(status)).not.toContain('secret');
    }
    expect((await fixture({ badCodexAuth: true }).tools.status()).tools[0]).toMatchObject({ state: 'unavailable', authentication: 'unknown', reason: 'probe_failed' });
  });
  it('does not fabricate Codex project capabilities when the protocol is unavailable', async () => {
    const f = fixture({ unsupportedRpc: true }); const status = (await f.tools.status()).tools[0];
    expect(status.authentication).toBe('detected'); expect(status.capabilities.projectRead).toBe(false); expect(status.capabilities.threadRead).toBe(false);
    expect(f.rpc.close).toHaveBeenCalledOnce();
  });
  it('does not call a missing required app-server account authenticated based on an earlier CLI probe', async () => {
    const f = fixture({ missingRpcAccount: true }); const status = (await f.tools.status()).tools[0];
    expect(status).toMatchObject({ state: 'signed_out', authentication: 'missing', reason: 'login_required', capabilities: { projectRead: false, threadRead: false } });
    expect(f.rpc.close).toHaveBeenCalledOnce(); await expect(f.tools.requireAuthenticated('codex')).rejects.toMatchObject({ status: 503 });
  });
  it('caches only status until explicit refresh and coalesces simultaneous probes', async () => {
    const f = fixture(); const [first, second] = await Promise.all([f.tools.status(), f.tools.status()]);
    expect(first).toEqual(second); expect(f.run).toHaveBeenCalledTimes(6);
    first.tools[0].installed = false; expect((await f.tools.status()).tools[0].installed).toBe(true); expect(f.run).toHaveBeenCalledTimes(6);
    await f.tools.status({ refresh: true }); expect(f.run).toHaveBeenCalledTimes(12);
  });
});

const idea: Idea = { id: 'idea-1', title: 'Selected idea', status: 'growing', revision: 3, createdAt: now.toISOString(), updatedAt: now.toISOString(), entries: [
  { id: 'initial', kind: 'initial', content: 'Unselected private initial thought', createdAt: now.toISOString(), updatedAt: now.toISOString() },
  { id: 'decision', kind: 'decision', content: 'Selected decision with https://example.invalid/resource', createdAt: now.toISOString(), updatedAt: now.toISOString() },
] };
describe('manual selected context handoff', () => {
  const body = { tool: 'claude', ideaId: idea.id, revision: idea.revision, includeTitle: false, entryIds: ['decision'], question: 'Discuss this choice' };
  it.each(['codex', 'claude'])('previews only explicitly selected title/entries/question for %s, without commands or model calls', tool => {
    const reader = { idea: vi.fn(() => structuredClone(idea)) };
    const result = discussionPreview(reader, { ...body, tool }, 'en');
    expect(result).toMatchObject({ tool, delivery: 'clipboard_only', sent: false, selected: { includeTitle: false, entryIds: ['decision'] } });
    expect(result.text).toContain('Selected decision'); expect(result.text).toContain('Discuss this choice');
    expect(result.text).not.toContain('Unselected private initial thought'); expect(result.text).not.toContain('Selected idea');
    expect(reader.idea).toHaveBeenCalledExactlyOnceWith('idea-1');
    expect(result).not.toHaveProperty('sessionId'); expect(result).not.toHaveProperty('command');
  });
  it('rejects unsupported providers, private fields, arbitrary paths, stale edits and nonexistent selections', () => {
    const reader = { idea: () => idea };
    for (const bad of [{ ...body, tool: 'workbuddy' }, { ...body, path: '/private/file' }, { ...body, conversationIds: ['all'] }, { ...body, includeTitle: 'yes' }, { ...body, entryIds: ['decision', 'decision'] }, { ...body, revision: 2 }, { ...body, entryIds: ['removed'] }]) expect(() => discussionPreview(reader, bad)).toThrow();
  });
  it('rejects oversized context and accepts an explicit title-only selection', () => {
    expect(discussionPreview({ idea: () => idea }, { ...body, includeTitle: true, entryIds: [], question: '' }).text).toContain(idea.title);
    const huge = structuredClone(idea); huge.entries[1].content = '大'.repeat(30000);
    expect(() => discussionPreview({ idea: () => huge }, body)).toThrow('64 KB');
  });
  it('keeps native recipes structured, never starts or claims restoration, and accepts only an explicit UUID', () => {
    expect(nativeHandoffRecipe('claude', '/owned/project', '.dailyhouse/inspiration.md')).toEqual({ cwd: '/owned/project', executable: 'claude', args: [], contextPath: '.dailyhouse/inspiration.md', started: false, nativeSessionRestored: false });
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(nativeHandoffRecipe('claude', '/owned/project', undefined, id).args).toEqual(['--resume', id]);
    expect(nativeHandoffRecipe('codex', '/owned/project', undefined, id).args).toEqual(['resume', id]);
    for (const bad of [';rm -rf /', '--dangerously-skip-permissions', 'not-a-session']) expect(() => nativeHandoffRecipe('claude', '/owned/project', undefined, bad)).toThrow();
    for (const path of ['relative/project', '//network/project', '/owned/\nproject']) expect(() => nativeHandoffRecipe('claude', path)).toThrow();
    for (const path of ['../private', '/private/context', 'C:\\private\\context']) expect(() => nativeHandoffRecipe('claude', '/owned/project', path)).toThrow();
  });
});
