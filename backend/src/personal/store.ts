import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { CALENDAR_DAYS, calendarProvider, calendarRange, loadCalendar, validateCalendarUrl } from './calendar';
import { listVaultNotes, readVaultNote, safeLocalPath, verifyCalendarFile, verifyVault } from './files';
import { PersonalError, type CalendarState, type PersonalSettings, type PersonalTodo, type ReadingItem, type ReadingRemovalResult, type ReportReadingState, type ReadingTrashEntry, type ReadingImportBatch, type ReadingImportCandidate, type ReadingImportCounts } from './types';
import { discoverReadingReports, findReadingReport, readingNotes, readingStatus, readingTitle, readingType, readingUrl } from './reading';
import { bilibiliVideoId, fetchBilibiliCover, readingCoverInput, COVER_CACHE_MS } from './covers';
import { canonicalReadingSource, classifyReading, parseReadingImport, readingCategory } from './reading-import';
import { presentedReadingItem, readingFingerprint, READING_IMPORT_WINDOW_MS, READING_TRASH_MS, validateSavedReading } from './reading-lifecycle';

interface SavedImportBatch extends ReadingImportBatch { fingerprints: Record<string, string>; revisions: Record<string, number>; undoIds?: { removedIds: string[]; conflictIds: string[]; skippedIds: string[] } }
interface SavedData {
  version: 1; settings: PersonalSettings; todos: PersonalTodo[]; readingItems: ReadingItem[];
  readingReports: Record<string, ReportReadingState>;
  readingTrash: ReadingTrashEntry[]; readingSuppressions: Record<string, string>;
  readingExpiredIds: Record<string, string>; readingImports: SavedImportBatch[]; readingRevisions: Record<string, number>;
}
const DEFAULT_SETTINGS = { vaultPath: '', calendarFile: '', calendarUrl: '', animationEnabled: true };
const INITIAL_CALENDAR: CalendarState = { status: 'unconfigured', events: [], updatedAt: null, message: '连接 Google Calendar、iCloud 日历订阅或本机 .ics 文件，只读取日程。' };

export function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PersonalError('请求内容必须是一个对象');
  return value as Record<string, unknown>;
}

function validateKeys(body: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new PersonalError('请求包含不支持的字段');
}

function todoTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) throw new PersonalError('待办标题应为 1–200 个字符');
  return value.trim();
}

