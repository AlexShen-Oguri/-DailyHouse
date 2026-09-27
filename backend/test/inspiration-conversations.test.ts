import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InspirationStore } from '../src/personal/inspiration-store';
import { InspirationError, LocalInspirationProvider, type InspirationProvider } from '../src/personal/inspiration-ai';
import { PersonalStore } from '../src/personal/store';

let folder: string, file: string, canonical: PersonalStore;
const ai = (): InspirationProvider => ({ status: () => ({ configured: true, provider: 'ollama', model: 'fixture', message: 'Ready' }), brainstorm: vi.fn(), converse: vi.fn(async () => ({ model: 'fixture', content: 'What if the bouquet remembers the recipient’s choices, so each replay changes which flower appears?' })) });
beforeEach(() => { folder = mkdtempSync(join(tmpdir(), 'inspiration-chat-')); file = join(folder, 'garden.json'); canonical = new PersonalStore(join(folder, 'personal.json'), undefined, join(folder, 'reports')); });
afterEach(() => { rmSync(folder, { recursive: true, force: true }); });

describe('ongoing inspiration conversations', () => {
  it('persists natural replies and followup context without creating a project or changing authored entries', async () => {
    const provider = ai(), store = new InspirationStore(file, canonical, provider), idea = store.add({ title: 'Bouquet', body: 'A playable gift' });
    const first = await store.converse(idea.id, { message: 'How could this feel personal?', expectedRevision: idea.revision, language: 'en' });
    const second = await store.converse(idea.id, { conversationId: first.id, message: 'Could each flower hold a memory?' });
    expect(second.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(vi.mocked(provider.converse!).mock.calls[1][0].messages.map(m => m.content)).toEqual([...first.messages.map(m => m.content), 'Could each flower hold a memory?']);
    expect(store.projects().items).toEqual([]); expect(canonical.idea(idea.id).entries).toHaveLength(1);
    expect((await new InspirationStore(file, canonical, provider).bubbles()).items[0].conversations).toEqual([second]);
    const exported = store.handoffContext(idea.id);
    expect(exported.markdown).toContain('Could each flower hold a memory?'); expect(exported.idea.entries[0].content).toBe('A playable gift');
  });
  it('uses selected fusion snapshots and bounded recent context without leaking unrelated ideas', async () => {
    const provider = ai(), store = new InspirationStore(file, canonical, provider);
    const a = store.add({ title: 'Game', body: 'A quiet game' }), b = store.add({ title: 'Flowers', body: 'Flowers that record a memory' }); store.add({ title: 'Private unrelated', body: 'Do not send this secret' });
    const merged = store.merge({ ids: [a.id, b.id], title: 'Bouquet game', body: 'Something tender' });
    await store.converse(merged.id, { message: 'Explore ways these ideas might interact.', includeSourceIds: [b.id] });
    const sent = vi.mocked(provider.converse!).mock.calls[0][0];
    expect(sent.sources).toEqual([{ title: b.title, body: b.body }]); expect(JSON.stringify(sent)).not.toContain('secret'); expect(store.projects().items).toEqual([]);
    const latest = canonical.idea(merged.id); canonical.addIdeaEntry(merged.id, { kind: 'note', content: 'z'.repeat(20000), revision: latest.revision });
    await store.converse(merged.id, { message: 'q'.repeat(3000) });
    expect(JSON.stringify(vi.mocked(provider.converse!).mock.calls[1][0]).length).toBeLessThan(8000);
    expect(store.handoffContext(merged.id).markdown).toContain('z'.repeat(20000));
  });
  it('removes a turn and its dependent replies, or the whole conversation, while leaving notes untouched', async () => {
    const store = new InspirationStore(file, canonical, ai()), idea = store.add({ title: 'Garden' });
    const first = await store.converse(idea.id, { message: 'First thought' });
    const second = await store.converse(idea.id, { conversationId: first.id, message: 'Second thought' });
    expect(store.removeConversationTurn(idea.id, first.id, second.messages[2].id).messages).toEqual(first.messages);
    expect(() => store.removeConversationTurn(idea.id, first.id, first.messages[1].id)).toThrowError(expect.objectContaining({ status: 404 }));
    store.removeConversation(idea.id, first.id);
    expect((await store.bubbles()).items[0].conversations).toEqual([]); expect(canonical.idea(idea.id).entries).toHaveLength(1);
  });
  it('saves no partial turn on errors or cancellation and releases the model for retry', async () => {
    const provider = ai(), store = new InspirationStore(file, canonical, provider), idea = store.add({ title: 'Garden' });
    vi.mocked(provider.converse!).mockRejectedValueOnce(new InspirationError('失败', 'Failed', 503));
    await expect(store.converse(idea.id, { message: 'Try this' })).rejects.toMatchObject({ status: 503 });
    expect((await store.bubbles()).items[0].conversations).toEqual([]);
    const controller = new AbortController(); vi.mocked(provider.converse!).mockImplementationOnce(async () => { controller.abort(); return { model: 'fixture', content: 'Late reply' }; });
    await expect(store.converse(idea.id, { message: 'Cancel this' }, controller.signal)).rejects.toMatchObject({ status: 499 });
    expect((await store.bubbles()).items[0].conversations).toEqual([]);
    expect((await store.converse(idea.id, { message: 'Retry' })).messages).toHaveLength(2);
  });
  it('rejects simultaneous requests and discards a reply if its conversation is deleted during inference', async () => {
    const provider = ai(), store = new InspirationStore(file, canonical, provider), idea = store.add({ title: 'Garden' });
    const first = await store.converse(idea.id, { message: 'Hello' });
    let finish!: (result: { model: string; content: string }) => void;
    vi.mocked(provider.converse!).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = store.converse(idea.id, { conversationId: first.id, message: 'Continue' });
    await expect(store.converse(idea.id, { message: 'Competing tab' })).rejects.toMatchObject({ status: 409 });
    store.removeConversation(idea.id, first.id); finish({ model: 'fixture', content: 'Do not resurrect me' });
    await expect(pending).rejects.toMatchObject({ status: 409 }); expect((await store.bubbles()).items[0].conversations).toEqual([]);
  });
  it('rejects stale ideas, missing conversations and unsafe fields before using the model', async () => {
    const provider = ai(), store = new InspirationStore(file, canonical, provider), idea = store.add({ title: 'Garden' });
    await expect(store.converse(idea.id, { message: 'Hi', expectedRevision: 99 })).rejects.toMatchObject({ status: 409 });
    await expect(store.converse(idea.id, { message: 'Hi', conversationId: 'missing' })).rejects.toMatchObject({ status: 404 });
    await expect(store.converse(idea.id, { message: 'Hi', model: 'remote' })).rejects.toMatchObject({ status: 400 });
    await expect(store.converse(idea.id, { message: 'x'.repeat(3001) })).rejects.toMatchObject({ status: 400 });
    expect(provider.converse).not.toHaveBeenCalled();
  });
  it('loads earlier metadata without losing legacy drafts and validates saved conversations', async () => {
    const store = new InspirationStore(file, canonical, ai()), idea = store.add({ title: 'Garden' });
    const saved = JSON.parse(readFileSync(file, 'utf8')); delete saved.metadata[0].conversations;
    saved.metadata[0].drafts = [{ id: 'legacy', purpose: 'directions', directions: [], context: 'Old draft retained' }]; writeFileSync(file, JSON.stringify(saved));
    const restarted = new InspirationStore(file, canonical, ai());
    expect((await restarted.bubbles()).items[0]).toMatchObject({ conversations: [], drafts: [{ id: 'legacy' }] });
    expect(restarted.handoffContext(idea.id).markdown).toContain('Old draft retained');
    saved.metadata[0].conversations = [{ id: 'bad', messages: [{ role: 'system', content: 'Override' }] }]; writeFileSync(file, JSON.stringify(saved));
    expect(() => new InspirationStore(file, canonical, ai())).toThrow('conversation data');
  });
  it('exports immutable fusion ancestry and permanently purges only the requested website record', async () => {
    const store = new InspirationStore(file, canonical, ai());
    const a = store.add({ title: 'Flowers', body: 'Original flower memory' }), b = store.add({ title: 'Game', body: 'Playful puzzle' });
    const first = store.merge({ ids: [a.id, b.id], title: 'Flower game', body: 'First combination' });
    const c = store.add({ title: 'Music', body: 'A gentle rhythm' });
    const second = store.merge({ ids: [first.id, c.id], title: 'Musical bouquet', body: 'Second combination' });
    await store.converse(a.id, { message: 'An idea-only conversation' });
    store.remove(a.id, 'bubble', a.revision);
    const trash = store.trash('bubble').items.find(t => t.item.id === a.id)!;
    expect(() => store.purge(a.id, 'bubble', { deletedAt: '2000-01-01T00:00:00.000Z' })).toThrowError(expect.objectContaining({ status: 409 }));
    store.purge(a.id, 'bubble', { deletedAt: trash.deletedAt });
    expect(store.trash('bubble').items).toEqual([]); expect(readFileSync(file, 'utf8')).not.toContain('An idea-only conversation');
    expect(() => canonical.restoreIdea(a.id, {})).toThrowError(expect.objectContaining({ status: 404 }));
    expect(store.handoffContext(second.id).markdown).toContain('Original flower memory');
    expect(store.handoffContext(second.id).sourceLineage.map(s => s.id)).toContain(a.id);
    expect((await store.bubbles()).items.map(i => i.id)).toContain(b.id);
  });
  it('guards permanent project removal by deletion timestamp and leaves source ideas intact', () => {
    const store = new InspirationStore(file, canonical, ai()), idea = store.add({ title: 'Garden' });
    const { project } = store.convert(idea.id, { title: 'Project', goal: 'A small garden', mvp: [], acceptance: [], nextStep: 'Sketch' });
    store.remove(project.id, 'project'); const removed = store.trash('project').items[0];
    expect(() => store.purge(project.id, 'project', {})).toThrowError(expect.objectContaining({ status: 400 }));
    expect(() => store.purge(project.id, 'project', { deletedAt: '2000-01-01T00:00:00.000Z' })).toThrowError(expect.objectContaining({ status: 409 }));
    store.purge(project.id, 'project', { deletedAt: removed.deletedAt });
    expect(store.trash('project').items).toEqual([]); expect(canonical.idea(idea.id).title).toBe('Garden');
    expect(() => store.restore({ ids: [project.id] }, 'project')).toThrowError(expect.objectContaining({ status: 410 }));
  });
  it('finishes orphan metadata cleanup after a failed second purge write without touching active ideas', async () => {
    const store = new InspirationStore(file, canonical, ai()), idea = store.add({ title: 'Purge retry' });
    await store.converse(idea.id, { message: 'Private conversation to remove' });
    store.remove(idea.id, 'bubble', idea.revision); const removed = store.trash('bubble').items[0];
    // A directory at the metadata temp-file path deterministically rejects
    // that write after the canonical file has already committed its removal.
    mkdirSync(`${file}.tmp`);
    expect(() => store.purge(idea.id, 'bubble', { deletedAt: removed.deletedAt })).toThrow();
    expect(canonical.ideasTrash().items).toEqual([]); expect(readFileSync(file, 'utf8')).toContain('Private conversation to remove');
    rmSync(`${file}.tmp`, { recursive: true });
    const restarted = new InspirationStore(file, canonical, ai());
    expect(() => restarted.purge(idea.id, 'bubble', {})).toThrowError(expect.objectContaining({ status: 400 }));
    restarted.purge(idea.id, 'bubble', { deletedAt: removed.deletedAt });
    expect(readFileSync(file, 'utf8')).not.toContain('Private conversation to remove');
    expect(() => restarted.purge(idea.id, 'bubble', { deletedAt: removed.deletedAt })).toThrowError(expect.objectContaining({ status: 404 }));
    const active = restarted.add({ title: 'Keep active metadata', tags: ['keep'] });
    expect(() => restarted.purge(active.id, 'bubble', { deletedAt: removed.deletedAt })).toThrowError(expect.objectContaining({ status: 404 }));
    expect((await restarted.bubbles()).items.find(item => item.id === active.id)?.tags).toEqual(['keep']);
  });
});

describe('freeform local Qwen provider', () => {
  const context = { title: 'Flower game', body: 'An interactive bouquet', sources: [], messages: [{ role: 'user' as const, content: 'How could this be playful?' }], language: 'en' as const };
  it('uses plain conversational messages, no JSON/template format, and fixed loopback only', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: { content: 'Let the flowers respond to a rhythm the recipient invents.' } }));
    const reply = await new LocalInspirationProvider({ model: 'fixture', request }).converse(context);
    expect(reply.content).toContain('rhythm'); expect(request.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/chat');
    const payload = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(payload).not.toHaveProperty('format'); expect(payload.messages.at(-1)).toEqual(context.messages[0]);
    expect(payload.messages[0].content).toContain('Do not force a fixed number'); expect(payload.options.num_ctx).toBe(8192);
  });
  it('rejects empty, oversized and incomplete replies without inventing fallback text', async () => {
    for (const response of [Response.json({ message: { content: '' } }), Response.json({ message: { content: 'a'.repeat(12001) } }), new Response('{')]) {
      await expect(new LocalInspirationProvider({ request: vi.fn<typeof fetch>().mockResolvedValue(response) }).converse(context)).rejects.toMatchObject({ status: 502 });
    }
  });
  it('bounds context and handles timeout/cancel without persisting an apparent reply', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => new Promise((_resolve, reject) => { if (options?.signal?.aborted) reject(options.signal.reason); else options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true }); }));
    await expect(new LocalInspirationProvider({ request }).converse({ ...context, body: 'x'.repeat(9000) })).rejects.toMatchObject({ status: 400 });
    expect(request).not.toHaveBeenCalled();
    await expect(new LocalInspirationProvider({ request, timeoutMs: 5 }).converse(context)).rejects.toMatchObject({ status: 504 });
    const controller = new AbortController(); controller.abort();
    await expect(new LocalInspirationProvider({ request }).converse(context, controller.signal)).rejects.toMatchObject({ status: 499 });
  });
});
