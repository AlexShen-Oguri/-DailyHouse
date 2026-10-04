import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexProjectClient } from '../src/personal/codex-project-client';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));

let child: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
let received: any[];
beforeEach(() => {
  child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  received = []; mocks.spawn.mockReset().mockReturnValue(child);
  child.stdin.on('data', data => {
    const message = JSON.parse(data.toString()); received.push(message);
    if (message.method === 'initialize') child.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\n');
  });
});
describe('Codex RPC event transport', () => {
  it('delivers live notifications separately from RPC replies and unsubscribes', async () => {
    const client = new CodexProjectClient('fixture-codex', 1000); const events = vi.fn(); const unsubscribe = client.onNotification(events);
    const pending = client.call('thread/read', { threadId: 'one' });
    await vi.waitFor(() => expect(received.some(m => m.method === 'thread/read')).toBe(true));
    const request = received.find(m => m.method === 'thread/read');
    child.stdout.write(JSON.stringify({ method: 'turn/completed', params: { threadId: 'one', turn: { id: 'turn', status: 'completed' } } }) + '\n');
    child.stdout.write(JSON.stringify({ id: request.id, result: { thread: {} } }) + '\n');
    expect(await pending).toEqual({ thread: {} }); expect(events).toHaveBeenCalledWith(expect.objectContaining({ method: 'turn/completed' }));
    unsubscribe(); child.stdout.write('{"method":"warning","params":{}}\n'); expect(events).toHaveBeenCalledTimes(1);
    expect(received.some(m => m.method === 'initialized')).toBe(true); client.close(); expect(child.kill).toHaveBeenCalledOnce();
  });
  it('notifies a lost connection so a turn waiter can fail immediately', async () => {
    const client = new CodexProjectClient('fixture-codex', 1000); const events = vi.fn(); client.onNotification(events);
    const pending = client.call('thread/read', {});
    await vi.waitFor(() => expect(received.some(m => m.method === 'thread/read')).toBe(true));
    child.emit('exit', 1); await expect(pending).rejects.toThrow('unavailable');
    expect(events).toHaveBeenCalledWith({ method: 'connection/closed' }); client.close();
  });
  it('preserves an RPC failure code without private details and continues refusing tool approvals', async () => {
    const client = new CodexProjectClient('fixture-codex', 1000); const pending = client.call('turn/start', {});
    await vi.waitFor(() => expect(received.some(m => m.method === 'turn/start')).toBe(true));
    const request = received.find(m => m.method === 'turn/start');
    child.stdout.write('{"id":700,"method":"item/commandExecution/requestApproval","params":{}}\n');
    child.stdout.write(JSON.stringify({ id: request.id, error: { code: -32602, message: 'private credential detail' } }) + '\n');
    const error = await pending.catch(value => value);
    expect(error).toMatchObject({ name: 'CodexRpcError', code: -32602, reason: 'rpc_failed', message: 'Codex RPC -32602' });
    expect(JSON.stringify(error)).not.toContain('private credential'); expect(error).not.toHaveProperty('detail');
    expect(received.find(m => m.id === 700)).toMatchObject({ error: { code: -32601 } }); client.close();
  });
});
