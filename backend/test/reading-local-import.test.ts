import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { request, type Server } from 'node:http';
import express from 'express';
import { PersonalStore } from '../src/personal/store';
import { mountReadingImportRoutes } from '../src/personal/reading-import-routes';
import { PersonalError } from '../src/personal/types';
import { READING_FILE_LIMIT } from '../src/personal/reading-attachments';
import { READING_TRASH_MS } from '../src/personal/reading-lifecycle';
import { createPersonalApp } from '../src/personal/app';
import { ReadingClassificationService } from '../src/personal/reading-classification-service';

let root: string; let store: PersonalStore; let server: Server | undefined;
const pdf = Buffer.from('%PDF-1.7\nfixture bytes\n%%EOF\n');
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'garden-local-import-')); store = new PersonalStore(join(root, 'personal.json'), undefined, join(root, 'reports')); });
afterEach(async () => {
  vi.useRealTimers();
  if (server) { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; server = undefined; }
  rmSync(root, { recursive: true, force: true });
});
const stage = (name = 'book.pdf', content = pdf) => store.readingAttachments.stage(name, Readable.from(content));

describe('quick reading imports', () => {
  it('previews mixed sources and honors explicit type and category without a history-progress restriction', () => {
    const preview = store.previewQuickReadingImport({ items: [
      { url: 'https://www.bilibili.com/video/BV1234567890/', title: 'Cinema lecture' },
      { url: 'https://github.com/example/project', title: 'My tool' },
      { url: 'https://example.com/course', title: 'Course', type: 'course', category: 'design' },
      { title: 'A paper book', type: 'book' },
    ] });
    expect(preview.counts.accepted).toBe(4);
    expect(preview.candidates.map(item => item.type)).toEqual(['video', 'github', 'course', 'book']);
    const result = store.importQuickReading({ items: [{ title: 'Book', category: 'science' }, { title: 'Qwen starter', url: 'https://example.com/qwen' }] });
    expect(result.items.map(item => item.classification?.status)).toEqual(['manual', 'pending']);
    expect(store.readingImports().items).toEqual([]);
    expect(result.batch.canUndo).toBe(false);
    expect(result.items.every(item => !item.importBatchId)).toBe(true);
  });

  it('copies selected bytes, deduplicates by content hash, preserves the original and supports removal/restore', async () => {
    const original = join(root, 'original.pdf'); writeFileSync(original, pdf);
    const upload = await stage('Selected Book.pdf', readFileSync(original));
    const result = store.importQuickReading({ items: [{ uploadId: upload.uploadId }] });
    const item = result.items[0];
    expect(item).toMatchObject({ title: 'Selected Book', type: 'book', url: '', sourceKey: expect.stringMatching(/^file:[a-f0-9]{64}$/), classification: { status: 'pending' } });
    expect(item.attachment?.url).toContain(encodeURIComponent(item.id));
    expect(readFileSync(store.readingAttachment(item.id).path)).toEqual(pdf);
    expect(readFileSync(original)).toEqual(pdf);
    const second = await stage('Different name.pdf');
    expect(store.previewQuickReadingImport({ items: [{ uploadId: second.uploadId }] }).candidates[0].decision).toBe('duplicate');
    store.deleteReading(item.id);
    expect(() => store.readingAttachment(item.id)).toThrow('附件不存在');
    expect(store.previewQuickReadingImport({ items: [{ uploadId: second.uploadId }] }).candidates[0].decision).toBe('suppressed');
    expect(store.restoreReading({ ids: [item.id] }).items[0]).toMatchObject({ id: item.id, attachment: item.attachment });
    expect(readFileSync(store.readingAttachment(item.id).path)).toEqual(pdf);
    expect(store.reading().items.find(row => row.id === item.id)).toMatchObject({ id: item.id, attachment: item.attachment });
    expect(readFileSync(original)).toEqual(pdf);
  });

  it('never lets classification overwrite a later edit or revive a removed item', () => {
    const result = store.importQuickReading({ items: [{ title: 'Python fundamentals', url: 'https://example.com/python' }] });
    const [pending] = store.pendingReadingClassifications();
    store.applyReadingClassification(pending.input.id, pending.revision, { category: 'programming_ai', confidence: 'high', model: 'fixture', reason: 'Python', needsReview: false });
    store.deleteReading(pending.input.id);
    expect(store.applyReadingClassification(pending.input.id, pending.revision, { category: 'other' })).toBeNull();
    store.restoreReading({ ids: [pending.input.id] });
    const current = store.startReadingClassification(pending.input.id);
    store.editReading(pending.input.id, { title: 'User title', category: 'design' });
    expect(store.applyReadingClassification(pending.input.id, current.revision, { category: 'programming_ai' })).toBeNull();
    expect(store.reading().items[0]).toMatchObject({ title: 'User title', category: 'design', classification: { status: 'manual' } });
  });

  it('retains failed imports and can retry after a restart, with low-confidence results keeping the existing category', () => {
    const result = store.importQuickReading({ items: [{ title: 'Architecture', type: 'book' }] });
    const id = result.items[0].id;
    store.applyReadingClassification(id, 0, { error: '本机模型尚未启动' });
    expect(store.reading().items[0]).toMatchObject({ id, classification: { status: 'failed' } });
    store = new PersonalStore(join(root, 'personal.json'));
    const retry = store.startReadingClassification(id);
    expect(store.pendingReadingClassifications()).toHaveLength(1);
    store.applyReadingClassification(id, retry.revision, { category: 'design', confidence: 'low', needsReview: true });
    expect(store.reading().items[0]).toMatchObject({ category: 'other', classification: { status: 'ready' } });
    store.editReading(id, { category: 'design' });
    expect(store.reading().items[0].classification?.status).toBe('manual');
  });

  it('preserves edited notes after classification is requested again', () => {
    const result = store.importQuickReading({ items: [{ title: 'Book' }] });
    const id = result.items[0].id;
    store.editReading(id, { notes: 'My new notes' });
    const retry = store.startReadingClassification(id);
    store.applyReadingClassification(id, retry.revision, { category: 'science' });
    expect(store.reading().items[0]).toMatchObject({ id, notes: 'My new notes', category: 'science' });
  });

  it('cleans abandoned uploads and expired unreferenced copies without touching live files or originals', async () => {
    const now = Date.now(); const past = new Date(now - READING_TRASH_MS - 1000);
    const original = join(root, 'original.pdf'); writeFileSync(original, pdf);
    const a = await stage(); const b = await stage('live.txt', Buffer.from('A separate document'));
    const imported = store.importQuickReading({ items: [{ uploadId: a.uploadId }, { uploadId: b.uploadId }] });
    const dead = store.readingAttachment(imported.items[0].id).path; const live = store.readingAttachment(imported.items[1].id).path;
    store.deleteReading(imported.items[0].id);
    const abandoned = await stage('abandoned.txt', Buffer.from('temporary'));
    const abandonedFile = join(store.readingAttachments.root, `${abandoned.uploadId}.upload`);
    utimesSync(dead, past, past); utimesSync(live, past, past); utimesSync(abandonedFile, past, past);
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now + READING_TRASH_MS + 1000);
    store.addTodo({ title: 'Trigger safe garbage collection' });
    expect(existsSync(dead)).toBe(false); expect(existsSync(live)).toBe(true); expect(existsSync(abandonedFile)).toBe(false); expect(existsSync(original)).toBe(true);
  });
});

