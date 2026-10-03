import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import type { ReadingCollectionService } from '../src/personal/reading-collection';
import type { PersonalStore } from '../src/personal/store';

const fixture = vi.hoisted(() => ({
  workspace: '', store: undefined as PersonalStore | undefined,
  collection: undefined as ReadingCollectionService | undefined,
  call: vi.fn(), close: vi.fn(),
  listener: undefined as ((notification: { method: string; params?: any }) => void) | undefined,
}));

// Import the production bootstrap without loading personal configuration,
// starting a listener or reaching a real Codex account.
vi.mock('../src/bootstrapEnv', () => ({}));
vi.mock('../src/personal/codex-project-client', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/personal/codex-project-client')>()),
  CodexProjectClient: class { call = fixture.call; close = fixture.close; onNotification(listener: typeof fixture.listener) { fixture.listener = listener; return () => { fixture.listener = undefined; }; } },
}));
vi.mock('../src/personal/app', () => ({
  createPersonalApp: (store: PersonalStore, _dist: string, _port: number, _ideas: unknown, services: { collection: ReadingCollectionService }) => {
    fixture.store = store; fixture.collection = services.collection;
    return { listen: () => ({ close: vi.fn() }) };
  },
}));

it('organizes history in the registered checkout when bootstrapped from the backend directory', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'garden reading 小院-'));
  const signals = ['SIGINT', 'SIGTERM'] as const;
  const listeners = signals.map(signal => new Set(process.listeners(signal)));
  fixture.workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  vi.stubEnv('WORKBENCH_DATA_DIR', directory); vi.stubEnv('PORT', '3456');
  fixture.call.mockImplementation(async (method: string) => {
    if (method === 'project/list') return { data: [{ id: 'checkout-project', name: 'Fixture garden', roots: [{ path: fixture.workspace }], updatedAt: 1 }] };
    if (method === 'thread/start' || method === 'thread/read' || method === 'thread/resume') return { thread: { id: 'fixture-reading-thread', cwd: fixture.workspace, projectId: 'checkout-project', name: '书架收集', status: { type: 'idle' } } };
    if (method === 'thread/name/set') return {};
    if (method === 'turn/start') {
      fixture.listener?.({ method: 'item/completed', params: { threadId: 'fixture-reading-thread', turnId: 'fixture-turn', item: { id: 'final', type: 'agentMessage', phase: 'final_answer', text: '{"selected":[{"index":0,"category":"programming_ai"}]}' } } });
      fixture.listener?.({ method: 'turn/completed', params: { threadId: 'fixture-reading-thread', turn: { id: 'fixture-turn', status: 'completed', items: [] } } });
      return { turn: { id: 'fixture-turn' } };
    }
    throw Error(`Unexpected RPC method: ${method}`);
  });
  try {
    await import('../src/index');
    const service = fixture.collection!;
    const run = service.start({}); const claimed = service.claim(run.id, {});
    service.submit(run.id, {
      token: claimed.token,
      coverage: { from: claimed.job.from, to: claimed.job.to, complete: true },
      items: [{ title: 'Fixture TypeScript tutorial', url: 'https://www.bilibili.com/video/BV1xx411c7z1/', viewedAt: new Date(Date.parse(claimed.job.to) - 60000).toISOString(), progress: 0.1 }],
    });
    await service.whenIdle();
    expect(service.state().run).toMatchObject({ status: 'completed', threadId: 'fixture-reading-thread', result: { added: 1 } });
    expect(fixture.call).toHaveBeenCalledWith('thread/start', expect.objectContaining({ projectId: 'checkout-project', cwd: fixture.workspace, sandbox: 'read-only', ephemeral: false }));
    expect(fixture.store!.reading().items).toHaveLength(1);
    expect(service.extensionPath).toBe(join(fixture.workspace, 'extensions', 'bilibili-reading'));
    service.clear(run.id, { confirm: true });
    const next = service.start({}); const nextClaim = service.claim(next.id, {});
    service.submit(next.id, {
      token: nextClaim.token, coverage: { from: nextClaim.job.from, to: nextClaim.job.to, complete: true },
      items: [{ title: 'Fixture design tutorial', url: 'https://www.bilibili.com/video/BV1xx411c7z2/', viewedAt: new Date(Date.parse(nextClaim.job.to) - 60000).toISOString(), progress: 0.1 }],
    });
    await service.whenIdle();
    expect(service.state().run).toMatchObject({ status: 'completed', threadId: 'fixture-reading-thread', result: { added: 1 } });
    expect(fixture.call.mock.calls.filter(call => call[0] === 'thread/start')).toHaveLength(1);
    expect(fixture.call).toHaveBeenCalledWith('thread/resume', expect.objectContaining({ threadId: 'fixture-reading-thread' }));
  } finally {
    fixture.collection?.close();
    signals.forEach((signal, index) => { for (const listener of process.listeners(signal)) if (!listeners[index].has(listener)) process.removeListener(signal, listener); });
    vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true });
  }
});
