import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadCalendar, validateCalendarUrl } from './calendar';
import { listVaultNotes, readVaultNote, safeLocalPath, scanDesktopMetadata, verifyCalendarFile, verifyVault } from './files';
import { PersonalError, type CalendarState, type DesktopFile, type PersonalSettings, type PersonalTodo } from './types';

interface SavedData { version: 1; settings: PersonalSettings; todos: PersonalTodo[] }
const DEFAULT_SETTINGS: PersonalSettings = { vaultPath: '', calendarFile: '', calendarUrl: '', animationEnabled: true };
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
  private desktop: { status: 'idle' | 'ready' | 'error'; files: DesktopFile[]; scannedAt: string | null; message: string } = { status: 'idle', files: [], scannedAt: null, message: '点击读取桌面，查看可以加入待办的文件。' };

  constructor(private readonly dataFile: string, readonly desktopPath: string) {
    this.data = { version: 1, settings: { ...DEFAULT_SETTINGS }, todos: [] };
    if (existsSync(dataFile)) {
      const stored: unknown = JSON.parse(readFileSync(dataFile, 'utf8'));
      if (!stored || typeof stored !== 'object' || !('version' in stored) || stored.version !== 1 || !('settings' in stored) || !('todos' in stored) || !Array.isArray(stored.todos)) throw new Error('Personal workbench data is invalid; restore its backup before starting.');
      this.data = stored as SavedData;
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
    return { ...publicFields, calendarConfigured: Boolean(calendarUrl || publicFields.calendarFile), calendarUrlConfigured: Boolean(calendarUrl), desktopPath: this.desktopPath };
  }

  updateSettings(value: unknown) {
    const body = objectBody(value);
    validateKeys(body, ['vaultPath', 'calendarFile', 'calendarUrl', 'animationEnabled']);
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

  desktopState() { return this.desktop; }
  scanDesktop() { this.desktop = scanDesktopMetadata(this.desktopPath); return this.desktop; }
  vault(query = '') { return listVaultNotes(this.data.settings.vaultPath, query); }
  note(path: unknown) { return readVaultNote(this.data.settings.vaultPath, path); }

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
    return { settings: this.settings(), todos: this.todos(), calendar: await this.calendarState(), desktop: this.desktopState(), vault: this.vault(), finance: this.finance() };
  }
}
