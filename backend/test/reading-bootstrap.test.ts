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
}));

// Import the production bootstrap without loading personal configuration,
// starting a listener or reaching a real Codex account.
vi.mock('../src/bootstrapEnv', () => ({}));
vi.mock('../src/personal/codex-project-client', () => ({
  CodexProjectClient: class { call = fixture.call; close = fixture.close; },
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
    if (method === 'thread/start') return { thread: { id: 'fixture-reading-thread' } };
    if (method === 'thread/name/set') return {};
    if (method === 'turn/start') return { turn: { id: 'fixture-turn' } };
    if (method === 'thread/read') return { thread: { turns: [{ id: 'fixture-turn', status: 'completed', items: [{ type: 'agentMessage', phase: 'final_answer', text: '{"selected":[{"index":0,"category":"programming_ai"}]}' }] }] } };
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
  } finally {
    fixture.collection?.close();
    signals.forEach((signal, index) => { for (const listener of process.listeners(signal)) if (!listeners[index].has(listener)) process.removeListener(signal, listener); });
    vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true });
  }
});
