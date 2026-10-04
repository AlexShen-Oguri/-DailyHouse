import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { PersonalStore } from '../src/personal/store';
import { InspirationStore } from '../src/personal/inspiration-store';
import { JournalStore } from '../src/personal/journal';
import { SharedProjectStore } from '../src/personal/shared-projects';
import { createSyncSource } from '../src/personal/sync-source';
import { syncKey } from '../src/personal/sync-ledger';
import type { ProjectedRecord } from '../src/personal/sync-projection';

let root: string;
const now = '2026-10-04T12:00:00Z';
const filenames = ['personal-workbench.json', 'inspiration-garden.json', 'work-journal.json', 'shared-projects.json'];
function bundle(name: string) {
  const dataDirectory = join(root, name); mkdirSync(dataDirectory, { recursive: true });
  const store = new PersonalStore(join(dataDirectory, filenames[0]), undefined, join(dataDirectory, 'reports'));
  const inspiration = new InspirationStore(join(dataDirectory, filenames[1]), store);
  const journal = new JournalStore(join(dataDirectory, filenames[2]));
  const projects = new SharedProjectStore(join(dataDirectory, filenames[3]), join(dataDirectory, 'device-project-links.json'), { id: 'fixture-device', name: 'Fixture' }, { cachedProject: () => undefined }, { requireAuthenticated: async () => {}, status: async () => ({ checkedAt: now, deviceScope: 'current_device' as const, tools: [] }) }, record => ({ deviceId: 'fixture-device', deviceName: 'Fixture', updatedAt: String(record.body?.updatedAt ?? now) }));
  return { dataDirectory, store, inspiration, journal, projects };
}
function seed(value: ReturnType<typeof bundle>, label = 'Remote') {
  const todo = value.store.addTodo({ title: `${label} task` });
  value.store.addReading({ title: `${label} course`, url: `https://example.com/${label.toLowerCase()}`, type: 'course', category: 'science', notes: 'Synthetic reading notes' });
  value.inspiration.add({ title: `${label} idea`, body: 'Synthetic idea content', tags: ['fixture'] });
  value.journal.create({ date: label === 'Remote' ? '2026-10-04' : '2026-10-03', title: `${label} journal`, codex: 'Synthetic project progress' });
  value.projects.create({ title: `${label} project`, goal: 'A synthetic goal', nextStep: 'Check one thing' });
  return todo;
}
const checkpointPath = (directory: string, transaction: string) => join(directory, 'sync-backups', createHash('sha256').update(transaction).digest('hex'), 'checkpoint.json');
const bytes = (directory: string) => Object.fromEntries(filenames.filter(name => existsSync(join(directory, name))).map(name => [name, readFileSync(join(directory, name), 'utf8')]));
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dailyhouse-sync-source-')); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(now)); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes('dailyhouse-sync-source-')) throw new Error('Unexpected fixture root'); rmSync(root, { recursive: true, force: true }); });

