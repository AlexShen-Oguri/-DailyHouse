import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { PersonalStore } from '../src/personal/store';
import { InspirationStore } from '../src/personal/inspiration-store';
import { createPersonalApp } from '../src/personal/app';
import type { InspirationProvider } from '../src/personal/inspiration-ai';

let root: string, server: Server, base: string, store: PersonalStore, inspiration: InspirationStore;
const provider: InspirationProvider = { status: () => ({ configured: false, provider: 'ollama', model: 'fixture', message: '本机未运行' }), brainstorm: vi.fn() };
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'garden-inspiration-api-'));
  store = new PersonalStore(join(root, 'personal.json'), undefined, join(root, 'reports'));
  inspiration = new InspirationStore(join(root, 'inspiration.json'), store, provider);
  server = createPersonalApp(store, undefined, 3456, inspiration).listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/personal`;
});
afterEach(async () => { const closed = new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); server.closeAllConnections(); await closed; rmSync(root, { recursive: true, force: true }); });
const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

it('serves the same IDs in the timeline and garden, including merge, trash and full restoration', async () => {
  const a = await (await fetch(`${base}/ideas`, json({ title: 'Game', content: 'First fragment' }))).json();
  const b = await (await fetch(`${base}/inspiration`, json({ title: 'Flowers', body: 'Second fragment' }))).json();
  const merge = await fetch(`${base}/inspiration/merge`, json({ ids: [a.id, b.id], title: 'Flower game', body: 'Playable bouquet' }));
  expect(merge.status).toBe(201); const combined = await merge.json();
  expect((await (await fetch(`${base}/ideas/${combined.id}`)).json()).entries[0].content).toBe('Playable bouquet');
  const note = await (await fetch(`${base}/ideas/${combined.id}/entries`, json({ content: 'Later progress', kind: 'progress', revision: 1 }))).json();
  expect((await (await fetch(`${base}/inspiration`)).json()).items.find((i: { id: string }) => i.id === combined.id).body).toContain('Later progress');
  const deletion = await fetch(`${base}/ideas/${combined.id}`, { ...json({ revision: note.revision }), method: 'DELETE' }); expect(deletion.status).toBe(204);
  expect((await (await fetch(`${base}/inspiration/trash`)).json()).items[0].item.id).toBe(combined.id);
  expect((await fetch(`${base}/inspiration/restore`, json({ ids: [combined.id] }))).status).toBe(200);
  expect(store.idea(combined.id).entries).toHaveLength(2);
  expect((await inspiration.bubbles()).items.find(i => i.id === combined.id)?.sources).toHaveLength(2);
});

it('keeps local-origin protections, explicit revision validation and English errors around the extension', async () => {
  const cross = await fetch(`${base}/inspiration`, { ...json({ title: 'No' }), headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' } }); expect(cross.status).toBe(403);
  const bubble = inspiration.add({ title: 'Flower' });
  const stale = await fetch(`${base}/inspiration/${bubble.id}`, { ...json({ title: 'Changed' }), method: 'PATCH' }); expect(stale.status).toBe(400);
  const english = await fetch(`${base}/inspiration/${bubble.id}/brainstorm`, { ...json({ purpose: 'wrong' }), headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en' } });
  expect(english.status).toBe(400); expect((await english.json()).message).toBe('Invalid brainstorm purpose.');
  expect((await (await fetch(`${base}/inspiration`, { headers: { 'Accept-Language': 'en' } })).json()).ai.message).toContain('local model');
});