function todoDate(value: unknown): string | null {
  if (value === null || value === '' || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new PersonalError('到期日期无效');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new PersonalError('到期日期无效');
  return value;
}

export class PersonalStore {
  private data: SavedData;
  private calendar: CalendarState = { ...INITIAL_CALENDAR, events: [] };
  private calendarInFlight: Promise<CalendarState> | null = null;
  private calendarRevision = 0;
  private coverInFlight = new Map<string, Promise<ReadingItem>>();

  // The unused second argument keeps existing local fixture scripts compatible.
  constructor(private readonly dataFile: string, _legacyDesktopPath?: string, private readonly readingBaseDir = join(homedir(), 'Documents', 'ChatGPT', '每日汇报，访谈和学习'), private readonly coverFetch: typeof fetch = fetch) {
    const defaults: PersonalSettings = { ...DEFAULT_SETTINGS, readingTechPath: join(readingBaseDir, '每日AI科技早报'), readingAestheticPath: join(readingBaseDir, '每日审美图鉴') };
    this.data = { version: 1, settings: defaults, todos: [], readingItems: [], readingReports: {}, readingTrash: [], readingSuppressions: {}, readingExpiredIds: {}, readingImports: [], readingRevisions: {} };
    if (existsSync(dataFile)) {
      const stored: unknown = JSON.parse(readFileSync(dataFile, 'utf8'));
      if (!stored || typeof stored !== 'object' || !('version' in stored) || stored.version !== 1 || !('settings' in stored) || !('todos' in stored) || !Array.isArray(stored.todos)) throw new Error('Personal workbench data is invalid; restore its backup before starting.');
      const previous = stored as SavedData;
      validateSavedReading(stored as Record<string, unknown>);
      // Add fields in memory for v1 installations; the next explicit mutation
      // persists them atomically without replacing existing settings or todos.
      this.data = {
        ...previous, settings: { ...defaults, ...previous.settings }, readingItems: previous.readingItems || [],
        readingReports: previous.readingReports || {},
        readingTrash: previous.readingTrash || [], readingSuppressions: previous.readingSuppressions || {},
        readingExpiredIds: previous.readingExpiredIds || {}, readingImports: previous.readingImports || [], readingRevisions: previous.readingRevisions || {},
      };
      delete (this.data.settings as PersonalSettings & { desktopPath?: string }).desktopPath;
    }
  }

  private persist(next: SavedData): void {
    // Expiration needs no background service. The next write drops complete
    // snapshots while retaining small IDs and source suppression tombstones.
    const expiredIds = { ...next.readingExpiredIds };
    const now = Date.now();
    const readingTrash = next.readingTrash.filter(entry => {
      if (Date.parse(entry.expiresAt) > now) return true;
      expiredIds[entry.item.id] = entry.expiresAt;
      return false;
    });
    next = { ...next, readingTrash, readingExpiredIds: Object.fromEntries(Object.entries(expiredIds).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 10000)) };
    mkdirSync(dirname(this.dataFile), { recursive: true });
    const pending = `${this.dataFile}.tmp`;
    writeFileSync(pending, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(pending, this.dataFile);
    this.data = next;
  }

  settings() {
    const { calendarUrl, ...publicFields } = this.data.settings;
    return { ...publicFields, calendarConfigured: Boolean(calendarUrl || publicFields.calendarFile), calendarUrlConfigured: Boolean(calendarUrl) };
  }

  updateSettings(value: unknown) {
    const body = objectBody(value);
    validateKeys(body, ['vaultPath', 'calendarFile', 'calendarUrl', 'animationEnabled', 'readingTechPath', 'readingAestheticPath']);
    const settings = { ...this.data.settings };
    if ('vaultPath' in body) {
      settings.vaultPath = safeLocalPath(body.vaultPath, 'Obsidian 仓库');
      if (settings.vaultPath) verifyVault(settings.vaultPath);
    }
    if ('calendarFile' in body) {
      settings.calendarFile = safeLocalPath(body.calendarFile, '日历文件');
      verifyCalendarFile(settings.calendarFile);
      if (settings.calendarFile) settings.calendarUrl = '';
    }
    if ('calendarUrl' in body) {
      settings.calendarUrl = validateCalendarUrl(body.calendarUrl);
      if (settings.calendarUrl) settings.calendarFile = '';
    }
    if ('animationEnabled' in body) {
      if (typeof body.animationEnabled !== 'boolean') throw new PersonalError('动画设置应为开启或关闭');
      settings.animationEnabled = body.animationEnabled;
    }
    if ('readingTechPath' in body) settings.readingTechPath = safeLocalPath(body.readingTechPath, '科技汇报') || join(this.readingBaseDir, '每日AI科技早报');
    if ('readingAestheticPath' in body) settings.readingAestheticPath = safeLocalPath(body.readingAestheticPath, '审美汇报') || join(this.readingBaseDir, '每日审美图鉴');
    const calendarChanged = settings.calendarFile !== this.data.settings.calendarFile || settings.calendarUrl !== this.data.settings.calendarUrl;
    this.persist({ ...this.data, settings });
    if (calendarChanged) {
      this.calendarRevision++;
      this.calendar = { ...INITIAL_CALENDAR, events: [] };
      this.calendarInFlight = null;
    }
    return this.settings();
  }

  todos(): PersonalTodo[] { return structuredClone(this.data.todos); }

  addTodo(value: unknown): PersonalTodo {
    const body = objectBody(value);
    validateKeys(body, ['title', 'dueDate']);
    if (this.data.todos.length >= 5000) throw new PersonalError('待办已达到 5000 条，请先删除不需要的事项');
    const todo: PersonalTodo = { id: randomUUID(), title: todoTitle(body.title), done: false, createdAt: new Date().toISOString(), dueDate: todoDate(body.dueDate) };
    this.persist({ ...this.data, todos: [todo, ...this.data.todos] });
    return todo;
  }

  editTodo(id: string, value: unknown): PersonalTodo {
    const body = objectBody(value);
    validateKeys(body, ['title', 'done', 'dueDate']);
    const current = this.data.todos.find(todo => todo.id === id);
    if (!current) throw new PersonalError('待办不存在', 404);
    const todo = { ...current };
    if ('title' in body) todo.title = todoTitle(body.title);
    if ('done' in body) {
      if (typeof body.done !== 'boolean') throw new PersonalError('完成状态无效');
      todo.done = body.done;
    }
    if ('dueDate' in body) todo.dueDate = todoDate(body.dueDate);
    this.persist({ ...this.data, todos: this.data.todos.map(item => item.id === id ? todo : item) });
    return todo;
  }

  deleteTodo(id: string): void {
    if (!this.data.todos.some(todo => todo.id === id)) throw new PersonalError('待办不存在', 404);
    this.persist({ ...this.data, todos: this.data.todos.filter(todo => todo.id !== id) });
  }

  vault(query = '') { return listVaultNotes(this.data.settings.vaultPath, query); }
  note(path: unknown) { return readVaultNote(this.data.settings.vaultPath, path); }

  reading() {
    const discovered = discoverReadingReports(this.data.settings, this.data.readingReports);
    const reports = discovered.reports.filter(report => !this.data.readingReports[report.item.id]?.hidden);
    return { items: [...structuredClone(this.data.readingItems).map(presentedReadingItem), ...reports.map(report => report.item)], sources: discovered.sources, scannedAt: discovered.scannedAt, trashCount: this.readingTrash().items.length, importCount: this.data.readingImports.length };
  }

  addReading(value: unknown): ReadingItem {
    const body = objectBody(value);
    validateKeys(body, ['title', 'type', 'url', 'notes', 'status', 'coverUrl', 'category']);
    if (this.data.readingItems.length >= 5000) throw new PersonalError('书架已达到 5000 项，请先移除不需要的内容');
    const now = new Date().toISOString();
    const item: ReadingItem = { id: `reading:${randomUUID()}`, title: readingTitle(body.title), type: readingType(body.type), url: readingUrl(body.url), notes: readingNotes(body.notes), status: body.status === undefined ? 'unread' : readingStatus(body.status), category: readingCategory(body.category), addedAt: now, updatedAt: now, origin: 'manual' };
    if (item.type !== 'book' && !item.url) throw new PersonalError('这类内容需要填写链接');
    if (item.url) item.sourceKey = canonicalReadingSource(item.url);
    if (item.status === 'done') item.finishedAt = now;
    if ('coverUrl' in body) {
      item.coverUrl = readingCoverInput(body.coverUrl, item);
      item.coverCheckedAt = now;
    }
    if (item.sourceKey && this.data.readingItems.some(previous => previous.url && canonicalReadingSource(previous.url) === item.sourceKey)) throw new PersonalError('书架中已有相同来源，请打开原条目', 409);
    const readingSuppressions = { ...this.data.readingSuppressions };
    if (item.sourceKey) delete readingSuppressions[item.sourceKey];
    this.persist({ ...this.data, readingItems: [item, ...this.data.readingItems], readingSuppressions });
    return item;
  }

  editReading(id: string, value: unknown): ReadingItem {
    const body = objectBody(value);
    if (id.startsWith('report:')) {
      validateKeys(body, ['status', 'category']);
      if (this.data.readingReports[id]?.hidden) throw new PersonalError('阅读内容不存在', 404);
      const report = findReadingReport(this.data.settings, this.data.readingReports, id);
      const status = 'status' in body ? readingStatus(body.status) : report.item.status;
      const category = 'category' in body ? readingCategory(body.category) : report.item.category;
      const finishedAt = status === 'done' ? report.item.finishedAt || ('status' in body ? new Date().toISOString() : undefined) : undefined;
      const saved: ReportReadingState = { status, category, ...(finishedAt ? { finishedAt } : {}), lastReadVersion: 'status' in body ? status === 'unread' ? null : report.version : this.data.readingReports[id]?.lastReadVersion || null };
      this.persist({ ...this.data, readingReports: { ...this.data.readingReports, [id]: saved } });
      const item = { ...report.item, status, category, ...('status' in body ? { updatedSinceRead: false } : {}) };
      if (finishedAt) item.finishedAt = finishedAt; else delete item.finishedAt;
      return item;
    }
    validateKeys(body, ['title', 'type', 'url', 'notes', 'status', 'coverUrl', 'category']);
    const current = this.data.readingItems.find(item => item.id === id);
    if (!current) throw new PersonalError('阅读内容不存在', 404);
    const coverOnly = Object.keys(body).length === 1 && 'coverUrl' in body;
    const item = { ...(coverOnly ? current : presentedReadingItem(current)), updatedAt: coverOnly ? current.updatedAt : new Date().toISOString() };
    if ('title' in body) item.title = readingTitle(body.title);
    if ('type' in body) item.type = readingType(body.type);
    if ('url' in body) item.url = readingUrl(body.url);
    if ('notes' in body) item.notes = readingNotes(body.notes);
    if ('status' in body) item.status = readingStatus(body.status);
    if ('category' in body) item.category = readingCategory(body.category);
    if ('status' in body) {
      if (item.status === 'done') item.finishedAt = item.finishedAt || new Date().toISOString();
      else delete item.finishedAt;
    }
    if ('url' in body) {
      if (item.url) item.sourceKey = canonicalReadingSource(item.url); else delete item.sourceKey;
      if (item.sourceKey && item.sourceKey !== (current.url ? canonicalReadingSource(current.url) : '') && this.data.readingItems.some(previous => previous.id !== id && previous.url && canonicalReadingSource(previous.url) === item.sourceKey)) throw new PersonalError('书架中已有相同来源，请打开原条目', 409);
    }
    if (item.type !== 'book' && !item.url) throw new PersonalError('这类内容需要填写链接');
    if (item.type !== current.type || item.url !== current.url) {
      delete item.coverUrl;
      delete item.coverCheckedAt;
    }
    if ('coverUrl' in body) {
      item.coverUrl = readingCoverInput(body.coverUrl, item);
      item.coverCheckedAt = new Date().toISOString();
    }
    const readingSuppressions = { ...this.data.readingSuppressions };
    if ('url' in body && item.sourceKey) delete readingSuppressions[item.sourceKey];
    this.persist({ ...this.data, readingItems: this.data.readingItems.map(previous => previous.id === id ? item : previous), readingSuppressions, readingRevisions: { ...this.data.readingRevisions, [id]: (this.data.readingRevisions[id] || 0) + (coverOnly ? 0 : 1) } });
    return presentedReadingItem(item);
  }

  async readingCover(id: string): Promise<ReadingItem> {
    const original = this.data.readingItems.find(item => item.id === id);
    if (!original) throw new PersonalError('阅读内容不存在', 404);
    const bvid = bilibiliVideoId(original);
    if (!bvid) return presentedReadingItem(structuredClone(original));
    const checkedAt = Date.parse(original.coverCheckedAt || '');
    if (Number.isFinite(checkedAt) && Date.now() - checkedAt >= 0 && Date.now() - checkedAt < COVER_CACHE_MS) return presentedReadingItem(structuredClone(original));
    const key = `${id}\0${original.type}\0${original.url}`;
    const pending = this.coverInFlight.get(key);
    if (pending) return pending;
    const request = (async () => {
      const coverUrl = await fetchBilibiliCover(bvid, this.coverFetch);
      const current = this.data.readingItems.find(item => item.id === id);
      if (!current) throw new PersonalError('阅读内容不存在', 404);
      // A delayed result must never restore a removed entry or undo a user's edit.
      if (current.type !== original.type || current.url !== original.url || current.coverCheckedAt !== original.coverCheckedAt) return presentedReadingItem(structuredClone(current));
      const item = { ...current, coverCheckedAt: new Date().toISOString(), ...(coverUrl ? { coverUrl } : {}) };
      this.persist({ ...this.data, readingItems: this.data.readingItems.map(entry => entry.id === id ? item : entry) });
      return presentedReadingItem(structuredClone(item));
    })();
    this.coverInFlight.set(key, request);
    try { return await request; } finally { if (this.coverInFlight.get(key) === request) this.coverInFlight.delete(key); }
  }

  deleteReading(id: string): void {
    this.removeReading({ ids: [id] });
  }

  removeReading(value: unknown): ReadingRemovalResult {
    const body = objectBody(value);
    validateKeys(body, ['ids', 'all']);
    const removeAll = body.all === true && !('ids' in body);
    if (!removeAll && ('all' in body || !Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 10000 || body.ids.some(id => typeof id !== 'string' || !id || id.length > 128))) {
      throw new PersonalError('请选择 1–10000 项阅读内容，或明确移除全部内容');
    }
    // Resolve the current shelf once, validate the entire request, then persist
    // one replacement. A stale selection must never remove only some items.
    const items = this.reading().items;
    const selectedIds = removeAll ? items.map(item => item.id) : [...new Set(body.ids as string[])];
    const currentIds = new Set(items.map(item => item.id));
    if (selectedIds.some(id => !currentIds.has(id))) throw new PersonalError('部分阅读内容已不存在，请刷新书架后重试', 404);
    if (selectedIds.length === 0) return { removedIds: [] };
    const selected = new Set(selectedIds);
    this.persist(this.removedReadingData(items.filter(item => selected.has(item.id)), `removal:${randomUUID()}`));
    return { removedIds: selectedIds };
  }

  private removedReadingData(items: ReadingItem[], batchId: string): SavedData {
    const selected = new Set(items.map(item => item.id));
    const readingReports = { ...this.data.readingReports };
    const readingSuppressions = { ...this.data.readingSuppressions };
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + READING_TRASH_MS).toISOString();
    const entries: ReadingTrashEntry[] = [];
    for (const item of items) {
      const entry: ReadingTrashEntry = { item: structuredClone(item), deletedAt: now, expiresAt, batchId };
      if (item.origin === 'report') {
        entry.reportState = structuredClone(readingReports[item.id] || { status: item.status, lastReadVersion: null });
        readingReports[item.id] = { ...(readingReports[item.id] || { status: item.status, lastReadVersion: null }), hidden: true };
      } else if (item.url) {
        readingSuppressions[canonicalReadingSource(item.url)] = now;
      }
      entries.push(entry);
    }
    return { ...this.data, readingItems: this.data.readingItems.filter(item => !selected.has(item.id)), readingReports, readingSuppressions, readingTrash: [...entries, ...this.data.readingTrash.filter(entry => !selected.has(entry.item.id))] };
  }

  readingTrash() {
    return { items: structuredClone(this.data.readingTrash.filter(entry => Date.parse(entry.expiresAt) > Date.now())).map(entry => ({ ...entry, item: presentedReadingItem(entry.item), expired: false })) };
  }

  restoreReading(value: unknown) {
    const body = objectBody(value);
    validateKeys(body, ['ids']);
    if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 10000 || body.ids.some(id => typeof id !== 'string' || !id || id.length > 128)) throw new PersonalError('请选择要恢复的阅读内容');
    const ids = [...new Set(body.ids as string[])];
    const currentItems = this.reading().items;
    const currentIds = new Set(currentItems.map(item => item.id));
    const sourceKeys = new Set(currentItems.filter(item => item.url).map(item => canonicalReadingSource(item.url)));
    const entries = ids.map(id => {
      const entry = this.data.readingTrash.find(candidate => candidate.item.id === id);
      if (this.data.readingExpiredIds[id] || (entry && Date.parse(entry.expiresAt) <= Date.now())) throw new PersonalError('这项内容已超过 30 天恢复期限', 410);
      if (!entry) throw new PersonalError('回收站内容不存在，请刷新后重试', 404);
      const sourceKey = entry.item.url ? canonicalReadingSource(entry.item.url) : '';
      if (currentIds.has(id) || (sourceKey && sourceKeys.has(sourceKey))) throw new PersonalError('书架中已有相同来源，无法重复恢复', 409);
      if (sourceKey) sourceKeys.add(sourceKey);
      if (entry.item.origin === 'report') findReadingReport(this.data.settings, this.data.readingReports, id);
      return entry;
    });
    const manual = entries.filter(entry => entry.item.origin === 'manual').map(entry => presentedReadingItem(structuredClone(entry.item)));
    if (this.data.readingItems.length + manual.length > 5000) throw new PersonalError('书架已达到 5000 项，请先移除不需要的内容');
    const readingReports = { ...this.data.readingReports };
    const readingSuppressions = { ...this.data.readingSuppressions };
    const readingRevisions = { ...this.data.readingRevisions };
    for (const entry of entries) {
      const item = entry.item;
      if (item.origin === 'report') readingReports[item.id] = { ...(entry.reportState || { status: item.status, lastReadVersion: null }), category: item.category, ...(item.finishedAt ? { finishedAt: item.finishedAt } : {}), hidden: false };
      if (item.url) delete readingSuppressions[canonicalReadingSource(item.url)];
      readingRevisions[item.id] = (readingRevisions[item.id] || 0) + 1;
    }
    const selected = new Set(ids);
    this.persist({ ...this.data, readingItems: [...manual, ...this.data.readingItems], readingReports, readingSuppressions, readingRevisions, readingTrash: this.data.readingTrash.filter(entry => !selected.has(entry.item.id)) });
    return { restoredIds: ids, items: this.reading().items.filter(item => selected.has(item.id)) };
  }

  suppressReading(value: unknown) {
    const body = objectBody(value);
    validateKeys(body, ['urls']);
    if (!Array.isArray(body.urls) || body.urls.length > 10000) throw new PersonalError('请提供最多 10000 个已移除的来源链接');
    const keys = [...new Set(body.urls.map(value => {
      const url = readingUrl(value);
      if (!url) throw new PersonalError('已移除的来源需要有效链接');
      return canonicalReadingSource(url);
    }))];
    const current = new Set(this.data.readingItems.filter(item => item.url).map(item => canonicalReadingSource(item.url)));
    const readingSuppressions = { ...this.data.readingSuppressions };
    let suppressedCount = 0;
    let skippedExistingCount = 0;
    for (const key of keys) {
      if (current.has(key)) { skippedExistingCount++; continue; }
      if (!readingSuppressions[key]) { readingSuppressions[key] = new Date().toISOString(); suppressedCount++; }
    }
    if (suppressedCount) this.persist({ ...this.data, readingSuppressions });
    return { suppressedCount, skippedExistingCount };
  }

  previewReadingImport(value: unknown) {
    const now = Date.now();
    const payload = parseReadingImport(value, now);
    const existing = new Set(this.data.readingItems.filter(item => item.url).map(item => canonicalReadingSource(item.url)));
    const accepted = new Set(payload.acceptedUrls?.map(canonicalReadingSource));
    const excluded = new Set(payload.excludedUrls?.map(canonicalReadingSource));
    // Multiple captures may contain an older low-progress position. Only the
    // newest position decides eligibility; ties prefer the more cautious value.
    const latest = new Map<string, number>();
    payload.items.forEach((item, index) => {
      const previousIndex = latest.get(item.sourceKey);
      if (previousIndex === undefined) { latest.set(item.sourceKey, index); return; }
      const previous = payload.items[previousIndex];
      const dateDifference = Date.parse(item.viewedAt) - Date.parse(previous.viewedAt);
      if (dateDifference > 0 || (dateDifference === 0 && (item.progress ?? 2) > (previous.progress ?? 2))) latest.set(item.sourceKey, index);
    });
    const candidates: ReadingImportCandidate[] = payload.items.map((item, index) => {
      const classification = classifyReading(item.title, item.notes);
      const result: ReadingImportCandidate = { ...item, index, category: classification.category, reason: classification.reason, decision: classification.decision };
      const viewed = Date.parse(item.viewedAt);
      if (existing.has(item.sourceKey)) { result.decision = 'duplicate'; result.reason = '同一来源已经在书架中，保留现有进度与笔记。'; }
      else if (latest.get(item.sourceKey) !== index) { result.decision = 'duplicate'; result.reason = '同一来源出现多次，只使用最近一次观看记录。'; }
      else if (this.data.readingSuppressions[item.sourceKey]) { result.decision = 'suppressed'; result.reason = '这个来源曾被移除或明确排除，不会自动重新收录。'; }
      else if (excluded.has(item.sourceKey)) { result.decision = 'excluded'; result.reason = '你已在本次预览中排除此来源。'; }
      else if (viewed < now - READING_IMPORT_WINDOW_MS || viewed > now) { result.decision = 'excluded'; result.reason = '观看时间不在最近 7 × 24 小时内。'; }
      else if (item.progress === null) { result.decision = 'review'; result.reason = '缺少可靠的播放进度，补充后才能收录。'; }
      else if (item.progress >= 0.25) { result.decision = 'excluded'; result.reason = '播放进度已达到 25%，不符合本次导入条件。'; }
      else if (classification.decision === 'review' && accepted.has(item.sourceKey)) { result.decision = 'import'; result.reason = '你已确认这条内容适合学习或实践。'; }
      if (result.decision === 'import') existing.add(item.sourceKey);
      return result;
    });
    const counts: ReadingImportCounts = { total: candidates.length, accepted: 0, excluded: 0, review: 0, duplicates: 0, suppressed: 0 };
    for (const candidate of candidates) counts[candidate.decision === 'import' ? 'accepted' : candidate.decision === 'duplicate' ? 'duplicates' : candidate.decision]++;
    return { candidates, counts, ...(payload.coverage ? { coverage: payload.coverage } : {}), window: { from: new Date(now - READING_IMPORT_WINDOW_MS).toISOString(), to: new Date(now).toISOString() } };
  }

  private presentedImportBatch(batch: SavedImportBatch): ReadingImportBatch {
    const { fingerprints: _fingerprints, revisions: _revisions, undoIds: _undoIds, ...visible } = batch;
    return structuredClone({ ...visible, candidates: visible.candidates.map(candidate => ({ ...candidate, category: readingCategory(candidate.category) })), canUndo: batch.itemIds.length > 0 && !batch.undoneAt });
  }

  readingImports() { return { items: this.data.readingImports.map(batch => this.presentedImportBatch(batch)) }; }

  importReading(value: unknown) {
    // Preview and commit share the same validation. Commit checks the current
    // shelf again; stale previews cannot restore deletions or reset completion.
    const preview = this.previewReadingImport(value);
    const now = new Date().toISOString();
    const id = `import:${randomUUID()}`;
    const items: ReadingItem[] = preview.candidates.filter(candidate => candidate.decision === 'import').map(candidate => ({
      id: `reading:${randomUUID()}`, title: candidate.title, type: 'video', url: candidate.url,
      notes: candidate.notes, status: 'unread', category: candidate.category, sourceKey: candidate.sourceKey,
      importBatchId: id, addedAt: now, updatedAt: now, origin: 'manual',
      ...(candidate.coverUrl ? { coverUrl: candidate.coverUrl, coverCheckedAt: now } : {}),
    }));
    if (this.data.readingItems.length + items.length > 5000) throw new PersonalError('书架已达到 5000 项，请先移除不需要的内容');
    const batch: SavedImportBatch = {
      id, createdAt: now, ...(preview.coverage ? { coverage: preview.coverage } : {}), counts: preview.counts,
      addedCount: items.length, duplicateCount: preview.counts.duplicates, excludedCount: preview.counts.excluded,
      reviewCount: preview.counts.review, suppressedCount: preview.counts.suppressed, itemIds: items.map(item => item.id),
      // Audit keeps decisions, titles and links; complete private notes live only
      // in their item and its time-limited recycle snapshot.
      candidates: preview.candidates.map(({ coverUrl: _coverUrl, ...candidate }) => ({ ...candidate, notes: '' })),
      canUndo: items.length > 0, fingerprints: Object.fromEntries(items.map(item => [item.id, readingFingerprint(item)])),
      revisions: Object.fromEntries(items.map(item => [item.id, 0])),
    };
    const readingSuppressions = { ...this.data.readingSuppressions };
    for (const candidate of preview.candidates) if (candidate.reason === '你已在本次预览中排除此来源。') readingSuppressions[candidate.sourceKey] = now;
    this.persist({ ...this.data, readingItems: [...items, ...this.data.readingItems], readingImports: [batch, ...this.data.readingImports], readingSuppressions });
    return { batch: this.presentedImportBatch(batch), items: structuredClone(items), candidates: preview.candidates, counts: preview.counts };
  }

  undoReadingImport(id: string) {
    const batch = this.data.readingImports.find(candidate => candidate.id === id);
    if (!batch) throw new PersonalError('导入批次不存在', 404);
    if (batch.undoneAt) return { batchId: id, ...(batch.undoIds || { removedIds: [], conflictIds: [], skippedIds: [] }), alreadyUndone: true };
    const removal: ReadingItem[] = [];
    const conflictIds: string[] = [];
    const skippedIds: string[] = [];
    for (const itemId of batch.itemIds) {
      const current = this.data.readingItems.find(item => item.id === itemId);
      if (!current) { skippedIds.push(itemId); continue; }
      if (readingFingerprint(current) !== batch.fingerprints[itemId] || (this.data.readingRevisions[itemId] || 0) !== batch.revisions[itemId]) { conflictIds.push(itemId); continue; }
      removal.push(presentedReadingItem(current));
    }
    const removedIds = removal.map(item => item.id);
    const next = this.removedReadingData(removal, id);
    const updatedBatch: SavedImportBatch = { ...batch, undoneAt: new Date().toISOString(), canUndo: false, undoResult: { removedCount: removedIds.length, conflictCount: conflictIds.length, skippedCount: skippedIds.length }, undoIds: { removedIds, conflictIds, skippedIds } };
    next.readingImports = next.readingImports.map(candidate => candidate.id === id ? updatedBatch : candidate);
    this.persist(next);
    return { batchId: id, removedIds, conflictIds, skippedIds, alreadyUndone: false };
  }

  readingPdf(id: string): string { return findReadingReport(this.data.settings, this.data.readingReports, id).filePath; }

  async calendarState(force = false): Promise<CalendarState> {
    if (!this.data.settings.calendarFile && !this.data.settings.calendarUrl) return { ...INITIAL_CALENDAR, events: [] };
    if (this.calendarInFlight) return this.calendarInFlight;
    if (!force && this.calendar.updatedAt && Date.now() - Date.parse(this.calendar.updatedAt) < 5 * 60 * 1000) return this.calendar;
    const revision = this.calendarRevision;
    const settings = { ...this.data.settings };
    const request = (async () => {
      let result: CalendarState;
      try {
        const events = await loadCalendar(settings);
        const provider = calendarProvider(settings);
        const range = calendarRange();
        result = { status: 'ready', events, provider, range: { from: range.from.toISOString(), to: range.to.toISOString(), days: CALENDAR_DAYS }, updatedAt: new Date().toISOString(), message: provider === 'file' ? '本机日历快照 · 显示今天起 180 天内的日程。更新 .ics 文件后点击刷新。' : provider === 'google' ? 'Google 只读日历 · 显示今天起 180 天内的日程。' : 'iCloud 只读日历 · 显示今天起 180 天内的日程。' };
      } catch (error) {
        result = { status: 'error', events: [], updatedAt: null, message: error instanceof PersonalError ? error.message : '日历读取失败，请检查文件或订阅地址。' };
      }
      if (revision === this.calendarRevision) this.calendar = result;
      return result;
    })();
    this.calendarInFlight = request;
    try { return await request; } finally { if (this.calendarInFlight === request) this.calendarInFlight = null; }
  }

  finance() {
    return { status: 'unconnected' as const, provider: 'Chase', message: '当前工作台尚未取得你此前绑定的 Chase 授权。需要确认绑定所在的应用后，才能接入真实账户与交易。', accounts: [], transactions: [] };
  }

  async state() {
    return { settings: this.settings(), todos: this.todos(), calendar: await this.calendarState(), vault: this.vault(), finance: this.finance() };
  }
}
