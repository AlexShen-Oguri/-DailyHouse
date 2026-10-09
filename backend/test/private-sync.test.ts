import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrivateSyncService, type SyncSource } from '../src/personal/private-sync';
import { SyncLedger, projected, syncKey, type SyncCredentials, type SyncOperation, type SyncScope, type SyncTransport } from '../src/personal/sync-ledger';
import { validateProjectedRecord, type ProjectedRecord } from '../src/personal/sync-projection';
import { PersonalStore } from '../src/personal/store';
import { canonicalReadingSource } from '../src/personal/reading-import';

const ownerSecret = 'synthetic-private-owner-authorization-only';
const recoveryMs = 30 * 86400000;
let root: string;
const ledgers: SyncLedger[] = [];
const services: PrivateSyncService[] = [];
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dailyhouse-private-sync-')); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-04T12:00:00Z')); });
afterEach(() => { for (const service of services.splice(0)) service.close(); for (const ledger of ledgers.splice(0)) ledger.close(); vi.useRealTimers(); rmSync(root, { recursive: true, force: true }); });
function ledger(file = ':memory:') { const value = new SyncLedger(file, ownerSecret, validateProjectedRecord); ledgers.push(value); return value; }
function todo(title = 'Synthetic task', id = randomUUID()): ProjectedRecord { return { kind: 'todo', id, body: { id, title, done: false, createdAt: new Date().toISOString(), dueDate: null } }; }
function idea(title = 'Synthetic idea', id = randomUUID()): ProjectedRecord { return { kind: 'idea', id, body: { id, title, status: 'growing', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), entries: [{ id: randomUUID(), kind: 'initial', content: 'Synthetic thought', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] } }; }
function source(initial: ProjectedRecord[] = []) {
  const records = new Map(initial.map(record => [syncKey(record), structuredClone(record)]));
  const applied = new Set<string>();
  const apply = vi.fn((values: ProjectedRecord[], transactionId: string) => {
    if (applied.has(transactionId)) return;
    const clean = values.map(validateProjectedRecord);
    for (const record of clean) records.set(syncKey(record), structuredClone(record));
    applied.add(transactionId);
  });
  const state: SyncSource = { exportRecords: () => structuredClone([...records.values()]), validate: validateProjectedRecord, apply, attachments: () => [{ name: 'synthetic-local.pdf', size: 500 }] };
  return { state, records, apply, put: (record: ProjectedRecord) => records.set(syncKey(record), validateProjectedRecord(record)), get: (record: ProjectedRecord) => structuredClone(records.get(syncKey(record))) };
}
function device(cloud: SyncLedger, name: string, initial: ProjectedRecord[] = [], grant: SyncScope[] = ['todos', 'ideas'], administrator = false) {
  const credentials: SyncCredentials = { deviceId: name, token: name === 'device-a' ? 'a'.repeat(43) : 'b'.repeat(43) };
  cloud.pair(ownerSecret, { id: name, name, token: credentials.token, scopes: grant, administrator });
  const control = { offline: false, loseAck: false, failPush: false, destination: 'synthetic://private-reference', cloud };
  const push = vi.fn(async (operation: SyncOperation) => {
    if (control.offline) throw Error('offline');
    if (control.failPush) { control.failPush = false; throw Error('request failed before delivery'); }
    const result = control.cloud.push(credentials, operation);
    if (control.loseAck) { control.loseAck = false; throw Error('acknowledgement lost'); }
    return result;
  });
  const pull = vi.fn(async (scopes: SyncScope[]) => { if (control.offline) throw Error('offline'); return control.cloud.pull(credentials, scopes); });
  const transport: SyncTransport = { get destination() { return control.destination; }, pull, push, devices: async () => control.cloud.devices(credentials), revoke: async id => control.cloud.revoke(credentials, id) };
  const local = source(initial), file = join(root, name + '.json');
  const service = new PrivateSyncService(file, local.state, transport, { id: name, name }); services.push(service);
  return { service, local, credentials, control, transport, push, pull, file };
}
async function approve(service: PrivateSyncService, scopes: SyncScope[] = ['todos']) { const preview = await service.preview(scopes); await service.approve(preview.id, true); return preview; }
function operation(record: ProjectedRecord, baseVersion: number, action: SyncOperation['action'] = 'upsert'): SyncOperation { return { id: randomUUID(), record, baseVersion, action }; }
function reading(notes = 'Synthetic retained notes', id = `reading:${randomUUID()}`): ProjectedRecord {
  const url = 'https://example.com/synthetic-paper?utm_source=fixture';
  return { kind: 'reading', id, body: { id, title: 'Synthetic paper', type: 'article', url, sourceKey: canonicalReadingSource(url), notes, category: 'science', status: 'unread', origin: 'manual', addedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } };
}
function storeDevice(cloud: SyncLedger, name: string, grant: SyncScope[] = ['reading']) {
  const result = device(cloud, name, [], grant);
  const store = new PersonalStore(join(root, `${name}-personal.json`), undefined, join(root, `${name}-synthetic-reports`));
  result.local.state.exportRecords = () => store.syncExport();
  result.local.apply.mockImplementation(records => store.syncApply(records));
  return { ...result, store };
}