describe('attachment validation and transport', () => {
  it('runs the guarded application upload/import/classification/removal/restore flow and isolates the binary exception', async () => {
    const classification = new ReadingClassificationService(store, { classify: async inputs => ({ provider: 'ollama', model: 'fixture-qwen', status: 'classified', suggestions: inputs.map(input => ({ id: input.id, category: 'programming_ai', confidence: 'high', reason: 'Programming material', needsReview: false })) }) });
    server = createPersonalApp(store, undefined, 3456, undefined, { classification }).listen(0, '127.0.0.1');
    await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error();
    const base = `http://127.0.0.1:${address.port}/api/personal/reading`;
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await fetch(`${base}/quick-import/upload?filename=note.txt`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Origin: 'https://foreign.example' }, body: 'denied' })).status).toBe(403);
    for (const path of ['', '/quick-import/preview', '/quick-import/upload/', '/imports']) {
      expect((await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: 'denied' })).status).toBe(415);
    }
    const uploadResponse = await fetch(`${base}/quick-import/upload?filename=Python.txt`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: 'Python programming tutorial' });
    expect(uploadResponse.status).toBe(201); const upload = await uploadResponse.json() as { uploadId: string };
    const body = { items: [{ uploadId: upload.uploadId }] };
    expect((await (await post('/quick-import/preview', body)).json() as { counts: { accepted: number } }).counts.accepted).toBe(1);
    const applied = await (await post('/quick-import/apply', body)).json() as { batch: { id: string }; items: { id: string }[] };
    await classification.idle();
    const id = applied.items[0].id;
    expect(store.reading().items[0]).toMatchObject({ id, category: 'programming_ai', classification: { status: 'ready', model: 'fixture-qwen' } });
    expect((await fetch(`${base}/${encodeURIComponent(id)}/attachment`)).status).toBe(200);
    const removed = await (await post('/remove', { ids: [id] })).json() as { removedIds: string[] };
    expect(removed.removedIds).toEqual([id]);
    expect((await fetch(`${base}/${encodeURIComponent(id)}/attachment`)).status).toBe(404);
    expect((await post('/restore', { ids: [id] })).status).toBe(200);
    expect((await fetch(`${base}/${encodeURIComponent(id)}/attachment`)).status).toBe(200);
    expect((await post(`/${encodeURIComponent(id)}/classify`, {})).status).toBe(202);
    await classification.idle(); await classification.stop();
  });

  it('rejects executable extensions, path names, spoofed PDF/EPUB and binary or oversized text', async () => {
    await expect(stage('../escape.pdf')).rejects.toThrow('文件名无效');
    await expect(stage('book.exe')).rejects.toThrow('仅支持');
    await expect(stage('fake.pdf', Buffer.from('<html>unsafe</html>'))).rejects.toThrow('PDF');
    await expect(stage('fake.epub', Buffer.from('PKfake archive'))).rejects.toThrow('EPUB');
    await expect(stage('binary.txt', Buffer.from([0xff, 0xfe, 0x00]))).rejects.toThrow('UTF-8');
    await expect(stage('huge.txt', Buffer.alloc(2 * 1024 * 1024 + 1, 97))).rejects.toThrow('2 MiB');
    expect(() => store.previewQuickReadingImport({ items: Array.from({ length: 31 }, () => ({ title: 'book' })) })).toThrow('1–30');
  });

  it('rejects corrupted stored attachment paths rather than exposing arbitrary files', async () => {
    const upload = await stage(); const result = store.importQuickReading({ items: [{ uploadId: upload.uploadId }] });
    const saved = JSON.parse(readFileSync(join(root, 'personal.json'), 'utf8'));
    saved.readingItems[0].attachment.id = '../outside.pdf';
    writeFileSync(join(root, 'personal.json'), JSON.stringify(saved));
    expect(() => new PersonalStore(join(root, 'personal.json'))).toThrow('reading data is invalid');
    expect(() => store.readingAttachments.path({ ...result.items[0].attachment!, id: '../outside.pdf' })).toThrow('附件记录无效');
  });

  it('accepts a valid EPUB container without extracting or executing its content, and cancellation is idempotent', async () => {
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(8, 26);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
    const epub = Buffer.concat([header, Buffer.from('mimetypeapplication/epub+zip'), end]);
    const upload = await stage('Sample.epub', epub);
    const result = store.importQuickReading({ items: [{ uploadId: upload.uploadId }] });
    expect(result.items[0].attachment?.mime).toBe('application/epub+zip');
    const cancelled = await stage('A note.md', Buffer.from('Useful notes'));
    store.readingAttachments.removeUpload(cancelled.uploadId);
    store.readingAttachments.removeUpload(cancelled.uploadId);
    expect(() => store.previewQuickReadingImport({ items: [{ uploadId: cancelled.uploadId }] })).toThrow('上传记录不存在');
    expect(() => store.readingAttachments.removeUpload('../malicious')).toThrow('上传记录不存在');
  });

  it('serves uploaded Markdown as plain text and blocks access while the entry is in trash', async () => {
    // A hidden parent directory is valid; only managed hash filenames are served.
    store = new PersonalStore(join(root, '.private-data', 'personal.json'));
    const app = express(); app.use(express.json()); mountReadingImportRoutes(app, store);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error instanceof PersonalError ? error.status : 500).json({ message: error instanceof Error ? error.message : 'error' }); });
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error();
    const base = `http://127.0.0.1:${address.port}/api/personal/reading`;
    const response = await fetch(`${base}/quick-import/upload?filename=${encodeURIComponent('Test.md')}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: '<script>alert(1)</script>\n# Practical guide' });
    expect(response.status).toBe(201); const upload = await response.json() as { uploadId: string };
    const result = store.importQuickReading({ items: [{ uploadId: upload.uploadId }] }); const id = result.items[0].id;
    const file = await fetch(`${base}/${encodeURIComponent(id)}/attachment`);
    expect(file.headers.get('content-type')).toContain('text/plain');
    expect(file.headers.get('content-security-policy')).toContain("script-src 'none'");
    expect(file.headers.get('content-security-policy')).toContain("connect-src 'none'");
    expect(file.headers.get('content-security-policy')).not.toContain('sandbox');
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await file.text()).toContain('<script>');
    const download = await fetch(`${base}/${encodeURIComponent(id)}/attachment?download=1`); expect(download.headers.get('content-disposition')).toContain('attachment');
    expect(download.headers.get('content-security-policy')).toContain('sandbox allow-downloads;');
    expect(download.headers.get('content-security-policy')).not.toContain('allow-scripts');
    store.deleteReading(id); expect((await fetch(`${base}/${encodeURIComponent(id)}/attachment`)).status).toBe(404);
    const oversizedStatus = await new Promise<number | undefined>((resolve, reject) => {
      const pending = request(`${base}/quick-import/upload?filename=large.pdf`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(READING_FILE_LIMIT + 1) } }, response => { response.resume(); resolve(response.statusCode); });
      pending.on('error', reject); pending.end();
    });
    expect(oversizedStatus).toBe(413);
  });
});
