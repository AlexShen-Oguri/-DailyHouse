import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { CodexProjectClient, type RpcNotification } from '../src/personal/codex-project-client';

const fixture = vi.hoisted(() => ({ executable: '' }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: (_executable: string, _args: string[], options: any) => actual.spawn(process.execPath, [fixture.executable], options) };
});

it('routes live notifications, rejects tool approvals and reports stream closure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'garden-rpc-'));
  const executable = join(root, 'fixture-codex');
  writeFileSync(executable, `
const { createInterface } = require('node:readline');
const emit = value => process.stdout.write(JSON.stringify(value) + '\\n');
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') emit({ id: message.id, result: {} });
  if (message.method === 'probe') {
    emit({ method: 'turn/completed', params: { threadId: 'fixture', turn: { id: 'turn', status: 'completed', items: [] } } });
    emit({ id: 900, method: 'item/commandExecution/requestApproval', params: {} });
  }
  if (message.id === 900 && message.error?.code === -32601) emit({ id: 2, result: { approvalRejected: true } });
  if (message.method === 'end') { emit({ id: message.id, result: {} }); setTimeout(() => process.exit(0), 10); }
});
`);
  fixture.executable = executable;
  const client = new CodexProjectClient(executable);
  const events: RpcNotification[] = [];
  let closed!: () => void;
  const ended = new Promise<void>(resolve => { closed = resolve; });
  const unsubscribe = client.onNotification(event => { events.push(event); if (event.method === 'connection/closed') closed(); });
  try {
    expect(await client.call('probe', {})).toEqual({ approvalRejected: true });
    expect(events).toEqual([{ method: 'turn/completed', params: { threadId: 'fixture', turn: { id: 'turn', status: 'completed', items: [] } } }]);
    await client.call('end', {}); await ended;
    expect(events.at(-1)).toEqual({ method: 'connection/closed' });
  } finally { unsubscribe(); client.close(); rmSync(root, { recursive: true, force: true }); }
});
