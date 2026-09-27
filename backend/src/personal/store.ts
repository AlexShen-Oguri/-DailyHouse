import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { loadCalendar, validateCalendarUrl } from './calendar';
import { listVaultNotes, readVaultNote, safeLocalPath, verifyCalendarFile, verifyVault } from './files';
import { PersonalError, type CalendarState, type PersonalSettings, type PersonalTodo, type ReadingItem, type ReadingRemovalResult, type ReportReadingState, type WorkflowItem } from './types';
import { discoverReadingReports, findReadingReport, readingNotes, readingStatus, readingTitle, readingType, readingUrl } from './reading';
import { bilibiliVideoId, fetchBilibiliCover, readingCoverInput, COVER_CACHE_MS } from './covers';
import { workflowContent } from './workflow';

interface SavedData { version: 1; settings: PersonalSettings; todos: PersonalTodo[]; readingItems: ReadingItem[]; readingReports: Record<string, ReportReadingState>; workflowItems: WorkflowItem[] }
const DEFAULT_SETTINGS = { vaultPath: '', calendarFile: '', calendarUrl: '', animationEnabled: true };
const INITIAL_CALENDAR: CalendarState = { status: 'unconfigured', events: [], updatedAt: null, message: '连接已有的 iCloud 日历订阅或本机 .ics 文件，只读取日程。' };

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
    this.data = { version: 1, settings: defaults, todos: [], readingItems: [], readingReports: {}, workflowItems: [] };
    if (existsSync(dataFile)) {
      const stored: unknown = JSON.parse(readFileSync(dataFile, 'utf8'));
      if (!stored || typeof stored !== 'object' || !('version' in stored) || stored.version !== 1 || !('settings' in stored) || !('todos' in stored) || !Array.isArray(stored.todos)) throw new Error('Personal workbench data is invalid; restore its backup before starting.');
      const previous = stored as SavedData;
      if ('workflowItems' in stored && !Array.isArray(previous.workflowItems)) throw new Error('Personal workbench workflow data is invalid; restore its backup before starting.');
      // Add fields in memory for v1 installations; the next explicit mutation
      // persists them atomically without replacing existing settings or todos.
      this.data = { ...previous, settings: { ...defaults, ...previous.settings }, readingItems: previous.readingItems || [], readingReports: previous.readingReports || {}, workflowItems: previous.workflowItems || [] };
      delete (this.data.settings as PersonalSettings & { desktopPath?: string }).desktopPath;
    }
  }

  private persist(next: SavedData): void {
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

  workflow() { return { items: structuredClone(this.data.workflowItems) }; }

  addWorkflow(value: unknown): WorkflowItem {
    const content = workflowContent(objectBody(value));
    if (this.data.workflowItems.length >= 5000) throw new PersonalError('工作流已达到 5000 项，暂时无法添加更多内容');
    const now = new Date().toISOString();
    const item: WorkflowItem = { ...content, id: `workflow:${randomUUID()}`, readingId: null, todoId: null, createdAt: now, updatedAt: now };
    this.persist({ ...this.data, workflowItems: [item, ...this.data.workflowItems] });
    return structuredClone(item);
  }

  editWorkflow(id: string, value: unknown): WorkflowItem {
    const body = objectBody(value);
    const current = this.data.workflowItems.find(item => item.id === id);
    if (!current) throw new PersonalError('工作流内容不存在', 404);
    const item: WorkflowItem = { ...current, ...workflowContent(body, current), updatedAt: new Date().toISOString() };
    this.persist({ ...this.data, workflowItems: this.data.workflowItems.map(previous => previous.id === id ? item : previous) });
    return structuredClone(item);
  }

  importWorkflowReading(value: unknown): WorkflowItem {
    const body = objectBody(value);
    validateKeys(body, ['id']);
    if (typeof body.id !== 'string' || !body.id || body.id.length > 128) throw new PersonalError('请选择有效的书架内容');
    if (body.id.startsWith('report:')) throw new PersonalError('请从手动添加的书架内容导入工作流');
    const reading = this.data.readingItems.find(item => item.id === body.id && item.origin === 'manual');
    if (!reading) throw new PersonalError('阅读内容不存在', 404);
    const existing = this.data.workflowItems.find(item => item.readingId === reading.id);
    if (existing) return structuredClone(existing);
    if (this.data.workflowItems.length >= 5000) throw new PersonalError('工作流已达到 5000 项，暂时无法添加更多内容');
    const content = workflowContent({
      title: reading.title, url: reading.url, notes: reading.notes,
      kind: reading.type === 'video' || reading.type === 'course' ? reading.type : reading.type === 'github' ? 'project' : 'article',
      status: reading.status === 'done' ? 'done' : reading.status === 'reading' ? 'active' : 'inbox',
    });
    const now = new Date().toISOString();
    const item: WorkflowItem = { ...content, id: `workflow:${randomUUID()}`, readingId: reading.id, todoId: null, createdAt: now, updatedAt: now };
    this.persist({ ...this.data, workflowItems: [item, ...this.data.workflowItems] });
    return structuredClone(item);
  }

  workflowTodo(id: string, value: unknown): { item: WorkflowItem; todo: PersonalTodo; created: boolean } {
    const body = objectBody(value);
    validateKeys(body, ['dueDate']);
    if ('dueDate' in body && body.dueDate !== null && (typeof body.dueDate !== 'string' || !body.dueDate)) throw new PersonalError('到期日期无效');
    const dueDate = todoDate(body.dueDate);
    const current = this.data.workflowItems.find(item => item.id === id);
    if (!current) throw new PersonalError('工作流内容不存在', 404);
    const existing = this.data.todos.find(todo => todo.id === current.todoId);
    // Reuse unfinished work and retries of a completed action. A different
    // saved action can follow a completed task while preserving its history.
    if (existing && (!existing.done || existing.title === current.nextAction || !current.nextAction.trim())) return structuredClone({ item: current, todo: existing, created: false });
    if (!current.nextAction.trim()) throw new PersonalError('请先保存下一步行动，再加入待办');
    if (this.data.todos.length >= 5000) throw new PersonalError('待办已达到 5000 条，请先删除不需要的事项');
    const now = new Date().toISOString();
    const todo: PersonalTodo = { id: randomUUID(), title: todoTitle(current.nextAction), done: false, dueDate, createdAt: now };
    const item: WorkflowItem = { ...current, todoId: todo.id, updatedAt: now };
    // Persist the task and its association together; a write failure leaves
    // both memory and the previous JSON snapshot unchanged.
    this.persist({ ...this.data, todos: [todo, ...this.data.todos], workflowItems: this.data.workflowItems.map(previous => previous.id === id ? item : previous) });
    return structuredClone({ item, todo, created: true });
  }

  vault(query = '') { return listVaultNotes(this.data.settings.vaultPath, query); }
  note(path: unknown) { return readVaultNote(this.data.settings.vaultPath, path); }

  reading() {
    const discovered = discoverReadingReports(this.data.settings, this.data.readingReports);
    const reports = discovered.reports.filter(report => !this.data.readingReports[report.item.id]?.hidden);
    return { items: [...structuredClone(this.data.readingItems), ...reports.map(report => report.item)], sources: discovered.sources, scannedAt: discovered.scannedAt };
  }

  addReading(value: unknown): ReadingItem {
    const body = objectBody(value);
    validateKeys(body, ['title', 'type', 'url', 'notes', 'status', 'coverUrl']);
    if (this.data.readingItems.length >= 5000) throw new PersonalError('书架已达到 5000 项，请先移除不需要的内容');
    const now = new Date().toISOString();
    const item: ReadingItem = { id: `reading:${randomUUID()}`, title: readingTitle(body.title), type: readingType(body.type), url: readingUrl(body.url), notes: readingNotes(body.notes), status: body.status === undefined ? 'unread' : readingStatus(body.status), addedAt: now, updatedAt: now, origin: 'manual' };
    if (item.type !== 'book' && !item.url) throw new PersonalError('这类内容需要填写链接');
    if ('coverUrl' in body) {
      item.coverUrl = readingCoverInput(body.coverUrl, item);
      item.coverCheckedAt = now;
    }
    this.persist({ ...this.data, readingItems: [item, ...this.data.readingItems] });
    return item;
  }

  editReading(id: string, value: unknown): ReadingItem {
    const body = objectBody(value);
    if (id.startsWith('report:')) {
      validateKeys(body, ['status']);
      if (this.data.readingReports[id]?.hidden) throw new PersonalError('阅读内容不存在', 404);
      const report = findReadingReport(this.data.settings, this.data.readingReports, id);
      const status = readingStatus(body.status);
      const saved: ReportReadingState = { status, lastReadVersion: status === 'unread' ? null : report.version };
      this.persist({ ...this.data, readingReports: { ...this.data.readingReports, [id]: saved } });
      return { ...report.item, status, updatedSinceRead: false };
    }
    validateKeys(body, ['title', 'type', 'url', 'notes', 'status', 'coverUrl']);
    const current = this.data.readingItems.find(item => item.id === id);
    if (!current) throw new PersonalError('阅读内容不存在', 404);
    const coverOnly = Object.keys(body).length === 1 && 'coverUrl' in body;
    const item = { ...current, updatedAt: coverOnly ? current.updatedAt : new Date().toISOString() };
    if ('title' in body) item.title = readingTitle(body.title);
    if ('type' in body) item.type = readingType(body.type);
    if ('url' in body) item.url = readingUrl(body.url);
    if ('notes' in body) item.notes = readingNotes(body.notes);
    if ('status' in body) item.status = readingStatus(body.status);
    if (item.type !== 'book' && !item.url) throw new PersonalError('这类内容需要填写链接');
    if (item.type !== current.type || item.url !== current.url) {
      delete item.coverUrl;
      delete item.coverCheckedAt;
    }
    if ('coverUrl' in body) {
      item.coverUrl = readingCoverInput(body.coverUrl, item);
      item.coverCheckedAt = new Date().toISOString();
    }
    this.persist({ ...this.data, readingItems: this.data.readingItems.map(previous => previous.id === id ? item : previous) });
    return item;
  }

  async readingCover(id: string): Promise<ReadingItem> {
    const original = this.data.readingItems.find(item => item.id === id);
    if (!original) throw new PersonalError('阅读内容不存在', 404);
    const bvid = bilibiliVideoId(original);
    if (!bvid) return structuredClone(original);
    const checkedAt = Date.parse(original.coverCheckedAt || '');
    if (Number.isFinite(checkedAt) && Date.now() - checkedAt >= 0 && Date.now() - checkedAt < COVER_CACHE_MS) return structuredClone(original);
    const key = `${id}\0${original.type}\0${original.url}`;
    const pending = this.coverInFlight.get(key);
    if (pending) return pending;
    const request = (async () => {
      const coverUrl = await fetchBilibiliCover(bvid, this.coverFetch);
      const current = this.data.readingItems.find(item => item.id === id);
      if (!current) throw new PersonalError('阅读内容不存在', 404);
      // A delayed result must never restore a removed entry or undo a user's edit.
      if (current.type !== original.type || current.url !== original.url || current.coverCheckedAt !== original.coverCheckedAt) return structuredClone(current);
      const item = { ...current, coverCheckedAt: new Date().toISOString(), ...(coverUrl ? { coverUrl } : {}) };
      this.persist({ ...this.data, readingItems: this.data.readingItems.map(entry => entry.id === id ? item : entry) });
      return structuredClone(item);
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
    const readingReports = { ...this.data.readingReports };
    for (const item of items) {
      if (item.origin === 'report' && selected.has(item.id)) {
        // Keep a tombstone for this report date. Its PDF stays intact and new
        // report dates continue to appear through normal discovery.
        readingReports[item.id] = { ...(readingReports[item.id] || { status: item.status, lastReadVersion: null }), hidden: true };
      }
    }
    this.persist({ ...this.data, readingItems: this.data.readingItems.filter(item => !selected.has(item.id)), readingReports });
    return { removedIds: selectedIds };
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
        result = { status: 'ready', events, updatedAt: new Date().toISOString(), message: settings.calendarFile ? '本机日历快照 · 显示今天起 31 天内的日程。更新 .ics 文件后点击刷新。' : 'iCloud 只读日历 · 显示今天起 31 天内的日程。' };
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
