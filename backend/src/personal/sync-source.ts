import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PersonalStore } from './store';
import type { InspirationStore } from './inspiration-store';
import type { JournalStore } from './journal';
import { validateSharedProjectRecord, type SharedProjectStore } from './shared-projects';
import type { SyncSource } from './private-sync';
import { PERSONAL_SYNC_KINDS, GARDEN_SYNC_KINDS, JOURNAL_SYNC_KINDS, validateProjectedRecord, type ProjectedRecord } from './sync-projection';
import { canonicalReadingSource } from './reading-import';
import { sameRecord, stableJson, syncKey } from './sync-ledger';
import { PersonalError } from './types';

type Store = { syncExport(): ProjectedRecord[]; syncApply(records: ProjectedRecord[]): void };
export interface SyncSourceOptions {
  store: Pick<PersonalStore, 'syncExport' | 'syncApply'>;
  inspiration: Pick<InspirationStore, 'syncExport' | 'syncApply'>;
  journal: Pick<JournalStore, 'syncExport' | 'syncApply'>;
  projects: Pick<SharedProjectStore, 'syncExport' | 'syncApply'>;
  dataDirectory: string;
}
const GROUPS = ['personal', 'garden', 'journal', 'projects'] as const;
type Group = typeof GROUPS[number];
const OWNED_FILES = ['personal-workbench.json', 'inspiration-garden.json', 'work-journal.json', 'shared-projects.json'] as const;
const MIGRATION_FILES = [...OWNED_FILES, 'private-sync.json'] as const;
interface BackupFile { name: typeof OWNED_FILES[number]; existed: boolean; size: number; sha256: string | null }
interface MigrationFile { name: typeof MIGRATION_FILES[number]; existed: boolean; size: number; sha256: string | null }
interface MigrationBackup { id: string; createdAt: string; files: MigrationFile[] }
interface MigrationManifest extends MigrationBackup { version: 1; prepared: boolean }
interface Checkpoint { version: 1; transactionId: string; fingerprint: string; createdAt: string; completedAt: string | null; prepared: boolean; groups: Group[]; expected: Record<string, ProjectedRecord | null>; files: BackupFile[] }
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const validId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const fail = () => { throw new PersonalError('同步应用检查点或备份无效；未继续写入，请保留本机数据并检查私人备份。', 409); };
function safeDirectory(path: string, recursive = false): void {
  if (!existsSync(path)) mkdirSync(path, { recursive, mode: 0o700 });
  const stat = lstatSync(path); if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
}
function readOwned(file: string): Buffer | null { if (!existsSync(file)) return null; const stat = lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) fail(); return readFileSync(file); }
function atomic(file: string, value: string | Buffer): void {
  const pending = `${file}.${randomUUID()}.tmp`;
  writeFileSync(pending, value, { mode: 0o600, flag: 'wx' });
  try { renameSync(pending, file); } finally { rmSync(pending, { force: true }); }
}
function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).some(key => !keys.includes(key)); }

