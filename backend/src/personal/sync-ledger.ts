import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import { canonicalReadingSource } from './reading-import';
import type { ProjectedRecord } from './sync-projection';
import { PersonalError } from './types';

export type SyncScope = 'todos' | 'reading' | 'ideas' | 'learning' | 'journal' | 'projects';
export const SYNC_SCOPES: SyncScope[] = ['todos', 'reading', 'ideas', 'learning', 'journal', 'projects'];
export function scopeOf(kind: string): SyncScope {
  if (kind === 'todo') return 'todos';
  if (['reading', 'readingReport', 'readingSuppression', 'readingExpired'].includes(kind)) return 'reading';
  if (['idea', 'ideaRemoved', 'ideaMeta'].includes(kind)) return 'ideas';
  if (kind === 'learning') return 'learning';
  if (['journal', 'journalSuppression'].includes(kind)) return 'journal';
  if (['gardenProject', 'project'].includes(kind)) return 'projects';
  throw new PersonalError('Unsupported sync record.', 400);
}
export interface SharedRecord extends ProjectedRecord { version: number; sourceDeviceId: string; sourceDeviceName: string; syncedAt: string }
export interface SyncCredentials { deviceId: string; token: string }
export interface SyncOperation { id: string; record: ProjectedRecord; baseVersion: number; action: 'upsert' | 'delete' | 'restore' | 'purge' }
export type SyncResult = { status: 'accepted'; record: SharedRecord } | { status: 'conflict'; record: SharedRecord | null };
export interface SyncDevice { id: string; name: string; scopes: SyncScope[]; revoked: boolean; administrator: boolean; lastSeenAt: string | null }
export interface SyncTransport {
  readonly destination: string;
  pull(scopes: SyncScope[]): Promise<SharedRecord[]>;
  push(operation: SyncOperation): Promise<SyncResult>;
  devices(): Promise<SyncDevice[]>;
  revoke(id: string): Promise<void>;
}
export const syncKey = (record: Pick<ProjectedRecord, 'kind' | 'id'>) => JSON.stringify([record.kind, record.id]);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  return '{' + Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + stableJson(item)).join(',') + '}';
}
export const projected = (record: SharedRecord | ProjectedRecord): ProjectedRecord => ({ kind: record.kind, id: record.id, body: record.body, ...(record.deletedAt ? { deletedAt: record.deletedAt } : {}), ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}) });
export const sameRecord = (a: ProjectedRecord | undefined | null, b: ProjectedRecord | undefined | null) => stableJson(a ? projected(a) : null) === stableJson(b ? projected(b) : null);
export const newDeviceToken = () => randomBytes(32).toString('base64url');

