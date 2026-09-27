import { afterEach, beforeEach, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { PersonalStore } from '../src/personal/store';
import { createPersonalApp } from '../src/personal/app';

let root: string; let file: string; let store: PersonalStore; let server: Server | undefined;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'garden-purge-')); file = join(root, 'personal.json'); store = new PersonalStore(file, undefined, join(root, 'reports')); });
afterEach(async () => {
  if (server) { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; server = undefined; }
  rmSync(root, { recursive: true, force: true });
});

it('permanently removes a reading snapshot while preserving source suppression and other records', () => {
  const url = 'https://www.bilibili.com/video/BV1234567890/';
  const item = store.addReading({ title: 'Python tutorial', type: 'video', url, notes: 'private-purge-note' });
  const keep = store.addReading({ title: 'Retain this book', type: 'book' });
  store.deleteReading(item.id);
  const entry = store.readingTrash().items[0];
  expect(() => store.purgeReading(item.id, { deletedAt: '2020-01-01T00:00:00Z' })).toThrow('已变更');
  expect(store.readingTrash().items).toHaveLength(1);
  expect(store.purgeReading(item.id, { deletedAt: entry.deletedAt })).toEqual({ deletedId: item.id });
  const reloaded = new PersonalStore(file, undefined, join(root, 'reports'));
  expect(reloaded.reading().items.map(value => value.id)).toEqual([keep.id]);
  expect(reloaded.readingTrash().items).toEqual([]);
  expect(() => reloaded.restoreReading({ ids: [item.id] })).toThrow();
  expect(reloaded.previewReadingImport({ items: [{ title: 'Python tutorial', url, viewedAt: new Date().toISOString(), progress: 0.1 }] }).candidates[0].decision).toBe('suppressed');
  expect(readFileSync(file, 'utf8')).not.toContain('private-purge-note');
});

it('deletes only the owned document copy and keeps a selected original intact', async () => {
  const original = join(root, 'original.txt'); writeFileSync(original, 'Local file fixture');
  const upload = await store.readingAttachments.stage('original.txt', Readable.from(readFileSync(original)));
  const item = store.importQuickReading({ items: [{ uploadId: upload.uploadId }] }).items[0];
  const copy = store.readingAttachment(item.id).path;
  store.deleteReading(item.id);
  store.purgeReading(item.id, { deletedAt: store.readingTrash().items[0].deletedAt });
  expect(existsSync(copy)).toBe(false);
  expect(readFileSync(original, 'utf8')).toBe('Local file fixture');
});

it('retains a shared managed attachment until its last live or recoverable reference is purged', async () => {
  const first = await store.readingAttachments.stage('shared.txt', Readable.from('Shared bytes'));
  const a = store.importQuickReading({ items: [{ uploadId: first.uploadId }] }).items[0];
  const copy = store.readingAttachment(a.id).path;
  store.deleteReading(a.id);
  // The fixture models a historical shared reference, which can also occur
  // after migrating a pre-deduplication library.
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  saved.readingItems.push({ ...saved.readingTrash[0].item, id: 'reading:shared-fixture' });
  writeFileSync(file, JSON.stringify(saved)); store = new PersonalStore(file);
  store.purgeReading(a.id, { deletedAt: store.readingTrash().items[0].deletedAt });
  expect(existsSync(copy)).toBe(true);
});

it('rolls back the owned file quarantine if the metadata save fails', async () => {
  const upload = await store.readingAttachments.stage('rollback.txt', Readable.from('Recoverable bytes'));
  const item = store.importQuickReading({ items: [{ uploadId: upload.uploadId }] }).items[0];
  const copy = store.readingAttachment(item.id).path;
  store.deleteReading(item.id);
  renameSync(file, `${file}.fixture-backup`); mkdirSync(file);
  expect(() => store.purgeReading(item.id, { deletedAt: store.readingTrash().items[0].deletedAt })).toThrow();
  expect(store.readingTrash().items).toHaveLength(1);
  expect(readFileSync(copy, 'utf8')).toBe('Recoverable bytes');
});

it('recovers an interrupted file quarantine according to persisted reading references', async () => {
  const upload = await store.readingAttachments.stage('crash.txt', Readable.from('Saved bytes'));
  const item = store.importQuickReading({ items: [{ uploadId: upload.uploadId }] }).items[0];
  const copy = store.readingAttachment(item.id).path;
  const quarantine = `${copy}.aaaaaaaa-bbbb-4444-9999-111111111111.purge`;
  store.deleteReading(item.id); renameSync(copy, quarantine);
  const reloaded = new PersonalStore(file);
  expect(existsSync(quarantine)).toBe(false);
  expect(readFileSync(copy, 'utf8')).toBe('Saved bytes');
  expect(reloaded.restoreReading({ ids: [item.id] }).restoredIds).toEqual([item.id]);
});

it('purges canonical idea content with a stale-dialog guard and keeps the migration tombstone', () => {
  const idea = store.addIdea({ title: 'A seed', content: 'private-idea-purge-content' });
  store.deleteIdea(idea.id, { revision: idea.revision });
  const entry = store.ideasTrash().items[0];
  expect(() => store.purgeIdea(idea.id, {})).toThrow('删除时间');
  expect(() => store.purgeIdea(idea.id, { deletedAt: '2020-01-01T00:00:00Z' })).toThrow('已变更');
  store.purgeIdea(idea.id, { deletedAt: entry.deletedAt });
  const reloaded = new PersonalStore(file);
  expect(reloaded.ideasTrash().items).toEqual([]);
  expect(() => reloaded.addIdeaWithId(idea.id, { title: 'Legacy migration' })).toThrow('曾被删除');
  expect(readFileSync(file, 'utf8')).not.toContain('private-idea-purge-content');
});

it('exposes permanent reading deletion only for a valid local request with the current snapshot', async () => {
  const item = store.addReading({ title: 'Book', type: 'book' }); store.deleteReading(item.id);
  const entry = store.readingTrash().items[0];
  server = createPersonalApp(store).listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const endpoint = `http://127.0.0.1:${port}/api/personal/reading/trash/${encodeURIComponent(item.id)}`;
  expect((await fetch(endpoint, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: JSON.stringify({ deletedAt: entry.deletedAt }) })).status).toBe(403);
  expect((await fetch(endpoint, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(400);
  expect(await (await fetch(endpoint, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deletedAt: entry.deletedAt }) })).json()).toEqual({ deletedId: item.id });
});
