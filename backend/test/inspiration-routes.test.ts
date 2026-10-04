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
const provider: InspirationProvider = { status: vi.fn(() => ({ configured: false, provider: 'ollama', model: 'fixture', message: '本机未运行' })), brainstorm: vi.fn(), converse: vi.fn(async () => ({ model: 'fixture', content: 'The flowers could respond without requiring a puzzle.' })) };
beforeEach(async () => {
  vi.mocked(provider.status).mockClear(); vi.mocked(provider.converse!).mockClear(); vi.mocked(provider.brainstorm).mockClear();
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
  expect(english.status).toBe(410); expect((await english.json()).message).toContain('have been removed');
  expect((await (await fetch(`${base}/inspiration`, { headers: { 'Accept-Language': 'en' } })).json())).not.toHaveProperty('ai'); expect(provider.status).not.toHaveBeenCalled(); expect(provider.brainstorm).not.toHaveBeenCalled();
});

it('retires generation while preserving legacy conversations and their deletion lifecycle', async () => {
  const bubble = inspiration.add({ title: 'Flower', body: 'A gentle interactive gift' });
  // Seed historical data directly with a synthetic provider, then exercise only
  // public routes. No active API route can generate or continue a conversation.
  const conversation = await inspiration.converse(bubble.id, { message: 'Historical question', expectedRevision: bubble.revision });
  vi.mocked(provider.converse!).mockClear();
  const reply = await fetch(`${base}/inspiration/${bubble.id}/conversations`, json({ message: 'New question' })); expect(reply.status).toBe(410); expect(provider.converse).not.toHaveBeenCalled();
  expect((await inspiration.bubbles()).items[0].conversations?.[0]).toEqual(conversation);
  const reloaded = new InspirationStore(join(root, 'inspiration.json'), store, provider); expect((await reloaded.bubbles()).items[0].conversations?.[0]).toEqual(conversation);
  const fullRemoved = await fetch(`${base}/inspiration/${bubble.id}/conversations/${conversation.id}`, { ...json({}), method: 'DELETE' }); expect(fullRemoved.status).toBe(204);
  inspiration.remove(bubble.id, 'bubble', bubble.revision); const trashed = inspiration.trash('bubble').items[0];
  const missingTimestamp = await fetch(`${base}/ideas/trash/${bubble.id}`, { ...json({}), method: 'DELETE' }); expect(missingTimestamp.status).toBe(400);
  const purged = await fetch(`${base}/ideas/trash/${bubble.id}`, { ...json({ deletedAt: trashed.deletedAt }), method: 'DELETE' }); expect(purged.status).toBe(204); expect(inspiration.trash('bubble').items).toEqual([]); expect(store.ideasTrash().items).toEqual([]);
  expect((await fetch(`${base}/inspiration/restore`, json({ ids: [bubble.id] }))).status).toBe(410);
});

it('retires the model probe without reading ideas, talking to Ollama or bypassing origin checks', async () => {
  inspiration.add({ title: 'Private fixture idea', body: 'Keep this out of status responses' });
  const response = await fetch(`${base}/inspiration/ai`, { headers: { 'Accept-Language': 'en' } }); expect(response.status).toBe(410); const result = await response.json(); expect(result.message).toContain('have been removed'); expect(JSON.stringify(result)).not.toContain('Private fixture'); expect(provider.status).not.toHaveBeenCalled();
  expect((await fetch(`${base}/inspiration/ai`, { headers: { Origin: 'https://untrusted.example' } })).status).toBe(403);
});
