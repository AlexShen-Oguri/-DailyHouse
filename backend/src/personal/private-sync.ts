import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PersonalError } from './types';
import { canonicalReadingSource } from './reading-import';
import type { ProjectedRecord } from './sync-projection';
import { projected, sameRecord, scopeOf, stableJson, syncKey, SYNC_SCOPES, type SharedRecord, type SyncDevice, type SyncOperation, type SyncScope, type SyncTransport } from './sync-ledger';

export interface SyncSource {
  exportRecords(): ProjectedRecord[];
  apply(records: ProjectedRecord[], transactionId: string): void;
  validate(record: ProjectedRecord): ProjectedRecord;
  attachments(): { name: string; size: number }[];
  backupMigration?(transactionId: string): { id: string; createdAt: string; files: { name: string; existed: boolean; size: number; sha256: string | null }[] };
}
export interface SyncConflict { id: string; key: string; kind: string; reason: 'concurrent_edit' | 'same_source' | 'local_missing'; local: ProjectedRecord | null; remote: SharedRecord | null; base: SharedRecord | null; createdAt: string }
interface PreviewRow { kind: string; id: string; title: string; action: 'upload' | 'download' | 'conflict' | 'unchanged'; local?: ProjectedRecord; remote?: SharedRecord; missingLocal?: boolean }
interface Preview {
  id: string; device: { id: string; name: string }; createdAt: string; scopes: SyncScope[];
  recordCount: number; uploadCount: number; downloadCount: number; conflictCount: number; emptyDevice: boolean;
  records: PreviewRow[]; attachmentsExcluded: { name: string; size: number }[]; excluded: string[];
  destination: string | null; fingerprint: string; remoteFingerprint: string;
}
interface SyncState {
  version: 1; device: { id: string; name: string }; scopes: SyncScope[]; approvedDestination: string | null; paused: boolean;
  baseline: Record<string, SharedRecord>; outbox: SyncOperation[]; conflicts: SyncConflict[];
  resolved: (SyncConflict & { resolvedAt: string })[];
  applyPending?: { id: string; records: SharedRecord[]; expected: Record<string, ProjectedRecord | null> };
  lastAttemptAt: string | null; lastSyncedAt: string | null; issue?: 'offline' | 'revoked' | 'apply_failed';
  migrationBackup?: { id: string; createdAt: string; files: { name: string; existed: boolean; size: number; sha256: string | null }[] };
}
const timestamp = () => new Date().toISOString();
const hash = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex');
const title = (record: ProjectedRecord | undefined) => String(record?.body?.title ?? record?.body?.date ?? record?.id ?? '').slice(0, 200);
export function readSyncDevice(file: string): { id: string; name: string } {
  if (!existsSync(file)) return { id: randomUUID(), name: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'Mac' : 'Local device' };
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (value.version !== 1 || typeof value.device?.id !== 'string' || value.device.id.length > 100 || typeof value.device.name !== 'string' || !value.device.name || value.device.name.length > 100) throw new Error();
    return value.device;
  } catch { throw new Error('Private sync device identity is invalid. Restore its private backup.'); }
}
function scopes(value: unknown): SyncScope[] {
  if (!Array.isArray(value) || !value.length || value.length > SYNC_SCOPES.length || value.some(item => !SYNC_SCOPES.includes(item)) || new Set(value).size !== value.length) throw new PersonalError('请选择有效的同步范围。');
  return [...value].sort() as SyncScope[];
}
function sourceIdentity(record: ProjectedRecord): string {
  if (record.kind === 'readingSuppression' && record.body) return record.id;
  if (record.kind !== 'reading' || !record.body || record.deletedAt) return '';
  const url = typeof record.body.url === 'string' ? record.body.url : '';
  return url ? canonicalReadingSource(url) : typeof record.body.sourceKey === 'string' ? record.body.sourceKey : '';
}
function minimizeExpired<T extends ProjectedRecord>(record: T): T {
  if (record.body && record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) {
    const { expiresAt: _expiresAt, ...retained } = record;
    return { ...retained, body: null } as T;
  }
  if (record.kind === 'learning' && Array.isArray(record.body?.entries)) {
    const entries = record.body.entries.filter((entry: any) => !entry.removedAt || !entry.expiresAt || Date.parse(entry.expiresAt) > Date.now());
    if (entries.length !== record.body.entries.length) return { ...record, body: { ...record.body, entries } };
  }
  return record;
}

