import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadingClassificationError, type ReadingClassificationInput, type ReadingClassificationResult, type ReadingClassifier } from '../src/personal/reading-ai';
import { ReadingClassificationService, type ReadingClassificationStore, type ReadingClassificationUpdate } from '../src/personal/reading-classification-service';
import { PersonalStore } from '../src/personal/store';

const result = (inputs: ReadingClassificationInput[]): ReadingClassificationResult => ({ provider: 'ollama', model: 'fixture:4b', status: 'classified', suggestions: inputs.map(item => ({ id: item.id, category: 'design', confidence: 'high', reason: '标题包含设计教学信息。', needsReview: false })) });
function fixture(count: number) {
  const rows = new Map(Array.from({ length: count }, (_, i) => [`reading:${i}`, { input: { id: `reading:${i}`, title: '设计入门', type: 'article' as const }, revision: 1, status: 'pending', saved: undefined as ReadingClassificationUpdate | undefined }]));
  const store: ReadingClassificationStore = {
    pendingReadingClassifications(ids) { return [...rows.values()].filter(row => row.status === 'pending' && (!ids || ids.includes(row.input.id))).map(row => ({ input: { ...row.input }, revision: row.revision })); },
    startReadingClassification(id) { const row = rows.get(id)!; row.revision++; row.status = 'pending'; return { input: row.input, revision: row.revision }; },
    applyReadingClassification(id, revision, update) { const row = rows.get(id); if (!row || row.revision !== revision || row.status !== 'pending') return null; row.saved = update; row.status = update.error ? 'failed' : update.needsReview ? 'review' : 'ready'; return row; },
  };
  return { rows, store };
}

describe('durable reading classification worker', () => {
  it('resumes pending items in batches of eight, deduplicates queued IDs and uses one worker', async () => {
    const { store, rows } = fixture(17); let active = 0, maxActive = 0;
    const classify = vi.fn<ReadingClassifier['classify']>().mockImplementation(async input => { active++; maxActive = Math.max(maxActive, active); await Promise.resolve(); active--; return result(input); });
    const service = new ReadingClassificationService(store, { classify });
    service.resume(); service.enqueue(['reading:0']); await service.idle();
    expect(classify.mock.calls.map(([input]) => input.length)).toEqual([8, 8, 1]); expect(maxActive).toBe(1);
    expect([...rows.values()].every(row => row.status === 'ready' && row.saved?.model === 'fixture:4b')).toBe(true);
  });

  it('marks offline work failed once, sanitizes errors and only retries explicitly', async () => {
    const { store, rows } = fixture(1);
    const classify = vi.fn<ReadingClassifier['classify']>().mockRejectedValueOnce(new ReadingClassificationError('unavailable', 'secret token path', 'private details', 503)).mockImplementation(async input => result(input));
    const service = new ReadingClassificationService(store, { classify });
    service.resume(); await service.idle(); service.resume(); await service.idle();
    expect(classify).toHaveBeenCalledTimes(1); expect(rows.get('reading:0')?.saved?.error).not.toContain('secret'); expect(rows.get('reading:0')?.status).toBe('failed');
    expect(service.retry('reading:0')).toEqual({ id: 'reading:0', status: 'pending' }); await service.idle();
    expect(classify).toHaveBeenCalledTimes(2); expect(rows.get('reading:0')?.status).toBe('ready');
  });

  it('carries original revisions so a slow result cannot overwrite edits or resurrect removed entries', async () => {
    const { store, rows } = fixture(2); let release!: (value: ReadingClassificationResult) => void;
    const classify = vi.fn<ReadingClassifier['classify']>().mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const service = new ReadingClassificationService(store, { classify }); service.resume(); await Promise.resolve();
    const original = classify.mock.calls[0][0]; const edited = rows.get('reading:0')!; edited.revision++; edited.status = 'manual'; rows.delete('reading:1');
    release(result(original)); await service.idle();
    expect(rows.size).toBe(1); expect(edited.status).toBe('manual'); expect(edited.saved).toBeUndefined();
  });

  it('retains pending items on shutdown so restarting can resume without an endless retry loop', async () => {
    const { store, rows } = fixture(1);
    const classify = vi.fn<ReadingClassifier['classify']>().mockImplementation(async (_input, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })));
    const service = new ReadingClassificationService(store, { classify }); service.resume(); await Promise.resolve(); await service.stop();
    expect(rows.get('reading:0')?.status).toBe('pending'); service.resume(); expect(classify).toHaveBeenCalledTimes(1);
    const resumed = new ReadingClassificationService(store, { classify: async input => result(input) }); resumed.resume(); await resumed.idle(); expect(rows.get('reading:0')?.status).toBe('ready');
  });

  it('preserves review suggestions and contains persistence failures without repeated model calls', async () => {
    const { store, rows } = fixture(1);
    const service = new ReadingClassificationService(store, { classify: async input => ({ ...result(input), suggestions: result(input).suggestions.map(row => ({ ...row, confidence: 'low', needsReview: true })) }) });
    service.resume(); await service.idle(); expect(rows.get('reading:0')?.status).toBe('review');
    const onError = vi.fn(); const broken = fixture(1); broken.store.applyReadingClassification = () => { throw new Error('disk full'); };
    const classify = vi.fn<ReadingClassifier['classify']>().mockImplementation(async input => result(input));
    const worker = new ReadingClassificationService(broken.store, { classify }, onError); worker.resume(); await worker.idle();
    expect(onError).toHaveBeenCalledTimes(1); expect(classify).toHaveBeenCalledTimes(1); expect(broken.rows.get('reading:0')?.status).toBe('pending');
  });
});

