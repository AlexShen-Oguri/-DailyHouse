import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { PersonalError } from './types';
import { applyJournal, projectJournal, loadSyncTombstones, trackSyncTombstones, JOURNAL_SYNC_KINDS, type ProjectedRecord } from './sync-projection';

const FIELDS = ['title', 'codex', 'life', 'reflection', 'status', 'lifeState'] as const;
type Field = typeof FIELDS[number];
export interface JournalEntry {
  date: string;
  timezone: 'America/New_York';
  title: string;
  codex: string;
  life: string;
  reflection: string;
  status: 'draft' | 'final';
  lifeState: 'waiting' | 'provided' | 'skipped';
  createdAt: string;
  updatedAt: string;
  revision: number;
  editedFields: Field[];
  writer: 'codex' | 'manual';
}
interface TrashEntry { entry: JournalEntry; deletedAt: string; expiresAt: string }
interface JournalData { version: 1; entries: JournalEntry[]; trash: TrashEntry[]; deletedDates: string[]; revisions: Record<string, number>; syncTombstones?: ProjectedRecord[] }
const RECOVERY_MS = 30 * 86400000;

export function journalDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') throw new PersonalError('日记日期无效');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new PersonalError('日记日期无效');
  return value;
}

function body(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PersonalError('日记请求必须是一个对象');
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new PersonalError('日记请求包含不支持的字段');
  return value as Record<string, unknown>;
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new PersonalError('请提供日记的当前版本');
  return value;
}
function fields(input: Record<string, unknown>, previous?: JournalEntry): Pick<JournalEntry, Field> {
  const result = previous ? Object.fromEntries(FIELDS.map(key => [key, previous[key]])) : { title: '工作日记', codex: '', life: '', reflection: '', status: 'draft', lifeState: 'waiting' };
  for (const key of ['title', 'codex', 'life', 'reflection'] as const) {
    if (!(key in input)) continue;
    const limit = key === 'title' ? 160 : key === 'reflection' ? 12000 : 24000;
    if (typeof input[key] !== 'string' || input[key].length > limit) throw new PersonalError('日记文字过长或格式无效');
    result[key] = input[key].trim();
  }
  if ('status' in input) {
    if (!['draft', 'final'].includes(input.status as string)) throw new PersonalError('日记状态无效');
    result.status = input.status as string;
  }
  if ('lifeState' in input) {
    if (!['waiting', 'provided', 'skipped'].includes(input.lifeState as string)) throw new PersonalError('现实活动状态无效');
    result.lifeState = input.lifeState as string;
  }
  if (!result.title || !(result.codex || result.life || result.reflection)) throw new PersonalError('请填写标题和至少一部分日记内容');
  if (result.lifeState === 'provided' && !result.life) throw new PersonalError('请填写现实活动，或选择未补充');
  return result as Pick<JournalEntry, Field>;
}
function summary(entry: JournalEntry) {
  const { codex, life, reflection, editedFields: _locks, ...rest } = entry;
  return { ...rest, preview: (codex || life || reflection).slice(0, 180) };
}
function validTimestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function savedEntry(value: unknown): JournalEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid journal entry');
  const entry = value as JournalEntry;
  journalDate(entry.date);
  const clean = fields(entry as unknown as Record<string, unknown>);
  if (FIELDS.some(key => entry[key] !== clean[key]) || entry.timezone !== 'America/New_York' || revision(entry.revision) < 1 || !validTimestamp(entry.createdAt) || !validTimestamp(entry.updatedAt) || !['codex', 'manual'].includes(entry.writer) || !Array.isArray(entry.editedFields) || entry.editedFields.some(key => !FIELDS.includes(key)) || new Set(entry.editedFields).size !== entry.editedFields.length) throw new Error('Invalid journal entry');
  return entry;
}