/** Explicit enrollment, record deltas and a durable outbox. Never uploads local JSON files. */
export class PrivateSyncService {
  private data: SyncState;
  private previewValue?: Preview;
  private exclusive: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  constructor(private file: string, private source: SyncSource, private transport?: SyncTransport, device?: { id: string; name: string }) {
    this.data = { version: 1, device: device ?? { id: randomUUID(), name: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'Mac' : 'Local device' }, scopes: [], approvedDestination: null, paused: false, baseline: {}, outbox: [], conflicts: [], resolved: [], lastAttemptAt: null, lastSyncedAt: null };
    if (existsSync(file)) {
      try {
        const saved = JSON.parse(readFileSync(file, 'utf8')) as SyncState;
        if (saved.version !== 1 || !saved.device?.id || typeof saved.device.name !== 'string' || !Array.isArray(saved.scopes) || saved.scopes.some(scope => !SYNC_SCOPES.includes(scope)) || !Array.isArray(saved.outbox) || !Array.isArray(saved.conflicts) || !Array.isArray(saved.resolved) || !saved.baseline || typeof saved.baseline !== 'object') throw new Error();
        if (device && saved.device.id !== device.id) throw new Error();
        Object.values(saved.baseline).forEach(record => this.validateShared(record));
        saved.outbox.forEach(operation => this.source.validate(operation.record));
        this.data = saved;
      } catch { throw new Error('Private sync state is invalid. Restore its private backup before enabling synchronization.'); }
    } else this.save();
  }
  private save(): void {
    this.data.baseline = Object.fromEntries(Object.entries(this.data.baseline).map(([key, record]) => [key, minimizeExpired(record)]));
    const minimizeConflict = <T extends SyncConflict>(item: T): T => ({ ...item,
      local: item.local ? minimizeExpired(item.local) : null,
      remote: item.remote ? minimizeExpired(item.remote) : null,
      base: item.base ? minimizeExpired(item.base) : null,
    });
    this.data.conflicts = this.data.conflicts.map(minimizeConflict);
    this.data.resolved = this.data.resolved.filter(item => Date.now() - Date.parse(item.resolvedAt) < 30 * 86400000);
    this.data.resolved = this.data.resolved.map(minimizeConflict);
    if (this.data.applyPending) {
      const pending = this.data.applyPending;
      const records = pending.records.map(minimizeExpired);
      const expected = Object.fromEntries(Object.entries(pending.expected).map(([key, record]) => [key, record ? minimizeExpired(record) : null]));
      // Source checkpoints bind the immutable payload to a transaction ID.
      if (stableJson(records) !== stableJson(pending.records) || stableJson(expected) !== stableJson(pending.expected)) this.data.applyPending = { id: randomUUID(), records, expected };
    }
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(this.file + '.tmp', this.file);
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const running = this.exclusive.then(work, work);
    this.exclusive = running.catch(() => undefined);
    return running;
  }
  private validateShared(record: SharedRecord): SharedRecord {
    const clean = this.source.validate(projected(record));
    if (!Number.isSafeInteger(record.version) || record.version < 1 || typeof record.sourceDeviceId !== 'string' || record.sourceDeviceId.length > 100 || typeof record.sourceDeviceName !== 'string' || record.sourceDeviceName.length > 100 || typeof record.syncedAt !== 'string' || !Number.isFinite(Date.parse(record.syncedAt))) throw new PersonalError('云端同步记录无效。');
    return { ...clean, version: record.version, sourceDeviceId: record.sourceDeviceId, sourceDeviceName: record.sourceDeviceName, syncedAt: record.syncedAt };
  }
  private local(selected = this.data.scopes): Map<string, ProjectedRecord> {
    const result = new Map<string, ProjectedRecord>();
    for (const record of this.source.exportRecords()) {
      const clean = this.source.validate(record);
      if (!selected.includes(scopeOf(clean.kind))) continue;
      if (result.has(syncKey(clean))) throw new PersonalError('本机存在重复同步标识，请先核对。', 409);
      result.set(syncKey(clean), clean);
    }
    return result;
  }
  private async remote(selected: SyncScope[]): Promise<Map<string, SharedRecord>> {
    const result = new Map<string, SharedRecord>();
    if (!this.transport) return result;
    for (const item of await this.transport.pull(selected)) {
      const record = this.validateShared(item);
      if (!selected.includes(scopeOf(record.kind)) || result.has(syncKey(record))) throw new PersonalError('云端同步范围或标识无效。', 409);
      result.set(syncKey(record), record);
    }
    return result;
  }
  private missing(base: ProjectedRecord): ProjectedRecord {
    // Only an identity previously seen by this device can become a deletion.
    return { kind: base.kind, id: base.id, body: null, deletedAt: timestamp() };
  }
  private rows(selected: SyncScope[], local: Map<string, ProjectedRecord>, remote: Map<string, SharedRecord>): PreviewRow[] {
    const baseline = this.data.approvedDestination === (this.transport?.destination ?? null) ? this.data.baseline : {};
    const keys = new Set([...local.keys(), ...remote.keys(), ...Object.keys(baseline).filter(key => selected.includes(scopeOf(baseline[key].kind)))]);
    return [...keys].sort().map(key => {
      const base = baseline[key], cloud = remote.get(key);
      const own = local.get(key) ?? (base && base.body !== null ? this.missing(base) : undefined);
      const recovering = own && !own.deletedAt && base?.deletedAt && base.body && base.expiresAt && Date.parse(base.expiresAt) > Date.now();
      const collision = own?.kind === 'reading' && sourceIdentity(own) && [...remote.values()].find(item => syncKey(item) !== key && sourceIdentity(item) === sourceIdentity(own) && !(item.kind === 'readingSuppression' && (recovering || cloud)));
      const representedByConflict = !own && cloud?.kind === 'reading' && sourceIdentity(cloud) && [...local].some(([localKey, item]) => localKey !== key && sourceIdentity(item) === sourceIdentity(cloud));
      let action: PreviewRow['action'];
      const missingLocal = Boolean(base?.body && !local.has(key));
      // Only persisted, explicit tombstones propagate automatically. Losing a
      // source file or resetting a store cannot turn a baseline into deletions.
      if (missingLocal) action = 'conflict';
      else if (collision) action = 'conflict';
      else if (representedByConflict) action = 'unchanged';
      else if (!base) action = own && cloud ? sameRecord(own, cloud) ? 'unchanged' : 'conflict' : own ? own.body === null ? 'unchanged' : 'upload' : 'download';
      else {
        const changedLocal = !sameRecord(own ?? (base.body === null ? projected(base) : undefined), base);
        const changedRemote = !sameRecord(cloud, base);
        action = changedLocal && changedRemote && !sameRecord(own, cloud) ? 'conflict' : changedLocal ? 'upload' : changedRemote ? 'download' : 'unchanged';
      }
      return { kind: own?.kind ?? cloud?.kind ?? base.kind, id: own?.id ?? cloud?.id ?? base.id, title: title(own?.body ? own : cloud ?? base), action, ...(own ? { local: own } : {}), ...(collision || cloud ? { remote: collision || cloud } : {}), ...(missingLocal ? { missingLocal: true } : {}) };
    });
  }
  status() {
    const configured = Boolean(this.transport);
    const destinationChanged = this.data.approvedDestination !== (this.transport?.destination ?? null);
    const local = this.data.scopes.length ? this.local() : new Map<string, ProjectedRecord>();
    const localChanges = [...local].filter(([key, record]) => !sameRecord(record, this.data.baseline[key])).length;
    const removals = Object.entries(this.data.baseline).filter(([key, record]) => this.data.scopes.includes(scopeOf(record.kind)) && record.body !== null && !local.has(key)).length;
    const dirty = localChanges + removals;
    const mode = !configured ? 'local_only' : !this.data.scopes.length || destinationChanged ? 'preview_required' : this.data.issue === 'revoked' ? 'revoked' : this.data.issue ? 'offline' : this.data.conflicts.length ? 'conflict' : this.data.paused || this.data.outbox.length || dirty ? 'pending' : this.data.lastSyncedAt ? 'synced' : 'pending';
    return { mode, configured, device: this.data.device, scopes: this.data.scopes, paused: this.data.paused, pending: Math.max(this.data.outbox.filter(operation => this.data.scopes.includes(scopeOf(operation.record.kind))).length, dirty), conflicts: structuredClone(this.data.conflicts.map(item => ({ ...item, local: local.get(item.key) ?? (item.local ? this.missing(item.local) : null) }))), lastAttemptAt: this.data.lastAttemptAt, lastSyncedAt: this.data.lastSyncedAt, issue: this.data.issue ?? null, destination: this.transport?.destination ?? null };
  }
  provenance(record: ProjectedRecord) {
    const baseline = this.data.baseline[syncKey(record)];
    return baseline && sameRecord(record, baseline)
      ? { deviceId: baseline.sourceDeviceId, deviceName: baseline.sourceDeviceName, updatedAt: baseline.syncedAt }
      : { deviceId: this.data.device.id, deviceName: this.data.device.name, updatedAt: String(record.body?.updatedAt ?? record.body?.createdAt ?? timestamp()) };
  }
  preview(selected: unknown): Promise<Omit<Preview, 'fingerprint' | 'remoteFingerprint'>> {
    return this.serial(async () => {
      const approved = scopes(selected), own = this.local(approved), cloud = await this.remote(approved);
      const rows = this.rows(approved, own, cloud);
      this.previewValue = { id: randomUUID(), device: this.data.device, createdAt: timestamp(), scopes: approved, recordCount: own.size, uploadCount: rows.filter(row => row.action === 'upload').length, downloadCount: rows.filter(row => row.action === 'download').length, conflictCount: rows.filter(row => row.action === 'conflict').length, emptyDevice: ![...own.values()].some(record => record.body !== null), records: rows, attachmentsExcluded: this.source.attachments(), excluded: ['attachment_bytes', 'full_ai_conversations', 'external_tool_records', 'device_settings', 'project_actions_without_shared_identity'], destination: this.transport?.destination ?? null, fingerprint: hash([...own]), remoteFingerprint: hash([...cloud].sort(([a], [b]) => a.localeCompare(b))) };
      // Device identity is persistent, but previewing does not approve or upload anything.
      this.save();
      const { fingerprint: _fingerprint, remoteFingerprint: _remoteFingerprint, ...result } = this.previewValue;
      return structuredClone(result);
    });
  }
  approve(previewId: unknown, confirmed: unknown): Promise<ReturnType<PrivateSyncService['status']>> {
    return this.serial(async () => {
      const preview = this.previewValue;
      if (confirmed !== true || typeof previewId !== 'string' || !preview || preview.id !== previewId || Date.now() - Date.parse(preview.createdAt) > 15 * 60 * 1000) throw new PersonalError('请重新检查并确认同步预览。', 409);
      if (!this.transport) throw new PersonalError('尚未配置并验证私人云端；本机数据没有上传。', 409);
      if (preview.destination !== this.transport.destination || preview.fingerprint !== hash([...this.local(preview.scopes)])) throw new PersonalError('设备数据或云端目标已变化，请重新预览。', 409);
      const cloud = await this.remote(preview.scopes);
      if (preview.remoteFingerprint !== hash([...cloud].sort(([a], [b]) => a.localeCompare(b)))) throw new PersonalError('云端内容已变化，请重新预览后确认。', 409);
      if (this.source.backupMigration) this.data.migrationBackup = this.source.backupMigration(preview.id);
      if (this.data.approvedDestination !== this.transport.destination) { this.data.baseline = {}; this.data.outbox = []; this.data.conflicts = []; }
      else { this.data.outbox = this.data.outbox.filter(operation => preview.scopes.includes(scopeOf(operation.record.kind))); this.data.conflicts = this.data.conflicts.filter(item => preview.scopes.includes(scopeOf(item.kind))); }
      // A new confirmation cannot replay a former destination's or scope's unfinished download.
      delete this.data.applyPending;
      this.data.scopes = preview.scopes; this.data.approvedDestination = this.transport.destination; this.data.paused = false;
      delete this.data.issue; this.save(); this.previewValue = undefined;
      return this.status();
    });
  }
  private conflict(own: ProjectedRecord | null, remote: SharedRecord | null, base: SharedRecord | null, reason: SyncConflict['reason'] = 'concurrent_edit') {
    const item = own ?? remote ?? base!;
    const key = syncKey(item), existing = this.data.conflicts.find(conflict => conflict.key === key);
    if (existing) { existing.local = own; existing.remote = remote; }
    else this.data.conflicts.push({ id: randomUUID(), key, kind: item.kind, local: own, remote, base, reason, createdAt: timestamp() });
  }
  private apply(records: SharedRecord[]): void {
    if (!records.length) return;
    const local = this.local();
    this.data.applyPending = { id: randomUUID(), records, expected: Object.fromEntries(records.map(record => [syncKey(record), local.get(syncKey(record)) ?? null])) }; this.save();
    this.finishApply();
  }
  private finishApply(): void {
    let pending = this.data.applyPending;
    if (!pending) return;
    const local = this.local(), safe: SharedRecord[] = [];
    for (const record of pending.records) {
      const key = syncKey(record), current = local.get(key) ?? null, expected = pending.expected?.[key] ?? null;
      if (!sameRecord(current, expected) && !sameRecord(current, record)) {
        this.conflict(current ?? (expected ? this.missing(expected) : null), record, this.data.baseline[key] ?? null);
      } else safe.push(record);
    }
    if (safe.length !== pending.records.length) {
      pending = { id: randomUUID(), records: safe, expected: Object.fromEntries(safe.map(record => [syncKey(record), local.get(syncKey(record)) ?? null])) };
      this.data.applyPending = pending; this.save();
    }
    if (!pending.records.length) { delete this.data.applyPending; this.save(); return; }
    this.source.apply(pending.records.map(projected), pending.id);
    for (const record of pending.records) this.data.baseline[syncKey(record)] = record;
    delete this.data.applyPending; this.save();
  }
  run(): Promise<ReturnType<PrivateSyncService['status']>> {
    return this.serial(async () => {
      if (!this.transport || !this.data.scopes.length || this.data.approvedDestination !== this.transport.destination) throw new PersonalError('请先配置私人云端并确认首次同步预览。', 409);
      if (this.data.paused) return this.status();
      this.data.lastAttemptAt = timestamp(); this.save();
      try {
        // Never restore a cached cloud write before verifying this device's current grant.
        const cloud = await this.remote(this.data.scopes);
        this.finishApply();
        // A queued recovery snapshot must obey the same deadline while offline.
        // Its immutable request ID cannot be reused after minimizing the body.
        this.data.outbox = this.data.outbox.map(operation => operation.record.body && operation.record.expiresAt && Date.parse(operation.record.expiresAt) <= Date.now()
          ? { ...operation, id: randomUUID(), action: 'purge', record: { kind: operation.record.kind, id: operation.record.id, body: null, ...(operation.record.deletedAt ? { deletedAt: operation.record.deletedAt } : {}) } }
          : operation);
        let own = this.local();
        this.data.conflicts = this.data.conflicts.filter(conflict => {
          const current = own.get(conflict.key);
          const latest = conflict.remote ? cloud.get(syncKey(conflict.remote)) : undefined;
          if (conflict.reason !== 'same_source' || !current || !current.deletedAt && current.body !== null && latest?.body !== null && sourceIdentity(current) === sourceIdentity(latest ?? conflict.remote ?? current)) return true;
          // After the user reconciles or removes the duplicate in the shelf,
          // ordinary deltas can proceed. Keep both reviewed snapshots locally.
          this.data.resolved.push({ ...structuredClone(conflict), resolvedAt: timestamp() }); return false;
        });
        for (const conflict of this.data.conflicts) if (own.has(conflict.key)) conflict.local = own.get(conflict.key)!;
        const rows = this.rows(this.data.scopes, own, cloud), downloads: SharedRecord[] = [];
        for (const row of rows) {
          const key = syncKey(row), base = this.data.baseline[key];
          if (this.data.conflicts.some(item => item.key === key) || this.data.outbox.some(item => syncKey(item.record) === key)) continue;
          if (row.action === 'conflict') this.conflict(row.local ?? null, row.remote ?? null, base ?? null, row.missingLocal ? 'local_missing' : row.remote && syncKey(row.remote) !== key ? 'same_source' : 'concurrent_edit');
          else if (row.action === 'download' && row.remote) downloads.push(row.remote);
          else if (row.action === 'unchanged' && row.remote && (row.local || row.remote.body === null)) this.data.baseline[key] = row.remote;
          else if (row.action === 'upload' && row.local) {
            const action = row.local.body === null ? 'purge' : row.local.deletedAt ? 'delete' : base && (base.deletedAt || base.body === null) ? 'restore' : 'upsert';
            this.data.outbox.push({ id: randomUUID(), record: row.local, baseVersion: row.remote?.version ?? base?.version ?? 0, action });
          }
        }
        this.save(); this.apply(downloads); own = this.local();
        for (const operation of [...this.data.outbox].filter(item => this.data.scopes.includes(scopeOf(item.record.kind)))) {
          if (this.data.paused) break;
          const existing = cloud.get(syncKey(operation.record));
          if (existing && sameRecord(existing, operation.record)) {
            this.data.baseline[syncKey(existing)] = existing;
            this.data.outbox = this.data.outbox.filter(item => item.id !== operation.id); this.save(); continue;
          }
          const result = await this.transport.push(operation);
          const record = result.record ? this.validateShared(result.record) : null;
          const key = syncKey(operation.record);
          if (record && !this.data.scopes.includes(scopeOf(record.kind))) throw new PersonalError('云端响应超出已确认范围。', 409);
          if (result.status === 'conflict') this.conflict(own.get(key) ?? operation.record, record, this.data.baseline[key] ?? null, record && syncKey(record) !== key ? 'same_source' : 'concurrent_edit');
          else if (record) {
            if (syncKey(record) !== key || !sameRecord(record, operation.record)) throw new PersonalError('云端响应与提交记录不一致。', 409);
            this.data.baseline[key] = record;
          } else throw new PersonalError('云端没有确认同步结果。', 409);
          this.data.outbox = this.data.outbox.filter(item => item.id !== operation.id); this.save();
        }
        delete this.data.issue; this.data.lastSyncedAt = timestamp(); this.save(); return this.status();
      } catch (error) {
        this.data.issue = error instanceof PersonalError && [401, 403].includes(error.status) ? 'revoked' : this.data.applyPending ? 'apply_failed' : 'offline';
        this.save(); throw error instanceof PersonalError ? error : new PersonalError('私人云端暂时不可用，修改留在本机待同步。', 503);
      }
    });
  }
  resolve(id: string, choice: unknown, confirmed: unknown, body?: unknown) {
    return this.serial(async () => {
      if (confirmed !== true || !['local', 'remote', 'merged'].includes(choice as string)) throw new PersonalError('请确认要保留的冲突版本。');
      const conflict = this.data.conflicts.find(item => item.id === id);
      if (!conflict) throw new PersonalError('冲突已变化，请重新读取。', 404);
      if (!this.transport) throw new PersonalError('私人云端未配置。', 409);
      if (!this.data.scopes.length || this.data.approvedDestination !== this.transport.destination) throw new PersonalError('请先配置私人云端并确认首次同步预览。', 409);
      if (conflict.reason === 'same_source') {
        if (choice !== 'remote' || conflict.kind !== 'reading' || conflict.remote?.kind !== 'reading') throw new PersonalError('同一资料来源有不同标识；双方已保留，请先在迁移预览中核对，不能自动覆盖。', 409);
        const cloud = await this.remote(this.data.scopes), canonical = cloud.get(syncKey(conflict.remote));
        if (!canonical?.body || canonical.deletedAt || canonical.version !== conflict.remote.version) {
          conflict.remote = canonical ?? null; this.save(); throw new PersonalError('云端冲突版本已变化，请重新核对。', 409);
        }
        const local = this.local().get(conflict.key);
        const source = sourceIdentity(canonical);
        if (!local?.body || local.deletedAt && (!local.expiresAt || Date.parse(local.expiresAt) <= Date.now()) || !source || sourceIdentity({ ...local, deletedAt: undefined }) !== source) throw new PersonalError('本机版本已变化，请重新检查同步冲突。', 409);
        const suppression: ProjectedRecord = { kind: 'readingSuppression', id: source, body: null };
        if (this.data.outbox.some(operation => [conflict.key, syncKey(suppression)].includes(syncKey(operation.record)))) throw new PersonalError('这项记录仍有待同步请求，请完成重试后再核对。', 409);
        const deletedAt = timestamp();
        const removed = this.source.validate(local.body && !local.deletedAt
          ? { ...local, deletedAt, expiresAt: new Date(Date.parse(deletedAt) + 30 * 86400000).toISOString() }
          : projected(local));
        // One owned-store transaction preserves the latest notes in recovery,
        // adopts the reviewed canonical record and explicitly clears suppression.
        this.source.apply([removed, projected(canonical), suppression], randomUUID());
        this.data.baseline[syncKey(canonical)] = canonical;
        for (const record of [removed, suppression]) this.data.outbox.push({
          id: randomUUID(), record, baseVersion: cloud.get(syncKey(record))?.version ?? 0,
          action: record.body === null ? 'purge' : 'delete',
        });
        this.data.resolved.push({ ...structuredClone(conflict), local: structuredClone(local), remote: canonical, resolvedAt: timestamp() });
        this.data.conflicts = this.data.conflicts.filter(item => item.id !== id); this.save(); return this.status();
      }
      const cloud = await this.remote(this.data.scopes), key = conflict.key, current = cloud.get(key) ?? null;
      if (current?.version !== conflict.remote?.version) { conflict.remote = current; this.save(); throw new PersonalError('云端冲突版本已变化，请重新核对。', 409); }
      this.data.resolved = this.data.resolved.filter(item => Date.now() - Date.parse(item.resolvedAt) < 30 * 86400000);
      this.data.resolved.push({ ...structuredClone(conflict), resolvedAt: timestamp() });
      if (choice === 'remote') {
        if (current) this.apply([current]);
        else if (conflict.local) this.source.apply([{ ...conflict.local, body: null, deletedAt: timestamp() }], randomUUID());
      } else {
        const local = this.local().get(key) ?? (conflict.local ? this.missing(conflict.local) : null);
        if (!local) throw new PersonalError('本机版本不存在，请先保存合并内容。');
        const target = this.source.validate(choice === 'merged' ? { ...projected(local), body: body as Record<string, unknown> } : projected(local));
        if (choice === 'merged') this.source.apply([target], randomUUID());
        this.data.outbox.push({ id: randomUUID(), record: target, baseVersion: current?.version ?? 0, action: target.body === null ? 'purge' : target.deletedAt ? 'delete' : current && (current.deletedAt || current.body === null) ? 'restore' : 'upsert' });
      }
      this.data.conflicts = this.data.conflicts.filter(item => item.id !== id); this.save(); return this.status();
    });
  }
  pause() { this.data.paused = true; this.save(); return this.status(); }
  resume() { this.data.paused = false; this.save(); return this.status(); }
  async devices(): Promise<{ items: SyncDevice[] }> { return { items: this.transport ? await this.transport.devices() : [] }; }
  async revoke(id: string, confirmed: unknown) {
    if (confirmed !== true || !this.transport) throw new PersonalError('请确认撤销这台设备的云端访问。');
    await this.transport.revoke(id);
    if (id === this.data.device.id) { this.data.issue = 'revoked'; this.data.paused = true; this.save(); return { items: [], status: this.status() }; }
    return this.devices();
  }
  start() {
    if (!this.timer) { this.timer = setInterval(() => { if (this.transport && this.data.scopes.length && !this.data.paused && this.data.issue !== 'revoked') void this.run().catch(() => undefined); }, 60000); this.timer.unref(); }
  }
  close() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}