/** Single-owner reference ledger. Its database is separate from the local workbench. */
export class SyncLedger {
  private db: DatabaseSync;
  constructor(file: string, private ownerSecret: string, private validate: (record: ProjectedRecord) => ProjectedRecord) {
    if (ownerSecret.length < 32) throw new Error('A private owner secret is required.');
    this.db = new DatabaseSync(file);
    if (file !== ':memory:') chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL, scopes TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, administrator INTEGER NOT NULL DEFAULT 0, last_seen TEXT);
      CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL, source_key TEXT);
      CREATE INDEX IF NOT EXISTS records_source_receipts ON records(source_key);
      CREATE TABLE IF NOT EXISTS operations (device_id TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(device_id,id));`);
  }
  private nextSyncTime(source: string | null): string {
    // BEGIN IMMEDIATE serializes receipts, including independently opened ledgers.
    const values = source ? this.db.prepare('SELECT value FROM records WHERE source_key=?').all(source) as { value: string }[] : [];
    const time = values.reduce((latest, row) => Math.max(latest, Date.parse((JSON.parse(row.value) as SharedRecord).syncedAt) + 1), Date.now());
    return new Date(time).toISOString();
  }
  private cleanExpired(scopes: SyncScope[]) {
    const values = this.db.prepare('SELECT key,value,source_key FROM records').all() as { key: string; value: string; source_key: string | null }[];
    for (const row of values) {
      const record = JSON.parse(row.value) as SharedRecord;
      if (!scopes.includes(scopeOf(record.kind))) continue;
      const before = stableJson(record);
      if (record.body && record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) { record.body = null; delete record.expiresAt; }
      else if (record.kind === 'learning' && Array.isArray(record.body?.entries)) record.body.entries = record.body.entries.filter((entry: any) => !entry.removedAt || !entry.expiresAt || Date.parse(entry.expiresAt) > Date.now());
      if (before !== stableJson(record)) { record.version += 1; record.syncedAt = this.nextSyncTime(row.source_key); this.db.prepare('UPDATE records SET value=? WHERE key=?').run(JSON.stringify(record), row.key); }
    }
  }
  pair(ownerSecret: string, device: { id: string; name: string; token: string; scopes: SyncScope[]; administrator?: boolean }): void {
    if (!timingSafeEqual(Buffer.from(hash(ownerSecret)), Buffer.from(hash(this.ownerSecret)))) throw new PersonalError('Owner authorization required.', 403);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(device.id) || !device.name.trim() || device.name.length > 100 || !/^[a-zA-Z0-9_-]{43}$/.test(device.token) || !Array.isArray(device.scopes) || !device.scopes.length || device.scopes.some(scope => !SYNC_SCOPES.includes(scope))) throw new PersonalError('Invalid device grant.');
    // A revoked identity cannot be recycled with another key. Pair a new device identity.
    if (this.db.prepare('SELECT id FROM devices WHERE id=?').get(device.id)) throw new PersonalError('This device identity already exists.', 409);
    this.db.prepare('INSERT INTO devices(id,name,token_hash,scopes,administrator) VALUES(?,?,?,?,?)').run(device.id, device.name, hash(device.token), JSON.stringify([...new Set(device.scopes)]), device.administrator ? 1 : 0);
  }
  private authorize(credentials: SyncCredentials, required?: SyncScope): SyncDevice {
    if (!credentials || typeof credentials.deviceId !== 'string' || typeof credentials.token !== 'string') throw new PersonalError('Device authorization required.', 401);
    const row = this.db.prepare('SELECT * FROM devices WHERE id=?').get(credentials.deviceId) as { id: string; name: string; token_hash: string; scopes: string; revoked: number; administrator: number; last_seen: string | null } | undefined;
    if (!row || !timingSafeEqual(Buffer.from(row.token_hash), Buffer.from(hash(credentials.token)))) throw new PersonalError('Device authorization required.', 401);
    if (row.revoked) throw new PersonalError('Device access was revoked.', 403);
    const scopes = JSON.parse(row.scopes) as SyncScope[];
    if (required && !scopes.includes(required)) throw new PersonalError('This device is not authorized for this scope.', 403);
    this.db.prepare('UPDATE devices SET last_seen=? WHERE id=?').run(new Date().toISOString(), row.id);
    return { id: row.id, name: row.name, scopes, revoked: false, administrator: Boolean(row.administrator), lastSeenAt: row.last_seen };
  }
  pull(credentials: SyncCredentials, scopes: SyncScope[]): SharedRecord[] {
    this.db.exec('BEGIN IMMEDIATE');
    try {
    const device = this.authorize(credentials);
    if (!Array.isArray(scopes) || scopes.some(scope => !SYNC_SCOPES.includes(scope) || !device.scopes.includes(scope))) throw new PersonalError('Unauthorized sync scope.', 403);
    this.cleanExpired(scopes);
    const result = (this.db.prepare('SELECT value FROM records ORDER BY key').all() as { value: string }[]).map(row => JSON.parse(row.value) as SharedRecord).filter(record => scopes.includes(scopeOf(record.kind)));
    if (result.length > 50000 || Buffer.byteLength(JSON.stringify(result)) > 64 * 1024 * 1024) throw new PersonalError('Sync snapshot is too large; narrow its scope.', 413);
    this.db.exec('COMMIT'); return structuredClone(result);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  push(credentials: SyncCredentials, input: SyncOperation): SyncResult {
    if (!input || Object.keys(input).some(key => !['id', 'record', 'baseVersion', 'action'].includes(key)) || !/^[0-9a-f-]{36}$/i.test(input.id) || !Number.isSafeInteger(input.baseVersion) || input.baseVersion < 0 || !['upsert', 'delete', 'restore', 'purge'].includes(input.action)) throw new PersonalError('Invalid sync operation.');
    const record = this.validate(input.record);
    if (Buffer.byteLength(JSON.stringify(record)) > 8 * 1024 * 1024) throw new PersonalError('Sync record is too large.', 413);
    const fingerprint = hash(stableJson({ ...input, record }));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const device = this.authorize(credentials, scopeOf(record.kind));
      this.cleanExpired([scopeOf(record.kind)]);
      const prior = this.db.prepare('SELECT fingerprint,result FROM operations WHERE device_id=? AND id=?').get(device.id, input.id) as { fingerprint: string; result: string } | undefined;
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new PersonalError('A retry cannot change its original operation.', 409);
        const saved = JSON.parse(prior.result) as { status: SyncResult['status']; key: string; version: number };
        const latest = this.db.prepare('SELECT value FROM records WHERE key=?').get(saved.key) as { value: string } | undefined;
        const current = latest ? JSON.parse(latest.value) as SharedRecord : null;
        this.db.exec('COMMIT');
        return saved.status === 'accepted' && current && current.version === saved.version ? { status: 'accepted', record: current } : { status: 'conflict', record: current };
      }
      const row = this.db.prepare('SELECT value,source_key FROM records WHERE key=?').get(syncKey(record)) as { value: string; source_key: string | null } | undefined;
      const current = row ? JSON.parse(row.value) as SharedRecord : null;
      let result: SyncResult;
      const resurrects = current && (current.deletedAt || current.body === null) && !record.deletedAt && record.body !== null;
      let duplicate: SharedRecord | undefined;
      if (record.kind === 'reading' && record.body && !record.deletedAt) {
        const source = record.body.url ? canonicalReadingSource(String(record.body.url)) : String(record.body.sourceKey ?? '');
        if (source) {
          const values = (this.db.prepare('SELECT value,source_key FROM records WHERE key<>?').all(syncKey(record)) as { value: string; source_key: string | null }[]).map(item => ({ record: JSON.parse(item.value) as SharedRecord, source: item.source_key }));
          duplicate = values.find(item => item.record.kind === 'reading' && item.record.body && !item.record.deletedAt && item.source === source)?.record;
          const suppression = values.find(item => item.record.kind === 'readingSuppression' && item.record.id === source)?.record;
          const recovering = input.action === 'restore' && Boolean(current?.body && current.deletedAt && current.expiresAt && Date.parse(current.expiresAt) > Date.now());
          if (!duplicate && !recovering) {
            if (suppression?.body) duplicate = suppression;
            else if (!current) duplicate = values.find(item => item.record.kind === 'reading' && item.source === source && (item.record.deletedAt || item.record.body === null) && (!suppression || Date.parse(suppression.syncedAt) <= Date.parse(item.record.syncedAt)))?.record;
          }
        }
      }
      if (duplicate) result = { status: 'conflict', record: duplicate };
      else if ((current?.version ?? 0) !== input.baseVersion || (resurrects && (input.action !== 'restore' || current.body === null || current.expiresAt && Date.parse(current.expiresAt) <= Date.now()))) result = { status: 'conflict', record: current };
      else {
        if (input.action === 'purge' && record.body !== null || input.action === 'delete' && !record.deletedAt || ['upsert', 'restore'].includes(input.action) && (record.deletedAt || record.body === null)) throw new PersonalError('Sync deletion intent does not match the record.');
        const source = record.kind === 'reading' && record.body ? record.body.url ? canonicalReadingSource(String(record.body.url)) : String(record.body.sourceKey ?? '') || null : record.kind === 'readingSuppression' ? record.id : row?.source_key ?? null;
        const next: SharedRecord = { ...record, version: (current?.version ?? 0) + 1, sourceDeviceId: device.id, sourceDeviceName: device.name, syncedAt: this.nextSyncTime(source) };
        this.db.prepare('INSERT INTO records(key,value,source_key) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,source_key=COALESCE(excluded.source_key,records.source_key)').run(syncKey(record), JSON.stringify(next), source);
        result = { status: 'accepted', record: next };
      }
      // Idempotency remembers the accepted identity/version, never another permanent copy of private content.
      this.db.prepare('INSERT INTO operations(device_id,id,fingerprint,result) VALUES(?,?,?,?)').run(device.id, input.id, fingerprint, JSON.stringify({ status: result.status, key: syncKey(result.record ?? record), version: result.record?.version ?? 0 }));
      this.db.exec('COMMIT'); return structuredClone(result);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  devices(credentials: SyncCredentials): SyncDevice[] {
    this.authorize(credentials);
    return (this.db.prepare('SELECT id,name,scopes,revoked,administrator,last_seen FROM devices ORDER BY id').all() as any[]).map(row => ({ id: row.id, name: row.name, scopes: JSON.parse(row.scopes), revoked: Boolean(row.revoked), administrator: Boolean(row.administrator), lastSeenAt: row.last_seen }));
  }
  revoke(credentials: SyncCredentials, id: string): void {
    if (!this.authorize(credentials).administrator) throw new PersonalError('Device administrator authorization required.', 403);
    if (this.db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(id).changes !== 1) throw new PersonalError('Device not found.', 404);
  }
  close() { this.db.close(); }
}