describe('private two-device record synchronization', () => {
  it('keeps both duplicate note versions and only adopts the canonical cloud item after explicit review', async () => {
    const cloud = ledger(), a = storeDevice(cloud, 'device-a'), b = storeDevice(cloud, 'device-b');
    const canonical = a.store.addReading({ title: 'Cloud paper', type: 'article', url: 'https://example.com/synthetic-paper?utm_source=windows', notes: 'Windows notes', category: 'science' });
    const duplicate = b.store.addReading({ title: 'Mac paper', type: 'article', url: 'https://example.com/synthetic-paper?utm_source=mac', notes: 'Mac notes', category: 'design' });
    await approve(a.service, ['reading']); await a.service.run();
    const preview = await approve(b.service, ['reading']); expect(preview.conflictCount).toBe(1); await b.service.run();
    const conflict = b.service.status().conflicts[0]; expect(conflict).toMatchObject({ reason: 'same_source', local: { id: duplicate.id }, remote: { id: canonical.id } });
    expect(b.store.reading().items).toHaveLength(1); expect(a.store.reading().items[0].notes).toBe('Windows notes');
    await expect(b.service.resolve(conflict.id, 'remote', false)).rejects.toThrow();
    b.store.editReading(duplicate.id, { notes: 'Mac notes edited during review' });
    await b.service.resolve(conflict.id, 'remote', true); await b.service.run(); await a.service.run();
    expect(b.store.reading().items).toMatchObject([{ id: canonical.id, notes: 'Windows notes', category: 'science' }]);
    expect(b.store.readingTrash().items).toMatchObject([{ item: { id: duplicate.id, notes: 'Mac notes edited during review', category: 'design' } }]);
    expect(a.store.readingTrash().items[0].item.notes).toBe('Mac notes edited during review');
    expect(b.service.status()).toMatchObject({ mode: 'synced', conflicts: [] });
    expect(cloud.pull(a.credentials, ['reading']).filter(record => record.kind === 'reading' && !record.deletedAt && record.body)).toHaveLength(1);
    expect(JSON.parse(readFileSync(b.file, 'utf8')).resolved[0].local.body.notes).toBe('Mac notes edited during review');
    expect(b.store.syncExport().find(record => record.kind === 'readingSuppression')?.body).toBeNull();
  });
  it('does not treat ordinary duplicate removal as permission to restore a suppressed source', async () => {
    const cloud = ledger(), a = storeDevice(cloud, 'device-a'), b = storeDevice(cloud, 'device-b');
    const canonical = a.store.addReading({ title: 'Cloud source', type: 'article', url: 'https://example.com/synthetic-paper', notes: 'Keep cloud notes' });
    const duplicate = b.store.addReading({ title: 'Local source', type: 'article', url: 'https://example.com/synthetic-paper', notes: 'Keep removed local notes' });
    await approve(a.service, ['reading']); await a.service.run(); await approve(b.service, ['reading']); await b.service.run();
    b.store.deleteReading(duplicate.id); await b.service.run();
    expect(b.store.reading().items).toHaveLength(0); expect(b.store.readingTrash().items[0].item.notes).toBe('Keep removed local notes');
    expect(b.store.syncExport().find(record => record.kind === 'readingSuppression')?.body).toMatchObject({ removedAt: new Date().toISOString() });
    expect(cloud.pull(a.credentials, ['reading']).find(record => record.id === canonical.id)?.body?.notes).toBe('Keep cloud notes');
    expect(b.service.status().conflicts.filter(conflict => conflict.reason === 'same_source')).toHaveLength(0);
  });
  it('requires fresh canonical review and preserves edits if duplicate reconciliation is interrupted', async () => {
    const cloud = ledger(), a = storeDevice(cloud, 'device-a'), b = storeDevice(cloud, 'device-b');
    const canonical = a.store.addReading({ title: 'Cloud paper', type: 'article', url: 'https://example.com/synthetic-paper', notes: 'Initial cloud notes' });
    const duplicate = b.store.addReading({ title: 'Local paper', type: 'article', url: 'https://example.com/synthetic-paper', notes: 'Local notes' });
    await approve(a.service, ['reading']); await a.service.run(); await approve(b.service, ['reading']); await b.service.run();
    const conflict = b.service.status().conflicts[0]; a.store.editReading(canonical.id, { notes: 'New cloud notes after preview' }); await a.service.run();
    b.control.destination = 'synthetic://unreviewed-private-destination';
    await expect(b.service.resolve(conflict.id, 'remote', true)).rejects.toMatchObject({ status: 409 });
    expect(b.local.apply).not.toHaveBeenCalled(); b.control.destination = 'synthetic://private-reference';
    await expect(b.service.resolve(conflict.id, 'remote', true)).rejects.toMatchObject({ status: 409 });
    expect(b.store.reading().items[0].id).toBe(duplicate.id); expect(b.store.readingTrash().items).toHaveLength(0);
    b.local.apply.mockImplementationOnce(() => { throw Error('Synthetic disk interruption before write'); });
    await expect(b.service.resolve(conflict.id, 'remote', true)).rejects.toThrow('Synthetic disk interruption');
    expect(b.store.reading().items[0].notes).toBe('Local notes'); expect(JSON.parse(readFileSync(b.file, 'utf8')).outbox).toEqual([]);
    expect(b.service.status().conflicts[0].id).toBe(conflict.id);
    await b.service.resolve(conflict.id, 'remote', true); await b.service.run();
    expect(b.store.reading().items[0].notes).toBe('New cloud notes after preview'); expect(b.store.readingTrash().items[0].item.notes).toBe('Local notes');
  });
  it('does not extend the original local recovery deadline when a duplicate was already removed before confirmation', async () => {
    const cloud = ledger(), a = storeDevice(cloud, 'device-a'), b = storeDevice(cloud, 'device-b');
    a.store.addReading({ title: 'Canonical paper', type: 'article', url: 'https://example.com/synthetic-paper' });
    const duplicate = b.store.addReading({ title: 'Local paper', type: 'article', url: 'https://example.com/synthetic-paper', notes: 'Retain original deadline' });
    await approve(a.service, ['reading']); await a.service.run(); await approve(b.service, ['reading']); await b.service.run();
    const conflict = b.service.status().conflicts[0]; b.store.deleteReading(duplicate.id); const before = b.store.readingTrash().items[0];
    vi.setSystemTime(Date.now() + 3600000); await b.service.resolve(conflict.id, 'remote', true); await b.service.run();
    expect(b.store.readingTrash().items[0]).toMatchObject({ deletedAt: before.deletedAt, expiresAt: before.expiresAt, item: { notes: 'Retain original deadline' } });
  });
  it('minimizes archived duplicate trash and baseline snapshots at the original deadline even when paused', async () => {
    const cloud = ledger(), a = storeDevice(cloud, 'device-a'), b = storeDevice(cloud, 'device-b');
    a.store.addReading({ title: 'Canonical paper', type: 'article', url: 'https://example.com/synthetic-paper', notes: 'Canonical live notes' });
    const duplicate = b.store.addReading({ title: 'Local paper', type: 'article', url: 'https://example.com/synthetic-paper', notes: 'Expired synthetic duplicate note bytes' });
    await approve(a.service, ['reading']); await a.service.run(); await approve(b.service, ['reading']); await b.service.run();
    const conflict = b.service.status().conflicts[0]; const deletedAt = new Date().toISOString(); b.store.deleteReading(duplicate.id);
    vi.setSystemTime(Date.now() + 29 * 86400000); await b.service.resolve(conflict.id, 'remote', true); await b.service.run();
    expect(JSON.parse(readFileSync(b.file, 'utf8')).resolved[0].local.body.notes).toBe('Expired synthetic duplicate note bytes');
    vi.setSystemTime(Date.now() + 2 * 86400000); b.service.pause();
    const stored = JSON.parse(readFileSync(b.file, 'utf8')); expect(stored.resolved).toHaveLength(1);
    expect(stored.resolved[0].local).toEqual({ kind: 'reading', id: duplicate.id, body: null, deletedAt });
    expect(stored.baseline[syncKey({ kind: 'reading', id: duplicate.id })]).toMatchObject({ body: null, deletedAt });
    expect(readFileSync(b.file, 'utf8')).not.toContain('Expired synthetic duplicate note bytes');
  });
  it('replaces an interrupted source transaction identity before replaying its expired trash snapshot', async () => {
    const cloud = ledger(), a = storeDevice(cloud, 'device-a', ['ideas']), b = storeDevice(cloud, 'device-b', ['ideas']);
    const thought = a.store.addIdea({ title: 'An expiring thought', content: 'Original synthetic text' });
    await approve(a.service, ['ideas']); await a.service.run(); await approve(b.service, ['ideas']); await b.service.run();
    const deletedAt = new Date().toISOString(); a.store.deleteIdea(thought.id, { revision: thought.revision }); await a.service.run();
    vi.setSystemTime(Date.now() + 29 * 86400000); b.local.apply.mockImplementationOnce(() => { throw Error('Synthetic interrupted download'); });
    await expect(b.service.run()).rejects.toThrow(); const pending = JSON.parse(readFileSync(b.file, 'utf8')).applyPending;
    vi.setSystemTime(Date.now() + 2 * 86400000); b.service.pause(); const minimized = JSON.parse(readFileSync(b.file, 'utf8')).applyPending;
    expect(minimized.id).not.toBe(pending.id); expect(minimized.records[0]).toMatchObject({ body: null, deletedAt }); expect(minimized.records[0]).not.toHaveProperty('expiresAt');
    b.service.resume(); await b.service.run(); expect(b.store.ideas().items).toHaveLength(0); expect(b.store.ideasTrash().items).toHaveLength(0); expect(b.service.status().conflicts).toHaveLength(0);
    expect(JSON.parse(readFileSync(b.file, 'utf8'))).not.toHaveProperty('applyPending');
  });
  it('releases a suppression conflict after an intentional manual re-add clears the marker', async () => {
    const cloud = ledger(), a = storeDevice(cloud, 'device-a'), b = storeDevice(cloud, 'device-b');
    const original = a.store.addReading({ title: 'Original paper', type: 'article', url: 'https://example.com/synthetic-paper', notes: 'Original notes' });
    await approve(a.service, ['reading']); await a.service.run(); await approve(b.service, ['reading']); await b.service.run();
    a.store.deleteReading(original.id); await a.service.run(); await b.service.run();
    expect(b.store.reading().items).toHaveLength(0); expect(b.store.readingTrash().items[0].item.id).toBe(original.id);
    vi.setSystemTime(Date.now() + 1000);
    const readded = b.store.addReading({ title: 'Intentionally added again', type: 'article', url: 'https://example.com/synthetic-paper', notes: 'Fresh reviewed notes' });
    await b.service.run(); expect(b.service.status().conflicts[0]).toMatchObject({ reason: 'same_source', remote: { kind: 'readingSuppression' } });
    await expect(b.service.resolve(b.service.status().conflicts[0].id, 'remote', true)).rejects.toMatchObject({ status: 409 });
    await b.service.run(); await a.service.run(); await a.service.run();
    expect(b.service.status()).toMatchObject({ mode: 'synced', conflicts: [] }); expect(a.store.reading().items).toMatchObject([{ id: readded.id, notes: 'Fresh reviewed notes' }]);
    expect(a.store.readingTrash().items[0].item.id).toBe(original.id); expect(cloud.pull(a.credentials, ['reading']).find(record => record.kind === 'readingSuppression')?.body).toBeNull();
  });
  it('expires actual store trash on both devices without inventing a later deletion date or conflict', async () => {
    const cloud = ledger(), a = storeDevice(cloud, 'device-a', ['ideas']), b = storeDevice(cloud, 'device-b', ['ideas']);
    const thought = a.store.addIdea({ title: 'A temporary thought', content: 'Synthetic retained text' });
    await approve(a.service, ['ideas']); await a.service.run(); await approve(b.service, ['ideas']); await b.service.run();
    const deletedAt = new Date().toISOString(); a.store.deleteIdea(thought.id, { revision: thought.revision }); await a.service.run(); await b.service.run();
    vi.setSystemTime(Date.now() + recoveryMs); await a.service.run(); await b.service.run();
    expect(a.service.status().conflicts).toEqual([]); expect(b.service.status().conflicts).toEqual([]);
    expect(a.store.syncExport().find(record => record.kind === 'idea' && record.id === thought.id)).toEqual({ kind: 'idea', id: thought.id, body: null, deletedAt });
    expect(cloud.pull(a.credentials, ['ideas']).find(record => record.id === thought.id && record.kind === 'idea')).toMatchObject({ body: null, deletedAt, version: 3 });
    a.store.updateSettings({ animationEnabled: false }); expect(readFileSync(join(root, 'device-a-personal.json'), 'utf8')).not.toContain('Synthetic retained text');
    await a.service.run(); expect(a.service.status().conflicts).toEqual([]);
  });
  it('minimizes an expired timeline entry in sync caches while keeping its live learning plan and other entries', async () => {
    const cloud = ledger(), a = storeDevice(cloud, 'device-a', ['learning']);
    const plan = a.store.addLearning({ title: 'Keep this plan', goal: 'Keep this initial goal' });
    const updated = a.store.addLearningEntry(plan.id, { revision: plan.revision, kind: 'progress', content: 'Expired synthetic timeline entry bytes' });
    const entry = updated.entries.at(-1)!;
    a.store.deleteLearningEntry(plan.id, entry.id, { revision: updated.revision, confirmed: true });
    await approve(a.service, ['learning']); await a.service.run(); expect(readFileSync(a.file, 'utf8')).toContain('Expired synthetic timeline entry bytes');
    vi.setSystemTime(Date.now() + recoveryMs); a.service.pause();
    const saved = JSON.parse(readFileSync(a.file, 'utf8')).baseline[syncKey({ kind: 'learning', id: plan.id })];
    expect(saved.body.title).toBe('Keep this plan'); expect(saved.body.entries).toHaveLength(1); expect(saved.body.entries[0].content).toBe('Keep this initial goal');
    expect(readFileSync(a.file, 'utf8')).not.toContain('Expired synthetic timeline entry bytes');
    a.service.resume(); await a.service.run(); expect(a.service.status().conflicts).toHaveLength(0);
    expect(cloud.pull(a.credentials, ['learning'])[0].body!.entries).toHaveLength(1);
  });
  it('preserves cloud data when a formerly populated device loses or resets its owned source', async () => {
    const cloud = ledger(), first = todo(), a = device(cloud, 'device-a', [first]);
    await approve(a.service); await a.service.run(); a.push.mockClear();
    a.local.records.clear();
    const preview = await a.service.preview(['todos']); expect(preview).toMatchObject({ emptyDevice: true, uploadCount: 0, conflictCount: 1 });
    await a.service.run(); expect(a.push).not.toHaveBeenCalled(); expect(cloud.pull(a.credentials, ['todos'])[0].body).toEqual(first.body);
    expect(a.service.status()).toMatchObject({ mode: 'conflict', conflicts: [{ reason: 'local_missing' }] });
    const conflict = a.service.status().conflicts[0]; await a.service.resolve(conflict.id, 'remote', true);
    expect(a.local.get(first)?.body).toEqual(first.body);
  });
  it('acknowledges self-revocation without another denied management call', async () => {
    const cloud = ledger(), a = device(cloud, 'device-a', [todo()], ['todos'], true);
    await approve(a.service); const read = vi.spyOn(a.transport, 'devices');
    const result = await a.service.revoke('device-a', true);
    expect(result.items).toEqual([]); expect(read).not.toHaveBeenCalled(); expect(a.service.status()).toMatchObject({ mode: 'revoked', paused: true });
    expect(() => cloud.pull(a.credentials, ['todos'])).toThrow();
  });
  it('keeps provider-unconfigured use local-only and cannot approve or upload a migration', async () => {
    const local = source([todo()]), service = new PrivateSyncService(join(root, 'unconfigured.json'), local.state); services.push(service);
    const before = local.state.exportRecords(); expect(service.status()).toMatchObject({ mode: 'local_only', configured: false, destination: null });
    const preview = await service.preview(['todos']); expect(preview).toMatchObject({ uploadCount: 1, destination: null });
    await expect(service.approve(preview.id, true)).rejects.toMatchObject({ status: 409 }); await expect(service.run()).rejects.toMatchObject({ status: 409 }); expect(local.state.exportRecords()).toEqual(before); expect(local.apply).not.toHaveBeenCalled();
    const resumed = new PrivateSyncService(join(root, 'unconfigured.json'), local.state); services.push(resumed); expect(resumed.status().device).toEqual(service.status().device);
  });
  it('requires a reviewed whitelist before upload and previews excluded attachment copies', async () => {
    const cloud = ledger(), first = todo(), a = device(cloud, 'device-a', [first]);
    expect(a.service.status().mode).toBe('preview_required'); await expect(a.service.run()).rejects.toMatchObject({ status: 409 });
    const preview = await a.service.preview(['todos']); expect(preview).toMatchObject({ uploadCount: 1, downloadCount: 0, emptyDevice: false, device: { id: 'device-a' }, attachmentsExcluded: [{ name: 'synthetic-local.pdf', size: 500 }] });
    expect(cloud.pull(a.credentials, ['todos'])).toEqual([]); await expect(a.service.approve(preview.id, false)).rejects.toMatchObject({ status: 409 });
    await a.service.approve(preview.id, true); await a.service.run(); expect(projected(cloud.pull(a.credentials, ['todos'])[0])).toEqual(first);
  });
  it('merges two devices additions, modifications, completion and deletion without replacing unrelated records', async () => {
    const cloud = ledger(), first = todo('From Windows'), second = todo('From Mac');
    const a = device(cloud, 'device-a', [first]), b = device(cloud, 'device-b', [second]);
    await approve(a.service); await a.service.run(); const preview = await approve(b.service); expect(preview).toMatchObject({ uploadCount: 1, downloadCount: 1 });
    await b.service.run(); await a.service.run(); expect(a.local.records.size).toBe(2); expect(b.local.records.size).toBe(2);
    a.local.put({ ...first, body: { ...first.body!, title: 'Edited notes', done: true } }); await a.service.run(); await b.service.run();
    expect(b.local.get(first)?.body).toMatchObject({ title: 'Edited notes', done: true });
    a.local.put({ kind: first.kind, id: first.id, body: null, deletedAt: new Date().toISOString() }); expect(a.service.status().mode).toBe('pending'); await a.service.run(); await b.service.run();
    expect(b.local.get(first)).toMatchObject({ body: null }); expect(b.local.get(second)?.body?.title).toBe('From Mac'); expect(cloud.pull(a.credentials, ['todos'])).toHaveLength(2);
  });
  it('connects an empty new device by downloading rather than overwriting or deleting the owner data', async () => {
    const cloud = ledger(), first = todo('Keep existing cloud data'), a = device(cloud, 'device-a', [first]); await approve(a.service); await a.service.run();
    const b = device(cloud, 'device-b'); const preview = await approve(b.service); expect(preview).toMatchObject({ emptyDevice: true, uploadCount: 0, downloadCount: 1 });
    await b.service.run(); expect(b.push).not.toHaveBeenCalled(); expect(b.local.get(first)).toEqual(first); expect(cloud.pull(a.credentials, ['todos'])[0].version).toBe(1);
  });
  it('shares the original recovery deadline and propagates a user restore from the other device', async () => {
    const cloud = ledger(), first = idea(), a = device(cloud, 'device-a', [first]), b = device(cloud, 'device-b');
    await approve(a.service, ['ideas']); await a.service.run(); await approve(b.service, ['ideas']); await b.service.run();
    const deletedAt = new Date().toISOString(), expiresAt = new Date(Date.now() + recoveryMs).toISOString(); a.local.put({ ...first, deletedAt, expiresAt }); await a.service.run(); await b.service.run();
    expect(b.local.get(first)).toMatchObject({ deletedAt, expiresAt, body: first.body });
    b.local.put(first); await b.service.run(); await a.service.run(); expect(a.local.get(first)).toEqual(first); expect(cloud.pull(a.credentials, ['ideas'])[0]).not.toHaveProperty('deletedAt');
    expect(b.push.mock.calls.at(-1)![0].action).toBe('restore');
  });
  it('retains offline edits and sends them on reconnection', async () => {
    const cloud = ledger(), first = todo(), a = device(cloud, 'device-a', [first]); await approve(a.service); await a.service.run();
    a.local.put({ ...first, body: { ...first.body!, title: 'Offline edit' } }); a.control.offline = true;
    await expect(a.service.run()).rejects.toMatchObject({ status: 503 }); expect(a.service.status()).toMatchObject({ mode: 'offline', issue: 'offline', pending: 1 }); expect(a.local.get(first)?.body?.title).toBe('Offline edit');
    a.control.offline = false; await a.service.run(); expect(a.service.status().mode).toBe('synced'); expect(cloud.pull(a.credentials, ['todos'])[0].body?.title).toBe('Offline edit');
  });
  it('preserves the same operation across acknowledgement loss and restart, then sends a later local edit separately', async () => {
    const cloud = ledger(), first = todo(), a = device(cloud, 'device-a', [first]); await approve(a.service); a.control.loseAck = true;
    await expect(a.service.run()).rejects.toMatchObject({ status: 503 }); const persisted = JSON.parse(readFileSync(a.file, 'utf8')); expect(persisted.outbox).toHaveLength(1); const pendingId = persisted.outbox[0].id;
    expect(cloud.pull(a.credentials, ['todos'])[0].version).toBe(1); a.local.put({ ...first, body: { ...first.body!, title: 'Changed while waiting' } });
    const restarted = new PrivateSyncService(a.file, a.local.state, a.transport, { id: 'device-a', name: 'device-a' }); services.push(restarted);
    await restarted.run(); expect(a.push.mock.calls.map(call => call[0].id)).toEqual([pendingId]); expect(cloud.pull(a.credentials, ['todos'])[0].version).toBe(1);
    await restarted.run(); expect(cloud.pull(a.credentials, ['todos'])).toHaveLength(1); expect(cloud.pull(a.credentials, ['todos'])[0]).toMatchObject({ version: 2, body: { title: 'Changed while waiting' } });
  });
  it('retries an undelivered request with the same durable ID after restart', async () => {
    const cloud = ledger(), first = todo(), a = device(cloud, 'device-a', [first]); await approve(a.service); a.control.failPush = true;
    await expect(a.service.run()).rejects.toThrow(); const pendingId = JSON.parse(readFileSync(a.file, 'utf8')).outbox[0].id; expect(cloud.pull(a.credentials, ['todos'])).toEqual([]);
    const resumed = new PrivateSyncService(a.file, a.local.state, a.transport, { id: 'device-a', name: 'device-a' }); services.push(resumed); await resumed.run();
    expect(a.push.mock.calls.map(call => call[0].id)).toEqual([pendingId, pendingId]); expect(cloud.pull(a.credentials, ['todos'])[0].version).toBe(1); expect(resumed.status().mode).toBe('synced');
  });
  it('minimizes an expired undelivered deletion with a new immutable request ID before sending', async () => {
    const cloud = ledger(), first = idea('Expired deletion private body'), a = device(cloud, 'device-a', [first]); await approve(a.service, ['ideas']); await a.service.run();
    const deletedAt = new Date().toISOString(), expiresAt = new Date(Date.now() + recoveryMs).toISOString(); a.local.put({ ...first, deletedAt, expiresAt }); a.control.failPush = true;
    await expect(a.service.run()).rejects.toThrow(); const oldId = JSON.parse(readFileSync(a.file, 'utf8')).outbox[0].id;
    vi.setSystemTime(Date.now() + recoveryMs + 1); a.local.put({ kind: 'idea', id: first.id, body: null, deletedAt }); await a.service.run();
    const sent = a.push.mock.calls.at(-1)![0]; expect(sent).toMatchObject({ action: 'purge', record: { body: null, deletedAt } }); expect(sent.id).not.toBe(oldId); expect(sent.record).not.toHaveProperty('expiresAt');
    expect(readFileSync(a.file, 'utf8')).not.toContain('Expired deletion private body'); expect(cloud.pull(a.credentials, ['ideas'])[0].body).toBeNull();
  });
  it('does not overwrite a newer other-device edit when retrying an acknowledged-lost operation', async () => {
    const cloud = ledger(), first = todo('Windows first edit'), a = device(cloud, 'device-a', [first]), b = device(cloud, 'device-b');
    await approve(a.service); a.control.loseAck = true; await expect(a.service.run()).rejects.toThrow();
    const pendingId = a.push.mock.calls[0][0].id; await approve(b.service); await b.service.run();
    b.local.put({ ...first, body: { ...first.body!, title: 'Newer Mac edit' } }); await b.service.run(); await a.service.run();
    expect(a.push.mock.calls[1][0].id).toBe(pendingId); expect(a.service.status()).toMatchObject({ mode: 'conflict', conflicts: [{ local: { body: { title: 'Windows first edit' } }, remote: { version: 2, body: { title: 'Newer Mac edit' } } }] });
    expect(a.local.get(first)?.body?.title).toBe('Windows first edit'); expect(cloud.pull(a.credentials, ['todos'])[0]).toMatchObject({ version: 2, body: { title: 'Newer Mac edit' } });
    const conflict = a.service.status().conflicts[0]; await a.service.resolve(conflict.id, 'remote', true); await a.service.run(); expect(a.local.get(first)?.body?.title).toBe('Newer Mac edit');
  });
  it('keeps simultaneous edits as a visible conflict and resolves only a reviewed merge', async () => {
    const cloud = ledger(), first = todo('Baseline'), a = device(cloud, 'device-a', [first]), b = device(cloud, 'device-b');
    await approve(a.service); await a.service.run(); await approve(b.service); await b.service.run();
    a.local.put({ ...first, body: { ...first.body!, title: 'Windows edit' } }); b.local.put({ ...first, body: { ...first.body!, title: 'Mac edit' } }); await a.service.run(); await b.service.run();
    const conflict = b.service.status().conflicts[0]; expect(conflict).toMatchObject({ reason: 'concurrent_edit', local: { body: { title: 'Mac edit' } }, remote: { body: { title: 'Windows edit' }, sourceDeviceId: 'device-a' }, base: { body: { title: 'Baseline' } } });
    expect(b.local.get(first)?.body?.title).toBe('Mac edit'); await expect(b.service.resolve(conflict.id, 'merged', false, first.body)).rejects.toThrow();
    const merged = { ...first.body!, title: 'Windows + Mac reviewed merge' }; await b.service.resolve(conflict.id, 'merged', true, merged); await b.service.run(); await b.service.run(); await a.service.run();
    expect(a.local.get(first)?.body?.title).toBe(merged.title); expect(b.local.get(first)?.body?.title).toBe(merged.title); expect(b.service.status().conflicts).toHaveLength(0);
    expect(JSON.parse(readFileSync(b.file, 'utf8')).resolved).toHaveLength(1); vi.setSystemTime(Date.now() + recoveryMs + 1); b.service.pause(); expect(JSON.parse(readFileSync(b.file, 'utf8')).resolved).toHaveLength(0);
  });
  it('requires a fresh preview when local data, cloud data or confirmation lifetime changes', async () => {
    const cloud = ledger(), first = todo(), a = device(cloud, 'device-a', [first]);
    let preview = await a.service.preview(['todos']); a.local.put({ ...first, body: { ...first.body!, title: 'Changed after preview' } }); await expect(a.service.approve(preview.id, true)).rejects.toMatchObject({ status: 409 });
    preview = await a.service.preview(['todos']); cloud.push(a.credentials, operation(todo('Another cloud record'), 0)); await expect(a.service.approve(preview.id, true)).rejects.toMatchObject({ status: 409 });
    preview = await a.service.preview(['todos']); vi.setSystemTime(Date.now() + 16 * 60000); await expect(a.service.approve(preview.id, true)).rejects.toMatchObject({ status: 409 }); expect(a.push).not.toHaveBeenCalled();
  });
  it('recovers a interrupted apply by replaying the persisted transaction only after current authorization', async () => {
    const cloud = ledger(), first = todo(), a = device(cloud, 'device-a', [first], ['todos'], true), b = device(cloud, 'device-b', [], ['todos']);
    await approve(a.service); await a.service.run(); await approve(b.service);
    b.local.apply.mockImplementationOnce(() => { throw Error('local disk interrupted'); }); await expect(b.service.run()).rejects.toMatchObject({ status: 503 });
    const pending = JSON.parse(readFileSync(b.file, 'utf8')).applyPending; expect(pending.records).toHaveLength(1); expect(b.service.status()).toMatchObject({ issue: 'apply_failed' });
    const resumed = new PrivateSyncService(b.file, b.local.state, b.transport, { id: 'device-b', name: 'device-b' }); services.push(resumed); await resumed.run();
    expect(b.local.apply.mock.calls[0][1]).toBe(b.local.apply.mock.calls[1][1]); expect(b.local.get(first)).toEqual(first); expect(JSON.parse(readFileSync(b.file, 'utf8'))).not.toHaveProperty('applyPending');
    const later = todo('Unauthorized pending content'); a.local.put(later); await a.service.run(); b.local.apply.mockImplementationOnce(() => { throw Error('interrupted'); }); await expect(resumed.run()).rejects.toThrow();
    cloud.revoke(a.credentials, 'device-b'); const calls = b.local.apply.mock.calls.length; await expect(resumed.run()).rejects.toMatchObject({ status: 403 }); expect(b.local.apply.mock.calls).toHaveLength(calls); expect(b.local.get(later)).toBeUndefined(); expect(resumed.status().mode).toBe('revoked');
  });
  it('preserves a newer user edit made after a local download transaction was interrupted', async () => {
    const cloud = ledger(), first = todo('Baseline'), a = device(cloud, 'device-a', [first]), b = device(cloud, 'device-b');
    await approve(a.service); await a.service.run(); await approve(b.service); await b.service.run();
    a.local.put({ ...first, body: { ...first.body!, title: 'Remote update awaiting local apply' } }); await a.service.run();
    b.local.apply.mockImplementationOnce(() => { throw Error('interrupted before write'); }); await expect(b.service.run()).rejects.toThrow();
    b.local.put({ ...first, body: { ...first.body!, title: 'New local edit after interruption' } }); await b.service.run();
    expect(b.local.get(first)?.body?.title).toBe('New local edit after interruption'); expect(b.service.status().conflicts[0]).toMatchObject({ local: { body: { title: 'New local edit after interruption' } }, remote: { body: { title: 'Remote update awaiting local apply' } } });
  });
  it('does not upload a retained outbox after the approved whitelist is narrowed', async () => {
    const cloud = ledger(), first = todo('Original'), thought = idea(), a = device(cloud, 'device-a', [first, thought]); await approve(a.service); await a.service.run();
    a.local.put({ ...first, body: { ...first.body!, title: 'Queued private edit' } }); a.control.loseAck = true; await expect(a.service.run()).rejects.toThrow();
    // Even an accepted retry must not be sent outside the newly approved scope.
    const before = a.push.mock.calls.length; await approve(a.service, ['ideas']); await a.service.run();
    expect(a.push.mock.calls.slice(before).every(call => call[0].record.kind === 'idea')).toBe(true); expect(cloud.pull(a.credentials, ['ideas'])).toHaveLength(1);
  });
  it('treats another destination as a new migration and never reuses its old baseline or outbox', async () => {
    const original = ledger(), first = todo(), a = device(original, 'device-a', [first]); await approve(a.service); await a.service.run();
    const next = ledger(); next.pair(ownerSecret, { id: 'device-a', name: 'device-a', token: a.credentials.token, scopes: ['todos'] }); a.control.cloud = next; a.control.destination = 'synthetic://other-private-reference';
    expect(a.service.status().mode).toBe('preview_required'); await expect(a.service.run()).rejects.toMatchObject({ status: 409 });
    const preview = await approve(a.service); expect(preview).toMatchObject({ uploadCount: 1, downloadCount: 0, destination: a.control.destination }); await a.service.run();
    expect(next.pull(a.credentials, ['todos']).map(projected)).toEqual([first]); expect(original.pull(a.credentials, ['todos'])[0].version).toBe(1);
  });
  it('does not replay an old destination pending download after confirming another cloud', async () => {
    const original = ledger(), first = todo('Reviewed local copy'), a = device(original, 'device-a', [first]), b = device(original, 'device-b');
    await approve(a.service); await a.service.run(); await approve(b.service); await b.service.run();
    a.local.put({ ...first, body: { ...first.body!, title: 'Unapplied former cloud update' } }); await a.service.run();
    b.local.apply.mockImplementationOnce(() => { throw Error('interrupted'); }); await expect(b.service.run()).rejects.toThrow();
    const next = ledger(); next.pair(ownerSecret, { id: 'device-b', name: 'device-b', token: b.credentials.token, scopes: ['todos'] }); b.control.cloud = next; b.control.destination = 'synthetic://new-reviewed-destination';
    const preview = await approve(b.service); expect(preview.records[0].local?.body?.title).toBe('Reviewed local copy'); await b.service.run();
    expect(b.local.get(first)?.body?.title).toBe('Reviewed local copy'); expect(next.pull(b.credentials, ['todos'])[0].body?.title).toBe('Reviewed local copy');
  });
});

