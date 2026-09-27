import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonalStore } from '../src/personal/store';

let root: string;
let file: string;
const url = (n: number) => `https://www.bilibili.com/video/BV${String(n).padStart(10, '0')}/`;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dailyhouse-reading-v2-')); file = join(root, 'personal.json'); });
afterEach(() => { vi.useRealTimers(); rmSync(root, { recursive: true, force: true }); });

describe('reading workflow retirement', () => {
  it('erases the old ledger once while preserving content, tasks, report state, trash and removed-source memory', () => {
    const store = new PersonalStore(file, undefined, join(root, 'reports'));
    const saved = store.addReading({ title: 'Completed course', type: 'video', url: url(1), category: 'design', notes: 'My own observations', status: 'done' });
    const discarded = store.addReading({ title: 'Removed material', type: 'video', url: url(2), category: 'science' });
    store.deleteReading(discarded.id);
    const todo = store.addReadingTodo(saved.id, {}).todo;
    const old = JSON.parse(readFileSync(file, 'utf8'));
    delete old.readingWorkflowVersion;
    old.readingItems[0].importBatchId = 'legacy:batch';
    old.readingItems[0].classification = { status: 'review', model: 'fixture', confidence: 'low', suggestedCategory: 'science' };
    old.readingTrash[0].expiresAt = '2000-01-01T00:00:00.000Z';
    old.readingReports = { 'report:tech:2026-09-26': { status: 'done', lastReadVersion: 'fixture-version', hidden: true, category: 'humanities' } };
    old.readingImports = [{ id: 'legacy:batch', createdAt: saved.addedAt, itemIds: [saved.id], candidates: [{ title: 'obsolete candidate detail' }], counts: {}, fingerprints: {}, revisions: {} }];
    writeFileSync(file, JSON.stringify(old));
    const reloaded = new PersonalStore(file, undefined, join(root, 'reports'));
    const migrated = JSON.parse(readFileSync(file, 'utf8'));
    const expected = structuredClone(old);
    expected.readingWorkflowVersion = 2;
    expected.readingImports = [];
    expected.readingItems[0].classification = { status: 'ready', model: 'fixture', confidence: 'low' };
    expect(migrated).toEqual(expected);
    expect(readFileSync(file, 'utf8')).not.toContain('obsolete candidate detail');
    expect(reloaded.readingImports()).toEqual({ items: [] });
    expect(reloaded.reading()).not.toHaveProperty('importCount');
    expect(reloaded.todos().find(item => item.id === todo.id)).toMatchObject({ id: todo.id, source: { id: saved.id, available: true } });
    const once = readFileSync(file, 'utf8');
    new PersonalStore(file, undefined, join(root, 'reports'));
    expect(readFileSync(file, 'utf8')).toBe(once);
    const candidate = { title: 'Removed material returns', url: url(2), viewedAt: new Date().toISOString(), progress: 0.05, category: 'science' };
    expect(reloaded.importCuratedReading({ items: [candidate] })).toEqual({ items: [], skipped: 1 });
  });

  it('refuses unknown workflow versions without overwriting their data', () => {
    new PersonalStore(file).addTodo({ title: 'Keep me' });
    const saved = JSON.parse(readFileSync(file, 'utf8')); saved.readingWorkflowVersion = 99;
    const raw = JSON.stringify(saved); writeFileSync(file, raw);
    expect(() => new PersonalStore(file)).toThrow('reading data is invalid');
    expect(readFileSync(file, 'utf8')).toBe(raw);
  });

  it('rejects overrides and non-Bilibili evidence before considering any eligible prefix', () => {
    const store = new PersonalStore(file, undefined, join(root, 'reports'));
    const evidence = { title: 'Useful lesson', url: url(3), viewedAt: new Date().toISOString(), progress: 0.1 };
    expect(() => store.curatedReadingCandidates({ items: [evidence], acceptedUrls: [evidence.url] })).toThrow();
    expect(() => store.curatedReadingCandidates({ items: [evidence, { ...evidence, url: 'https://example.com/video' }] })).toThrow('B 站');
    expect(() => store.importCuratedReading({ items: [{ ...evidence, category: 'science', accepted: true }] })).toThrow();
    expect(() => store.importCuratedReading({ items: [{ ...evidence, category: 'programming' }] })).toThrow('分类');
    expect(store.reading().items).toEqual([]);
  });
});