describe('classification with the persistent shelf', () => {
  const roots: string[] = [];
  afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
  function persisted() { const root = mkdtempSync(join(tmpdir(), 'garden-classification-')); roots.push(root); const file = join(root, 'personal.json'); return { file, store: new PersonalStore(file, undefined, join(root, 'reports')) }; }

  it('persists uncertain suggestions for review and resumes pending state after reload', async () => {
    const { file, store } = persisted();
    const item = store.addReading({ title: '混合设计资料', type: 'book' });
    const reloaded = new PersonalStore(file);
    const service = new ReadingClassificationService(reloaded, { classify: async input => ({ ...result(input), suggestions: result(input).suggestions.map(row => ({ ...row, confidence: 'medium', needsReview: true })) }) });
    service.resume(); await service.idle();
    expect(new PersonalStore(file).reading().items.find(row => row.id === item.id)).toMatchObject({ category: 'other', classification: { status: 'review', suggestedCategory: 'design', confidence: 'medium', model: 'fixture:4b' } });
  });

  it('protects real manual changes and deletions made while the model is running', async () => {
    const { store } = persisted();
    const a = store.addReading({ title: '设计课程', type: 'book' }); const b = store.addReading({ title: '可移除条目', type: 'book' });
    let release!: (value: ReadingClassificationResult) => void;
    const classify = vi.fn<ReadingClassifier['classify']>().mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const service = new ReadingClassificationService(store, { classify }); service.resume(); await Promise.resolve();
    store.editReading(a.id, { category: 'science' }); store.removeReading({ ids: [b.id] });
    release(result(classify.mock.calls[0][0])); await service.idle();
    expect(store.reading().items.find(row => row.id === a.id)).toMatchObject({ category: 'science', classification: { status: 'manual' } });
    expect(store.reading().items.some(row => row.id === b.id)).toBe(false); expect(store.readingTrash().items.some(row => row.item.id === b.id)).toBe(true);
  });

  it('keeps CLI import undo valid after automatic Qwen enrichment', async () => {
    const { store } = persisted();
    const imported = store.importReading({ items: [{ title: 'Python 编程入门教程', url: 'https://www.bilibili.com/video/BV1000000001/', progress: 0.1, viewedAt: new Date(Date.now() - 1000).toISOString() }] });
    expect(imported.items).toHaveLength(1);
    const service = new ReadingClassificationService(store, { classify: async input => result(input) }); service.enqueue(imported.batch.itemIds); await service.idle();
    expect(store.reading().items.find(row => row.id === imported.items[0].id)).toMatchObject({ category: 'design', classification: { status: 'ready' } });
    const undone = store.undoReadingImport(imported.batch.id);
    expect(undone).toMatchObject({ removedIds: [imported.items[0].id], conflictIds: [] });
    expect(store.reading().items.some(row => row.id === imported.items[0].id)).toBe(false);
  });

  it('resumes a restored pending item without letting the pre-deletion result overwrite it', async () => {
    const { store } = persisted();
    const item = store.addReading({ title: '设计材料', type: 'book' });
    const releases: ((value: ReadingClassificationResult) => void)[] = [];
    const classify = vi.fn<ReadingClassifier['classify']>().mockImplementation(() => new Promise(resolve => { releases.push(resolve); }));
    const service = new ReadingClassificationService(store, { classify }); service.enqueue([item.id]); await Promise.resolve();
    store.removeReading({ ids: [item.id] }); store.restoreReading({ ids: [item.id] }); service.enqueue([item.id]);
    releases[0](result(classify.mock.calls[0][0]));
    await vi.waitFor(() => expect(classify).toHaveBeenCalledTimes(2));
    expect(store.reading().items.find(row => row.id === item.id)).toMatchObject({ category: 'other', classification: { status: 'pending' } });
    const fresh = result(classify.mock.calls[1][0]); fresh.suggestions[0].category = 'science'; releases[1](fresh); await service.idle();
    expect(store.reading().items.find(row => row.id === item.id)).toMatchObject({ category: 'science', classification: { status: 'ready' } });
  });
});