/** Portable record deltas with a local recovery journal. No external files or credentials are read. */
export function createSyncSource(options: SyncSourceOptions): SyncSource {
  const directory = resolve(options.dataDirectory);
  const stores: Record<Group, Store> = { personal: options.store, garden: options.inspiration, journal: options.journal, projects: options.projects };
  function group(record: ProjectedRecord): Group {
    if ((PERSONAL_SYNC_KINDS as readonly string[]).includes(record.kind)) return 'personal';
    if ((GARDEN_SYNC_KINDS as readonly string[]).includes(record.kind)) return 'garden';
    if ((JOURNAL_SYNC_KINDS as readonly string[]).includes(record.kind)) return 'journal';
    if (record.kind === 'project') return 'projects';
    throw new PersonalError('不支持的同步记录类型。');
  }
  function validate(record: ProjectedRecord): ProjectedRecord { group(record); return record.kind === 'project' ? validateSharedProjectRecord(record) : validateProjectedRecord(record); }
  function validateBatch(records: ProjectedRecord[]): ProjectedRecord[] {
    if (!Array.isArray(records) || records.length > 50000) throw new PersonalError('同步记录数量或格式无效。');
    const seen = new Set<string>();
    return records.map(record => { const clean = validate(record), key = syncKey(clean); if (seen.has(key)) throw new PersonalError('同步记录标识重复。'); seen.add(key); return clean; });
  }
  function exported(): ProjectedRecord[] { return validateBatch(GROUPS.flatMap(key => stores[key].syncExport())); }
  function source(record: ProjectedRecord): string {
    if (record.kind !== 'reading' || !record.body || record.deletedAt) return '';
    const url = typeof record.body.url === 'string' ? record.body.url : '';
    return url ? canonicalReadingSource(url) : typeof record.body.sourceKey === 'string' ? record.body.sourceKey : '';
  }
  function checkSources(records: ProjectedRecord[], current: ProjectedRecord[]): void {
    const after = new Map(current.map(record => [syncKey(record), record])); records.forEach(record => after.set(syncKey(record), record));
    const sources = new Map<string, string>();
    for (const record of after.values()) { const key = source(record); if (!key) continue; if (sources.has(key) && sources.get(key) !== record.id) throw new PersonalError('同一资料来源存在不同同步标识；双方记录保留，请先核对。', 409); sources.set(key, record.id); }
  }
  function loadCheckpoint(file: string, transactionId: string, fingerprint: string, records: ProjectedRecord[]): Checkpoint {
    try {
      const bytes = readOwned(file); if (!bytes) return fail(); const value = JSON.parse(bytes.toString('utf8')) as Checkpoint;
      if (!exactKeys(value, ['version', 'transactionId', 'fingerprint', 'createdAt', 'completedAt', 'prepared', 'groups', 'expected', 'files']) || value.version !== 1 || value.transactionId !== transactionId || value.fingerprint !== fingerprint || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.prepared !== 'boolean' || value.completedAt !== null && (typeof value.completedAt !== 'string' || !Number.isFinite(Date.parse(value.completedAt))) || !Array.isArray(value.groups) || value.groups.some(key => !GROUPS.includes(key)) || new Set(value.groups).size !== value.groups.length || !exactKeys(value.expected, records.map(syncKey)) || Object.keys(value.expected).length !== records.length || !Array.isArray(value.files) || value.files.length !== OWNED_FILES.length) return fail();
      const wantedGroups = new Set(records.map(group)); if (value.groups.some(key => !wantedGroups.has(key)) || value.completedAt && (!value.prepared || value.groups.length !== wantedGroups.size)) return fail();
      for (const record of records) { const previous = value.expected[syncKey(record)]; if (previous !== null && (!previous || syncKey(validate(previous)) !== syncKey(record))) return fail(); }
      for (const [index, entry] of value.files.entries()) if (!exactKeys(entry, ['name', 'existed', 'size', 'sha256']) || entry.name !== OWNED_FILES[index] || typeof entry.existed !== 'boolean' || !Number.isSafeInteger(entry.size) || entry.size < 0 || (entry.existed ? typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) : entry.sha256 !== null || entry.size !== 0)) return fail();
      return value;
    } catch { return fail(); }
  }
  function prepareBackups(checkpoint: Checkpoint, transactionDirectory: string): void {
    for (const entry of checkpoint.files) {
      if (!entry.existed) { if (!checkpoint.prepared && existsSync(join(directory, entry.name))) throw new PersonalError('备份准备期间本机数据已变化；请重新检查同步预览。', 409); continue; }
      const copy = join(transactionDirectory, entry.name), existing = readOwned(copy);
      if (existing) { if (existing.byteLength !== entry.size || digest(existing) !== entry.sha256) fail(); continue; }
      if (checkpoint.prepared) fail();
      const original = readOwned(join(directory, entry.name));
      if (!original || original.byteLength !== entry.size || digest(original) !== entry.sha256) throw new PersonalError('备份准备期间本机数据已变化；请重新检查同步预览。', 409);
      atomic(copy, original);
    }
  }
  function desired(current: ProjectedRecord | undefined, record: ProjectedRecord): boolean {
    if (record.body === null || record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) return !current || current.body === null;
    return sameRecord(current, record);
  }
  function migrationBackup(transactionId: string): MigrationBackup {
    if (!validId(transactionId)) throw new PersonalError('迁移备份标识无效。');
    const backups = join(directory, 'migration-backups'), location = join(backups, digest(transactionId)), file = join(location, 'manifest.json');
    safeDirectory(directory, true); safeDirectory(backups); safeDirectory(location);
    let manifest: MigrationManifest;
    if (existsSync(file)) {
      try {
        const bytes = readOwned(file); if (!bytes) return fail(); manifest = JSON.parse(bytes.toString('utf8'));
        if (!exactKeys(manifest, ['id', 'createdAt', 'files', 'version', 'prepared']) || manifest.version !== 1 || manifest.id !== transactionId || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt)) || typeof manifest.prepared !== 'boolean' || !Array.isArray(manifest.files) || manifest.files.length !== MIGRATION_FILES.length) return fail();
        for (const [index, entry] of manifest.files.entries()) if (!exactKeys(entry, ['name', 'existed', 'size', 'sha256']) || entry.name !== MIGRATION_FILES[index] || typeof entry.existed !== 'boolean' || !Number.isSafeInteger(entry.size) || entry.size < 0 || (entry.existed ? typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) : entry.sha256 !== null || entry.size !== 0)) return fail();
      } catch { return fail(); }
    } else {
      manifest = { version: 1, id: transactionId, createdAt: new Date().toISOString(), prepared: false, files: MIGRATION_FILES.map(name => { const bytes = readOwned(join(directory, name)); return { name, existed: bytes !== null, size: bytes?.byteLength ?? 0, sha256: bytes ? digest(bytes) : null }; }) };
      atomic(file, JSON.stringify(manifest, null, 2));
    }
    for (const entry of manifest.files) {
      if (!entry.existed) { if (!manifest.prepared && existsSync(join(directory, entry.name))) throw new PersonalError('迁移备份准备期间本机数据已变化，请重新预览。', 409); continue; }
      const copy = join(location, entry.name), existing = readOwned(copy);
      if (existing) { if (existing.byteLength !== entry.size || digest(existing) !== entry.sha256) fail(); continue; }
      if (manifest.prepared) fail();
      const original = readOwned(join(directory, entry.name));
      if (!original || original.byteLength !== entry.size || digest(original) !== entry.sha256) throw new PersonalError('迁移备份准备期间本机数据已变化，请重新预览。', 409);
      atomic(copy, original);
    }
    if (!manifest.prepared) { manifest.prepared = true; atomic(file, JSON.stringify(manifest, null, 2)); }
    return structuredClone({ id: manifest.id, createdAt: manifest.createdAt, files: manifest.files });
  }
  return {
    validate,
    exportRecords: exported,
    backupMigration: migrationBackup,
    attachments() {
      const metadata = new Map<string, { name: string; size: number }>();
      for (const record of validateBatch(options.store.syncExport())) { const attachment = record.kind === 'reading' && record.body?.attachmentMetadata; if (attachment && typeof attachment === 'object') { const value = attachment as Record<string, unknown>; if (typeof value.id === 'string' && typeof value.name === 'string' && typeof value.size === 'number') metadata.set(value.id, { name: value.name, size: value.size }); } }
      return [...metadata.values()];
    },
    apply(input, transactionId) {
      const records = validateBatch(input); if (!validId(transactionId)) throw new PersonalError('同步事务标识无效。'); if (!records.length) return;
      const fingerprint = digest(stableJson([...records].sort((a, b) => syncKey(a).localeCompare(syncKey(b))))), current = exported();
      const backups = join(directory, 'sync-backups'), transactionDirectory = join(backups, digest(transactionId)), checkpointFile = join(transactionDirectory, 'checkpoint.json');
      if (!existsSync(checkpointFile)) checkSources(records, current);
      safeDirectory(directory, true); safeDirectory(backups); safeDirectory(transactionDirectory);
      let checkpoint: Checkpoint;
      if (existsSync(checkpointFile)) checkpoint = loadCheckpoint(checkpointFile, transactionId, fingerprint, records);
      else {
        const before = new Map(current.map(record => [syncKey(record), record]));
        checkpoint = { version: 1, transactionId, fingerprint, createdAt: new Date().toISOString(), completedAt: null, prepared: false, groups: [], expected: Object.fromEntries(records.map(record => [syncKey(record), before.get(syncKey(record)) ?? null])), files: OWNED_FILES.map(name => { const bytes = readOwned(join(directory, name)); return { name, existed: bytes !== null, size: bytes?.byteLength ?? 0, sha256: bytes ? digest(bytes) : null }; }) };
        atomic(checkpointFile, JSON.stringify(checkpoint, null, 2));
      }
      if (checkpoint.completedAt) return;
      checkSources(records.filter(record => !checkpoint.groups.includes(group(record))), exported());
      prepareBackups(checkpoint, transactionDirectory);
      if (!checkpoint.prepared) { checkpoint.prepared = true; atomic(checkpointFile, JSON.stringify(checkpoint, null, 2)); }
      for (const name of GROUPS) {
        const selected = records.filter(record => group(record) === name); if (!selected.length || checkpoint.groups.includes(name)) continue;
        const now = new Map(stores[name].syncExport().map(record => [syncKey(record), validate(record)]));
        for (const record of selected) if (!sameRecord(now.get(syncKey(record)), checkpoint.expected[syncKey(record)]) && !desired(now.get(syncKey(record)), record)) throw new PersonalError('同步中断后本机记录又有编辑；修改已保留，请重新检查冲突。', 409);
        stores[name].syncApply(selected);
        checkpoint.groups.push(name); atomic(checkpointFile, JSON.stringify(checkpoint, null, 2));
      }
      checkpoint.completedAt = new Date().toISOString(); atomic(checkpointFile, JSON.stringify(checkpoint, null, 2));
    },
  };
}
