import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPersonalApp } from '../src/personal/app';
import { LocalPicker } from '../src/personal/local-picker';
import { PersonalStore } from '../src/personal/store';

let server: Server, directory: string, base: string, store: PersonalStore;
const choose = vi.fn(async () => ({ cancelled: true as const }));
beforeEach(async () => {
  choose.mockClear();
  directory = mkdtempSync(join(tmpdir(), 'garden-picker-api-'));
  store = new PersonalStore(join(directory, 'personal.json'), undefined, join(directory, 'reports'));
  const picker = { choose } as unknown as LocalPicker;
  server = createPersonalApp(store, undefined, 3456, undefined, { picker }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/personal`;
});
afterEach(async () => {
  const closing = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server.closeAllConnections(); await closing;
  rmSync(directory, { recursive: true, force: true });
});
it('returns picker cancellation without modifying source settings', async () => {
  const before = store.settings();
  const response = await fetch(`${base}/local-picker`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'calendar' }) });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ cancelled: true });
  expect(store.settings()).toEqual(before);
  expect(choose).toHaveBeenCalledOnce();
});
it('blocks foreign pages and non-JSON picker calls before showing an OS dialog', async () => {
  const foreign = await fetch(`${base}/local-picker`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://foreign.example' }, body: '{}' });
  expect(foreign.status).toBe(403);
  const binary = await fetch(`${base}/local-picker`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: 'anything' });
  expect(binary.status).toBe(415); expect(choose).not.toHaveBeenCalled();
});
