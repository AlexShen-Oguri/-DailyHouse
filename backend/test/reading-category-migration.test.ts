import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonalStore } from '../src/personal/store';
import { readingFingerprint } from '../src/personal/reading-lifecycle';

let dir: string;
let file: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dailyhouse-category-')); file = join(dir, 'fixture.json'); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('compatible category consolidation', () => {
  it('presents legacy categories without rewriting notes, timestamps or stored data', () => {
    const store = new PersonalStore(file);
    store.addReading({ title: 'Saved lesson', type: 'book', notes: 'My notes', status: 'done' });
    const legacy = JSON.parse(readFileSync(file, 'utf8'));
    legacy.readingItems[0].category = 'ai';
    writeFileSync(file, JSON.stringify(legacy));
    const saved = readFileSync(file, 'utf8');
    const reloaded = new PersonalStore(file);
    expect(reloaded.reading().items[0]).toMatchObject({ ...legacy.readingItems[0], category: 'programming_ai' });
    expect(readFileSync(file, 'utf8')).toBe(saved);
  });

  it('normalizes old import candidates while preserving eligibility to undo untouched imported items', () => {
    const store = new PersonalStore(file);
    const result = store.importReading({ items: [{ title: 'Python tutorial', url: 'https://www.bilibili.com/video/BV0000000001/', viewedAt: new Date().toISOString(), progress: 0.1 }] });
    const legacy = JSON.parse(readFileSync(file, 'utf8'));
    legacy.readingItems[0].category = 'programming';
    legacy.readingImports[0].candidates[0].category = 'programming';
    legacy.readingImports[0].fingerprints[result.items[0].id] = readingFingerprint(legacy.readingItems[0]);
    writeFileSync(file, JSON.stringify(legacy));
    const reloaded = new PersonalStore(file);
    expect(reloaded.readingImports().items[0].candidates[0].category).toBe('programming_ai');
    expect(reloaded.editReading(result.items[0].id, { coverUrl: 'https://i0.hdslb.com/bfs/archive/fixture.jpg' }).category).toBe('programming_ai');
    expect(reloaded.undoReadingImport(result.batch.id).removedIds).toEqual([result.items[0].id]);
    expect(reloaded.readingTrash().items[0].item.category).toBe('programming_ai');
    reloaded.restoreReading({ ids: [result.items[0].id] });
    expect(reloaded.reading().items[0].category).toBe('programming_ai');
  });

  it('creates one linked project task atomically and never resurrects a deleted task on retry', () => {
    const store = new PersonalStore(file);
    const first = store.addProjectTodo('project:fixture', 'Try the prototype');
    expect(first).toMatchObject({ created: true, deleted: false });
    const reloaded = new PersonalStore(file);
    expect(reloaded.addProjectTodo('project:fixture', 'A retry title')).toMatchObject({ todoId: first.todoId, created: false, deleted: false });
    expect(reloaded.todos()).toHaveLength(1);
    reloaded.deleteTodo(first.todoId);
    expect(new PersonalStore(file).addProjectTodo('project:fixture', 'Try again')).toEqual({ todoId: first.todoId, created: false, deleted: true });
    expect(new PersonalStore(file).todos()).toHaveLength(0);
  });
});