describe('single-owner private ledger authorization and recovery', () => {
  it('blocks stale different identities for a removed source while allowing reviewed same-ID recovery', () => {
    const cloud = ledger(), a = device(cloud, 'device-a', [], ['reading']), original = reading('Original notes'), stale = reading('Stale other-device notes');
    const sourceId = String(original.body!.sourceKey), deletedAt = new Date().toISOString();
    cloud.push(a.credentials, operation(original, 0));
    cloud.push(a.credentials, operation({ ...original, deletedAt, expiresAt: new Date(Date.now() + recoveryMs).toISOString() }, 1, 'delete'));
    const marker = { kind: 'readingSuppression', id: sourceId, body: { removedAt: deletedAt } };
    cloud.push(a.credentials, operation(marker, 0));
    expect(cloud.push(a.credentials, operation(stale, 0))).toMatchObject({ status: 'conflict', record: { kind: 'readingSuppression', id: sourceId } });
    expect(cloud.push(a.credentials, operation(original, 2))).toMatchObject({ status: 'conflict' });
    expect(cloud.push(a.credentials, operation(original, 2, 'restore'))).toMatchObject({ status: 'accepted', record: { id: original.id, version: 3, body: { notes: 'Original notes' } } });
    expect(cloud.push(a.credentials, operation({ kind: 'readingSuppression', id: sourceId, body: null }, 1, 'purge')).status).toBe('accepted');
    expect(cloud.push(a.credentials, operation(stale, 0))).toMatchObject({ status: 'conflict', record: { kind: 'reading', id: original.id } });
    expect(cloud.pull(a.credentials, ['reading']).filter(record => record.kind === 'reading' && record.body)).toHaveLength(1);
  });
  it.each([0, -1000])('requires a newer suppression clear with a fixed or regressing clock (%i ms)', (clockChange) => {
    const file = join(root, 'source-order.sqlite'), cloud = ledger(file), a = device(cloud, 'device-a', [], ['reading']), original = reading(), replacement = reading('Intentional re-add');
    const clear: ProjectedRecord = { kind: 'readingSuppression', id: String(original.body!.sourceKey), body: null };
    cloud.push(a.credentials, operation(clear, 0, 'purge')); cloud.push(a.credentials, operation(original, 0));
    vi.setSystemTime(Date.now() + clockChange); const deletedAt = new Date().toISOString();
    cloud.push(a.credentials, operation({ kind: 'reading', id: original.id, body: null, deletedAt }, 1, 'purge'));
    expect(cloud.push(a.credentials, operation(replacement, 0))).toMatchObject({ status: 'conflict', record: { id: original.id, body: null } });
    const peer = ledger(file);
    vi.setSystemTime(Date.now() + clockChange); peer.push(a.credentials, operation(clear, 1, 'purge'));
    expect(cloud.push(a.credentials, operation(replacement, 0))).toMatchObject({ status: 'accepted', record: { id: replacement.id, body: { notes: 'Intentional re-add' } } });
    expect(cloud.push(a.credentials, operation(original, 2, 'restore')).status).toBe('conflict');
    expect(cloud.pull(a.credentials, ['reading']).filter(record => record.kind === 'reading' && !record.deletedAt && record.body)).toHaveLength(1);
  });
  it('rejects unknown, wrong-token, out-of-scope and revoked devices for every remote operation', async () => {
    const cloud = ledger(), a = device(cloud, 'device-a', [], ['todos'], true), b = device(cloud, 'device-b', [], ['todos']);
    expect(() => cloud.pair('not-owner-secret', { id: 'bad', name: 'bad', token: 'z'.repeat(43), scopes: ['todos'] })).toThrow();
    for (const credentials of [{ deviceId: 'unknown', token: 'c'.repeat(43) }, { ...b.credentials, token: 'c'.repeat(43) }]) {
      expect(() => cloud.pull(credentials, ['todos'])).toThrow(); expect(() => cloud.push(credentials, operation(todo(), 0))).toThrow(); expect(() => cloud.devices(credentials)).toThrow(); expect(() => cloud.revoke(credentials, 'device-a')).toThrow();
    }
    expect(() => cloud.pull(b.credentials, ['ideas'])).toThrow(); expect(() => cloud.push(b.credentials, operation(idea(), 0))).toThrow(); expect(() => cloud.revoke(b.credentials, 'device-a')).toThrow();
    cloud.revoke(a.credentials, 'device-b'); expect(() => cloud.pull(b.credentials, ['todos'])).toThrow(); expect(() => cloud.push(b.credentials, operation(todo(), 0))).toThrow(); expect(() => cloud.devices(b.credentials)).toThrow(); expect(() => cloud.revoke(b.credentials, 'device-a')).toThrow();
    expect(() => cloud.pair(ownerSecret, { id: 'device-b', name: 'Recycled', token: 'c'.repeat(43), scopes: ['todos'] })).toThrow(); expect(JSON.stringify(cloud.devices(a.credentials))).not.toMatch(/token|token_hash|aaaa/);
  });
  it('accepts only identical retry payloads and never applies the same operation twice', () => {
    const cloud = ledger(), a = device(cloud, 'device-a'), first = todo(), request = operation(first, 0); const one = cloud.push(a.credentials, request);
    expect(cloud.push(a.credentials, request)).toEqual(one); expect(cloud.pull(a.credentials, ['todos'])[0].version).toBe(1);
    expect(() => cloud.push(a.credentials, { ...request, record: { ...first, body: { ...first.body!, title: 'Changed retry' } } })).toThrow('retry');
    const stale = cloud.push(a.credentials, operation({ ...first, body: { ...first.body!, title: 'Stale edit' } }, 0)); expect(stale).toMatchObject({ status: 'conflict', record: { version: 1 } }); expect(cloud.pull(a.credentials, ['todos'])[0].body?.title).toBe(first.body!.title);
  });
  it('propagates a tombstone, blocks silent resurrection and permits an explicit restore only within recovery', () => {
    const cloud = ledger(), a = device(cloud, 'device-a'), original = idea(); cloud.push(a.credentials, operation(original, 0));
    const deletedAt = new Date().toISOString(), expiresAt = new Date(Date.now() + recoveryMs).toISOString(); const deleted = { ...original, deletedAt, expiresAt };
    expect(cloud.push(a.credentials, operation(deleted, 1, 'delete'))).toMatchObject({ status: 'accepted', record: { version: 2, deletedAt, expiresAt } });
    expect(cloud.push(a.credentials, operation(original, 2))).toMatchObject({ status: 'conflict' }); expect(cloud.pull(a.credentials, ['ideas'])[0].deletedAt).toBe(deletedAt);
    expect(cloud.push(a.credentials, operation(original, 2, 'restore'))).toMatchObject({ status: 'accepted', record: { version: 3 } });
    cloud.push(a.credentials, operation(deleted, 3, 'delete')); vi.setSystemTime(Date.now() + recoveryMs + 1);
    const expired = cloud.push(a.credentials, operation(original, 4, 'restore')); expect(expired.status).toBe('conflict'); expect(cloud.pull(a.credentials, ['ideas'])[0].deletedAt).toBe(deletedAt);
  });
  it('keeps a permanent purge suppressed even for a current-version explicit restore request', () => {
    const cloud = ledger(), a = device(cloud, 'device-a'), first = todo(); cloud.push(a.credentials, operation(first, 0));
    expect(cloud.push(a.credentials, operation({ kind: first.kind, id: first.id, body: null, deletedAt: new Date().toISOString() }, 1, 'purge'))).toMatchObject({ status: 'accepted', record: { version: 2, body: null } });
    expect(cloud.push(a.credentials, operation(first, 2))).toMatchObject({ status: 'conflict' }); expect(cloud.push(a.credentials, operation(first, 2, 'restore'))).toMatchObject({ status: 'conflict' }); expect(cloud.pull(a.credentials, ['todos'])[0].body).toBeNull();
  });
  it('returns a valid minimized deletion after the recovery deadline without retaining expired body bytes', () => {
    const cloud = ledger(), a = device(cloud, 'device-a'), first = idea('Expired private synthetic text'); cloud.push(a.credentials, operation(first, 0));
    const deletedAt = new Date().toISOString(), expiresAt = new Date(Date.now() + recoveryMs).toISOString(); cloud.push(a.credentials, operation({ ...first, deletedAt, expiresAt }, 1, 'delete'));
    vi.setSystemTime(Date.now() + recoveryMs + 1); const records = cloud.pull(a.credentials, ['ideas']); expect(records[0]).toMatchObject({ body: null, deletedAt }); expect(records[0]).not.toHaveProperty('expiresAt');
    expect(validateProjectedRecord(projected(records[0]))).toMatchObject({ body: null }); expect(JSON.stringify(records)).not.toContain('Expired private synthetic text');
  });
  it('persists expiry once across independently opened ledger connections without decreasing or duplicating versions', () => {
    const file = join(root, 'synthetic-reference.sqlite'), cloud = ledger(file), a = device(cloud, 'device-a'), first = idea(); cloud.push(a.credentials, operation(first, 0));
    const deletedAt = new Date().toISOString(), expiresAt = new Date(Date.now() + recoveryMs).toISOString(); cloud.push(a.credentials, operation({ ...first, deletedAt, expiresAt }, 1, 'delete'));
    const second = ledger(file); vi.setSystemTime(Date.now() + recoveryMs + 1); expect(cloud.pull(a.credentials, ['ideas'])[0]).toMatchObject({ version: 3, body: null }); expect(second.pull(a.credentials, ['ideas'])[0]).toMatchObject({ version: 3, body: null }); expect(cloud.pull(a.credentials, ['ideas'])[0].version).toBe(3);
    expect(second.push(a.credentials, operation(first, 3, 'restore')).status).toBe('conflict'); expect(cloud.pull(a.credentials, ['ideas'])[0].version).toBe(3);
  });
});