describe('recoverable application-owned local sync source', () => {
  it('backs up before upload even with no downloads and keeps local state byte-for-byte unchanged', () => {
    const local = bundle('local'); seed(local, 'Local'); writeFileSync(join(local.dataDirectory, 'private-sync.json'), JSON.stringify({ synthetic: 'pre-migration sync state' })); writeFileSync(join(local.dataDirectory, '.env.local'), 'SYNTHETIC_TOKEN=excluded'); const before = bytes(local.dataDirectory), syncBefore = readFileSync(join(local.dataDirectory, 'private-sync.json'), 'utf8'), source = createSyncSource(local), id = randomUUID();
    const manifest = source.backupMigration!(id); expect(manifest.files).toHaveLength(5); expect(manifest.files.every(file => file.existed)).toBe(true); expect(bytes(local.dataDirectory)).toEqual(before); expect(readFileSync(join(local.dataDirectory, 'private-sync.json'), 'utf8')).toBe(syncBefore);
    const location = join(local.dataDirectory, 'migration-backups', createHash('sha256').update(id).digest('hex')); expect(readdirSync(location).sort()).toEqual([...filenames, 'private-sync.json', 'manifest.json'].sort()); for (const name of filenames) expect(readFileSync(join(location, name), 'utf8')).toBe(before[name]); expect(readFileSync(join(location, 'private-sync.json'), 'utf8')).toBe(syncBefore); expect(source.backupMigration!(id)).toEqual(manifest); expect(JSON.stringify(manifest)).not.toContain('SYNTHETIC_TOKEN');
  });
  it('records missing stores as missing instead of manufacturing or uploading empty databases', () => {
    const local = bundle('empty'), source = createSyncSource(local), id = randomUUID(), manifest = source.backupMigration!(id); expect(manifest.files.every(file => !file.existed && file.size === 0 && file.sha256 === null)).toBe(true); expect(bytes(local.dataDirectory)).toEqual({}); const directory = join(local.dataDirectory, 'migration-backups', createHash('sha256').update(id).digest('hex')); expect(readdirSync(directory)).toEqual(['manifest.json']);
    writeFileSync(join(directory, 'manifest.json'), '{corrupt'); expect(() => source.backupMigration!(id)).toThrow('检查点'); expect(bytes(local.dataDirectory)).toEqual({});
  });
  it('exports all whitelisted stores without rewriting files or reading device credentials', () => {
    const local = bundle('local'); seed(local, 'Local'); const before = bytes(local.dataDirectory), source = createSyncSource(local);
    writeFileSync(join(local.dataDirectory, '.env.local'), 'SYNTHETIC_SECRET=local-only'); writeFileSync(join(local.dataDirectory, 'device-project-links.json'), '{"synthetic":"local-only-link"}');
    const records = source.exportRecords(); expect(records.some(record => record.kind === 'project')).toBe(true); expect(records.some(record => record.kind === 'journal')).toBe(true); expect(records.some(record => record.kind === 'ideaMeta')).toBe(true); expect(JSON.stringify(records)).not.toMatch(/SYNTHETIC_SECRET|vaultPath|calendarUrl|local-only-link|dataDirectory/); expect(bytes(local.dataDirectory)).toEqual(before); expect(existsSync(join(local.dataDirectory, 'sync-backups'))).toBe(false);
    expect(() => source.validate({ kind: 'externalChat', id: 'chat', body: {} })).toThrow(); expect(() => source.validate({ ...records.find(record => record.kind === 'project')!, body: { ...records.find(record => record.kind === 'project')!.body, path: '/private/device' } })).toThrow();
  });

  it('validates every record before creating a checkpoint or writing any store', () => {
    const remote = bundle('remote'); seed(remote); const local = bundle('local'); seed(local, 'Local'); const source = createSyncSource(local), before = bytes(local.dataDirectory), records = createSyncSource(remote).exportRecords();
    records.push({ kind: 'journal', id: '2026-10-05', body: { title: 'Invalid late record', localPath: 'never accepted' } });
    expect(() => source.apply(records, randomUUID())).toThrow(); expect(bytes(local.dataDirectory)).toEqual(before); expect(existsSync(join(local.dataDirectory, 'sync-backups'))).toBe(false);
  });

  it('rejects duplicate canonical sources before any write and keeps both existing records', () => {
    const local = bundle('local'), remote = bundle('remote'); local.store.addReading({ title: 'Local notes', type: 'course', url: 'https://example.com/same?utm_source=fixture', notes: 'Do not overwrite' }); remote.store.addReading({ title: 'Remote notes', type: 'course', url: 'https://example.com/same', notes: 'Keep these too' }); remote.store.addTodo({ title: 'Valid preceding task' }); const before = bytes(local.dataDirectory);
    expect(() => createSyncSource(local).apply(createSyncSource(remote).exportRecords(), randomUUID())).toThrow('同一资料来源'); expect(bytes(local.dataDirectory)).toEqual(before); expect(local.store.todos()).toHaveLength(0); expect(remote.store.reading().items[0].notes).toBe('Keep these too'); expect(existsSync(join(local.dataDirectory, 'sync-backups'))).toBe(false);
  });

  it('partially merges all stores, backs up exactly owned JSON, and never copies originals or tool files', () => {
    const remote = bundle('remote'); seed(remote); const local = bundle('local'); const own = seed(local, 'Local'); const before = bytes(local.dataDirectory);
    writeFileSync(join(local.dataDirectory, '.env.local'), 'SYNTHETIC_TOKEN=fixture'); writeFileSync(join(local.dataDirectory, 'project-resume.json'), 'native tool cache stays local'); const external = join(root, 'original.txt'); writeFileSync(external, 'Synthetic original stays put'); const transaction = randomUUID(), source = createSyncSource(local);
    source.apply(createSyncSource(remote).exportRecords(), transaction); expect(local.store.todos().some(todo => todo.id === own.id)).toBe(true);
    for (const incoming of createSyncSource(remote).exportRecords()) expect(source.exportRecords().find(record => syncKey(record) === syncKey(incoming))).toEqual(incoming);
    const directory = dirname(checkpointPath(local.dataDirectory, transaction)); expect(readdirSync(directory).sort()).toEqual([...filenames, 'checkpoint.json'].sort()); for (const name of filenames) expect(readFileSync(join(directory, name), 'utf8')).toBe(before[name]);
    expect(readFileSync(external, 'utf8')).toBe('Synthetic original stays put'); expect(readFileSync(join(local.dataDirectory, 'project-resume.json'), 'utf8')).toBe('native tool cache stays local'); if (process.platform !== 'win32') for (const file of readdirSync(directory)) expect(statSync(join(directory, file)).mode & 0o777).toBe(0o600);
  });

  it('resumes after a later store fails and skips a completed group after service restart', () => {
    const remote = bundle('remote'); seed(remote); let local = bundle('local'); seed(local, 'Local'); const incoming = createSyncSource(remote).exportRecords(), transaction = randomUUID(); const failed = vi.spyOn(local.inspiration, 'syncApply').mockImplementationOnce(() => { throw new Error('Synthetic interrupted write'); });
    expect(() => createSyncSource(local).apply(incoming, transaction)).toThrow('Synthetic interrupted write'); expect(JSON.parse(readFileSync(checkpointPath(local.dataDirectory, transaction), 'utf8')).groups).toEqual(['personal']); const afterPersonal = readFileSync(join(local.dataDirectory, filenames[0]), 'utf8'); expect(local.journal.list().items).toHaveLength(1); failed.mockRestore();
    local = bundle('local'); const personalApply = vi.spyOn(local.store, 'syncApply'); createSyncSource(local).apply(incoming, transaction); expect(personalApply).not.toHaveBeenCalled(); expect(readFileSync(join(local.dataDirectory, filenames[0]), 'utf8')).toBe(afterPersonal); expect(local.journal.list().items).toHaveLength(2); expect(JSON.parse(readFileSync(checkpointPath(local.dataDirectory, transaction), 'utf8')).completedAt).toBe(new Date(now).toISOString());
  });

  it('replays a write completed before checkpointing idempotently without increasing revisions', () => {
    const remote = bundle('remote'); seed(remote); const local = bundle('local'); seed(local, 'Local'); const incoming = createSyncSource(remote).exportRecords(), transaction = randomUUID(); vi.spyOn(local.inspiration, 'syncApply').mockImplementationOnce(() => { throw new Error('Synthetic interruption'); });
    expect(() => createSyncSource(local).apply(incoming, transaction)).toThrow(); const file = checkpointPath(local.dataDirectory, transaction), checkpoint = JSON.parse(readFileSync(file, 'utf8')); checkpoint.groups = []; writeFileSync(file, JSON.stringify(checkpoint)); const before = readFileSync(join(local.dataDirectory, filenames[0]), 'utf8');
    createSyncSource(bundle('local')).apply(incoming, transaction); expect(readFileSync(join(local.dataDirectory, filenames[0]), 'utf8')).toBe(before);
  });

  it('fails closed when a touched local record changes after an interrupted uncheckpointed write', () => {
    const remote = bundle('remote'); const todo = seed(remote); const local = bundle('local'); seed(local, 'Local'); const incoming = createSyncSource(remote).exportRecords(), transaction = randomUUID(); vi.spyOn(local.inspiration, 'syncApply').mockImplementationOnce(() => { throw new Error('Synthetic interruption'); });
    expect(() => createSyncSource(local).apply(incoming, transaction)).toThrow(); const file = checkpointPath(local.dataDirectory, transaction), checkpoint = JSON.parse(readFileSync(file, 'utf8')); checkpoint.groups = []; writeFileSync(file, JSON.stringify(checkpoint)); local.store.editTodo(todo.id, { title: 'New local edit after interruption' }); const before = bytes(local.dataDirectory);
    expect(() => createSyncSource(bundle('local')).apply(incoming, transaction)).toThrow('又有编辑'); expect(bytes(local.dataDirectory)).toEqual(before); expect(local.store.todos().find(item => item.id === todo.id)?.title).toBe('New local edit after interruption');
  });

  it('does not replay a completed transaction over newer edits and rejects changed content under its id', () => {
    const remote = bundle('remote'); const todo = seed(remote); const local = bundle('local'), incoming = createSyncSource(remote).exportRecords(), transaction = randomUUID(), source = createSyncSource(local); source.apply(incoming, transaction); local.store.editTodo(todo.id, { title: 'Later authored edit' }); const before = bytes(local.dataDirectory); source.apply(incoming, transaction); expect(bytes(local.dataDirectory)).toEqual(before);
    const changed = structuredClone(incoming); changed.find(record => record.id === todo.id)!.body!.title = 'Different request'; expect(() => source.apply(changed, transaction)).toThrow('检查点'); expect(bytes(local.dataDirectory)).toEqual(before);
  });

  it('fails closed on a corrupt checkpoint or backup without rolling back stores', () => {
    const remote = bundle('remote'); seed(remote); const local = bundle('local'); seed(local, 'Local'); const incoming = createSyncSource(remote).exportRecords(), transaction = randomUUID(); vi.spyOn(local.inspiration, 'syncApply').mockImplementationOnce(() => { throw new Error('Synthetic interruption'); }); expect(() => createSyncSource(local).apply(incoming, transaction)).toThrow(); const before = bytes(local.dataDirectory), file = checkpointPath(local.dataDirectory, transaction);
    writeFileSync(join(dirname(file), filenames[0]), 'corrupt backup'); expect(() => createSyncSource(local).apply(incoming, transaction)).toThrow('备份无效'); expect(bytes(local.dataDirectory)).toEqual(before); writeFileSync(file, '{broken'); expect(() => createSyncSource(local).apply(incoming, transaction)).toThrow('检查点'); expect(bytes(local.dataDirectory)).toEqual(before);
  });

  it('lists excluded attachment metadata without transferring bytes and deletes only owned records', async () => {
    const local = bundle('local'); const original = join(root, 'original.txt'); writeFileSync(original, 'Synthetic attachment original'); const upload = await local.store.readingAttachments.stage('original.txt', Readable.from(readFileSync(original))); const item = local.store.importQuickReading({ items: [{ uploadId: upload.uploadId }] }).items[0], source = createSyncSource(local), copy = join(local.store.readingAttachments.root, item.attachment!.id);
    expect(source.attachments()).toEqual([{ name: 'original.txt', size: 29 }]); const originalBytes = readFileSync(copy); source.apply([{ kind: 'reading', id: item.id, body: null }], randomUUID()); expect(readFileSync(copy)).toEqual(originalBytes); expect(readFileSync(original, 'utf8')).toBe('Synthetic attachment original'); const backup = join(local.dataDirectory, 'sync-backups'); expect(readdirSync(join(backup, readdirSync(backup)[0]))).not.toContain(item.attachment!.id);
  });

  it('rejects transaction path traversal and linked backup directories', () => {
    const remote = bundle('remote'); seed(remote); const local = bundle('local'); seed(local, 'Local'); const source = createSyncSource(local), incoming = createSyncSource(remote).exportRecords(), before = bytes(local.dataDirectory);
    expect(() => source.apply(incoming, '../outside')).toThrow('事务标识'); const external = join(root, 'external'); mkdirSync(external); symlinkSync(external, join(local.dataDirectory, 'sync-backups'), process.platform === 'win32' ? 'junction' : 'dir'); expect(() => source.apply(incoming, randomUUID())).toThrow(); expect(readdirSync(external)).toEqual([]); expect(bytes(local.dataDirectory)).toEqual(before);
  });
});