/** One local page per New York calendar date. No raw conversations or credentials. */
export class JournalStore {
  private data: JournalData = { version: 1, entries: [], trash: [], deletedDates: [], revisions: {} };
  syncExport(): ProjectedRecord[] { return projectJournal(this.data); }
  syncApply(records: ProjectedRecord[]): void {
    const next = applyJournal(this.data, records);
    // Use the native validator before any write, including existing manual locks.
    next.entries.forEach(savedEntry); next.trash.forEach(item => savedEntry(item.entry));
    if (JSON.stringify(next) !== JSON.stringify(this.data)) this.save(next);
  }
  constructor(private readonly dataFile: string) {
    if (!existsSync(dataFile)) return;
    try {
      const data = JSON.parse(readFileSync(dataFile, 'utf8')) as JournalData;
      loadSyncTombstones(data.syncTombstones, JOURNAL_SYNC_KINDS);
      if (data.version !== 1 || !Array.isArray(data.entries) || !Array.isArray(data.trash) || !Array.isArray(data.deletedDates) || !data.revisions || typeof data.revisions !== 'object' || Array.isArray(data.revisions)) throw new Error('Invalid journal data');
      data.entries.forEach(savedEntry);
      data.trash.forEach(item => {
        savedEntry(item.entry);
        if (!validTimestamp(item.deletedAt) || !validTimestamp(item.expiresAt) || Date.parse(item.expiresAt) - Date.parse(item.deletedAt) !== RECOVERY_MS) throw new Error('Invalid journal recovery');
      });
      data.deletedDates.forEach(journalDate);
      for (const [date, savedRevision] of Object.entries(data.revisions)) { journalDate(date); if (revision(savedRevision) < 1) throw new Error('Invalid journal version'); }
      if ([...data.entries, ...data.trash.map(item => item.entry)].some(item => data.revisions[item.date] !== item.revision) || data.deletedDates.some(date => !data.revisions[date])) throw new Error('Invalid journal version');
      const dates = [...data.entries.map(item => item.date), ...data.trash.map(item => item.entry.date)];
      if (new Set(dates).size !== dates.length || new Set(data.deletedDates).size !== data.deletedDates.length || data.entries.some(item => data.deletedDates.includes(item.date)) || data.trash.some(item => !data.deletedDates.includes(item.entry.date))) throw new Error('Duplicate journal dates');
      this.data = data;
    } catch { throw new Error('Work journal data is invalid; restore its backup before starting.'); }
  }
  private save(next: JournalData): void {
    const revisions = { ...next.revisions };
    for (const entry of [...next.entries, ...next.trash.map(item => item.entry)]) revisions[entry.date] = Math.max(revisions[entry.date] ?? 0, entry.revision);
    let clean = { ...next, revisions, trash: next.trash.filter(item => Date.parse(item.expiresAt) > Date.now()) };
    const tombstones = trackSyncTombstones(projectJournal(this.data), projectJournal({ ...clean, syncTombstones: undefined }), clean.syncTombstones, JOURNAL_SYNC_KINDS);
    if (tombstones.length || clean.syncTombstones !== undefined) clean = { ...clean, syncTombstones: tombstones };
    mkdirSync(dirname(this.dataFile), { recursive: true });
    const pending = `${this.dataFile}.${randomUUID()}.tmp`;
    writeFileSync(pending, JSON.stringify(clean, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try { renameSync(pending, this.dataFile); } finally { rmSync(pending, { force: true }); }
    this.data = clean;
  }
  list(query: unknown = '', month: unknown = '') {
    if (typeof query !== 'string' || query.length > 200 || typeof month !== 'string' || (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) throw new PersonalError('日记筛选无效');
    const q = query.trim().toLocaleLowerCase();
    const items = this.data.entries.filter(entry => (!month || entry.date.startsWith(month)) && (!q || [entry.date, entry.title, entry.codex, entry.life, entry.reflection].some(text => text.toLocaleLowerCase().includes(q))));
    return { items: structuredClone(items.sort((a, b) => b.date.localeCompare(a.date)).map(summary)), total: this.data.entries.length, timezone: 'America/New_York' };
  }
  get(date: unknown): JournalEntry {
    const key = journalDate(date);
    const entry = this.data.entries.find(item => item.date === key);
    if (!entry) throw new PersonalError(this.data.deletedDates.includes(key) ? '这一天的日记已删除，自动写入不会重新创建' : '这一天尚未写日记', this.data.deletedDates.includes(key) ? 410 : 404);
    return structuredClone(entry);
  }
  private write(date: string, input: Record<string, unknown>, writer: JournalEntry['writer'], expected: number): JournalEntry {
    const current = this.data.entries.find(item => item.date === date);
    if ((current?.revision ?? 0) !== expected) throw new PersonalError('日记已更新，请核对最新内容后重试', 409);
    if (!current && this.data.deletedDates.includes(date)) {
      if (writer === 'codex') throw new PersonalError('这一天的日记已删除，自动写入不会重新创建', 410);
      if (this.data.trash.some(item => item.entry.date === date && Date.parse(item.expiresAt) > Date.now())) throw new PersonalError('请先从回收站恢复这一天的日记', 409);
    }
    const nextFields = fields(input, current);
    const changed = FIELDS.filter(key => !current || nextFields[key] !== current[key]);
    if (writer === 'codex' && current && changed.some(key => current.editedFields.includes(key))) throw new PersonalError('日记包含手动修改，请核对后保留这些内容', 409);
    if (current && !changed.length) return structuredClone(current);
    const now = new Date().toISOString();
    const entry: JournalEntry = { ...nextFields, date, timezone: 'America/New_York', createdAt: current?.createdAt ?? now, updatedAt: now, revision: Math.max(expected, this.data.revisions[date] ?? 0) + 1, editedFields: [...new Set([...(current?.editedFields ?? []), ...(writer === 'manual' ? changed : [])])], writer };
    this.save({ ...this.data, entries: [...this.data.entries.filter(item => item.date !== date), entry], trash: this.data.trash.filter(item => item.entry.date !== date), deletedDates: this.data.deletedDates.filter(item => item !== date) });
    return structuredClone(entry);
  }
  create(value: unknown) {
    const input = body(value, ['date', ...FIELDS]);
    return this.write(journalDate(input.date), input, 'manual', 0);
  }
  edit(date: unknown, value: unknown) {
    const input = body(value, ['revision', ...FIELDS]);
    const current = this.get(date);
    return this.write(current.date, input, 'manual', revision(input.revision));
  }
  publish(value: unknown) {
    const input = body(value, ['date', 'revision', ...FIELDS]);
    return this.write(journalDate(input.date), input, 'codex', revision(input.revision));
  }
  trash() {
    return { items: this.data.trash.filter(item => Date.parse(item.expiresAt) > Date.now()).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)).map(item => ({ ...summary(item.entry), deletedAt: item.deletedAt, expiresAt: item.expiresAt })) };
  }
  remove(date: unknown, value: unknown) {
    const input = body(value, ['revision', 'confirmed']);
    const current = this.get(date);
    if (input.confirmed !== true) throw new PersonalError('请确认删除日记；聊天和其他记录都会保留');
    if (revision(input.revision) !== current.revision) throw new PersonalError('日记已更新，请核对最新内容后重试', 409);
    const now = Date.now();
    this.save({ ...this.data, entries: this.data.entries.filter(item => item.date !== current.date), deletedDates: [...this.data.deletedDates, current.date], trash: [...this.data.trash, { entry: current, deletedAt: new Date(now).toISOString(), expiresAt: new Date(now + RECOVERY_MS).toISOString() }] });
  }
  restore(date: unknown, value: unknown) {
    const input = body(value, ['revision']);
    const key = journalDate(date);
    const removed = this.data.trash.find(item => item.entry.date === key && Date.parse(item.expiresAt) > Date.now());
    if (!removed) throw new PersonalError('日记不存在或已超过 30 天恢复期限', 404);
    if (revision(input.revision) !== removed.entry.revision || this.data.entries.some(item => item.date === key)) throw new PersonalError('日记已更新，请核对最新内容后重试', 409);
    const entry = { ...removed.entry, revision: removed.entry.revision + 1, updatedAt: new Date().toISOString() };
    this.save({ ...this.data, entries: [...this.data.entries, entry], trash: this.data.trash.filter(item => item.entry.date !== key), deletedDates: this.data.deletedDates.filter(item => item !== key) });
    return structuredClone(entry);
  }
}
