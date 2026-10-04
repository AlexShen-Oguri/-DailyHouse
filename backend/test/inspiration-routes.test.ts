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
const provider: InspirationProvider = { status: () => ({ configured: false, provider: 'ollama', model: 'fixture', message: '本机未运行' }), brainstorm: vi.fn(), converse: vi.fn(async () => ({ model: 'fixture', content: 'The flowers could respond without requiring a puzzle.' })) };
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
  expect((await (await fetch(`${base}/inspiration`, { headers: { 'Accept-Language': 'en' } })).json()).ai.message).toContain('local Ollama');
});

it('supports followups and explicit conversation deletion, then purges idea metadata through the canonical alias', async () => {
  const bubble = inspiration.add({ title: 'Flower', body: 'A gentle interactive gift' });
  const reply = await fetch(`${base}/inspiration/${bubble.id}/conversations`, json({ message: 'How can this be playful?', expectedRevision: bubble.revision }));
  expect(reply.status).toBe(201); const conversation = await reply.json(); expect(conversation.messages).toHaveLength(2);
  const followup = await fetch(`${base}/inspiration/${bubble.id}/conversations`, json({ message: 'Can it simply react to touch?', conversationId: conversation.id }));
  expect(followup.status).toBe(201); const continued = await followup.json(); expect(continued.messages).toHaveLength(4);
  const turnRemoved = await fetch(`${base}/inspiration/${bubble.id}/conversations/${conversation.id}/turns/${continued.messages[2].id}`, { ...json({}), method: 'DELETE' });
  expect(turnRemoved.status).toBe(200); expect((await turnRemoved.json()).messages).toHaveLength(2);
  const fullRemoved = await fetch(`${base}/inspiration/${bubble.id}/conversations/${conversation.id}`, { ...json({}), method: 'DELETE' }); expect(fullRemoved.status).toBe(204);
  await fetch(`${base}/inspiration/${bubble.id}/conversations`, json({ message: 'This will be removed with the idea' }));
  inspiration.remove(bubble.id, 'bubble', bubble.revision);
  const trashed = inspiration.trash('bubble').items[0];
  const missingTimestamp = await fetch(`${base}/ideas/trash/${bubble.id}`, { ...json({}), method: 'DELETE' }); expect(missingTimestamp.status).toBe(400);
  const purged = await fetch(`${base}/ideas/trash/${bubble.id}`, { ...json({ deletedAt: trashed.deletedAt }), method: 'DELETE' }); expect(purged.status).toBe(204);
  expect(inspiration.trash('bubble').items).toEqual([]); expect(store.ideasTrash().items).toEqual([]);
  expect((await fetch(`${base}/inspiration/restore`, json({ ids: [bubble.id] }))).status).toBe(410);
});

it('returns only current model status through the protected lightweight probe', async () => {
  inspiration.add({ title: 'Private fixture idea', body: 'Keep this out of status responses' });
  const response = await fetch(`${base}/inspiration/ai`, { headers: { 'Accept-Language': 'en' } });
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store'); const status = await response.json(); expect(status).toMatchObject({ configured: false, model: 'fixture', provider: 'ollama' }); expect(JSON.stringify(status)).not.toContain('Private fixture'); expect(status).not.toHaveProperty('items');
  expect((await fetch(`${base}/inspiration/ai`, { headers: { Origin: 'https://untrusted.example' } })).status).toBe(403);
});
