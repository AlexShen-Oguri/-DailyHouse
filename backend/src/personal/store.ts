import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { CALENDAR_DAYS, calendarProvider, calendarRange, loadCalendar, validateCalendarUrl } from './calendar';
import { listVaultNotes, readVaultNote, safeLocalPath, verifyCalendarFile, verifyVault } from './files';
import { PersonalError, type CalendarState, type PersonalSettings, type PersonalTodo, type ReadingItem, type ReadingRemovalResult, type ReportReadingState, type ReadingTrashEntry, type ReadingImportBatch, type ReadingImportCandidate, type ReadingImportCounts, type Idea, type IdeaTrashEntry, type ReadingCategory, type ReadingClassification } from './types';
import { discoverReadingReports, findReadingReport, readingNotes, readingStatus, readingTitle, readingType, readingUrl } from './reading';
import { bilibiliVideoId, fetchBilibiliCover, readingCoverInput, COVER_CACHE_MS } from './covers';
import { canonicalReadingSource, classifyReading, parseReadingImport, readingCategory, READING_CATEGORIES } from './reading-import';
import { presentedReadingItem, readingFingerprint, READING_IMPORT_WINDOW_MS, READING_TRASH_MS, validateSavedReading } from './reading-lifecycle';
import { appendIdeaEntry, checkIdeaDeletion, createIdea, fixedIdeaId, ideaSummary, loadIdeas, loadIdeasRemovedIds, loadIdeasTrash, removeIdeaEntry, restoreIdeaSnapshot, updateIdea, updateIdeaEntry, IDEAS_TRASH_MS } from './ideas';
import { ReadingAttachments } from './reading-attachments';
import { parseQuickReading, quickReadingCounts } from './reading-local-import';
import { actionFields, actionRevision, actionTodoSource, createProjectAction, loadProjectActions, projectActionRequest, updateProjectAction, type ActionProject } from './project-actions';
import type { ProjectNextAction } from './types';

interface SavedImportBatch extends ReadingImportBatch { fingerprints: Record<string, string>; revisions: Record<string, number>; undoIds?: { removedIds: string[]; conflictIds: string[]; skippedIds: string[] } }
interface SavedData {
  version: 1; settings: PersonalSettings; todos: PersonalTodo[]; readingItems: ReadingItem[];
  readingWorkflowVersion: 2;
  readingReports: Record<string, ReportReadingState>;
  readingTrash: ReadingTrashEntry[]; readingSuppressions: Record<string, string>;
  readingExpiredIds: Record<string, string>; readingImports: SavedImportBatch[]; readingRevisions: Record<string, number>;
  ideas: Idea[];
  ideasTrash: IdeaTrashEntry[];
  ideasRemovedIds: string[];
  projectTodoLinks?: Record<string, string>;
  projectActions: ProjectNextAction[];
  projectActionRemovedRequests?: string[];
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
  readonly readingAttachments: ReadingAttachments;
  private projectLookup: (id: string) => ActionProject | undefined = () => undefined;
  private projectActionPurges: () => string[] = () => [];

  // The unused second argument keeps existing local fixture scripts compatible.
  constructor(private readonly dataFile: string, _legacyDesktopPath?: string, private readonly readingBaseDir = join(homedir(), 'Documents', 'ChatGPT', '每日汇报，访谈和学习'), private readonly coverFetch: typeof fetch = fetch) {
    this.readingAttachments = new ReadingAttachments(join(dirname(dataFile), 'reading-attachments'));
    const defaults: PersonalSettings = { ...DEFAULT_SETTINGS, readingTechPath: join(readingBaseDir, '每日AI科技早报'), readingAestheticPath: join(readingBaseDir, '每日审美图鉴') };
    this.data = { version: 1, readingWorkflowVersion: 2, settings: defaults, todos: [], readingItems: [], readingReports: {}, readingTrash: [], readingSuppressions: {}, readingExpiredIds: {}, readingImports: [], readingRevisions: {}, ideas: [], ideasTrash: [], ideasRemovedIds: [], projectActions: [] };
    if (existsSync(dataFile)) {
      const stored: unknown = JSON.parse(readFileSync(dataFile, 'utf8'));
      if (!stored || typeof stored !== 'object' || !('version' in stored) || stored.version !== 1 || !('settings' in stored) || !('todos' in stored) || !Array.isArray(stored.todos)) throw new Error('Personal workbench data is invalid; restore its backup before starting.');
      const previous = stored as SavedData;
      validateSavedReading(stored as Record<string, unknown>);
      const ideasTrash = loadIdeasTrash(stored as Record<string, unknown>);
      // Add fields in memory for v1 installations; the next explicit mutation
      // persists them atomically without replacing existing settings or todos.
      this.data = {
        ...previous, settings: { ...defaults, ...previous.settings }, readingItems: previous.readingItems || [],
        readingReports: previous.readingReports || {},
        readingTrash: previous.readingTrash || [], readingSuppressions: previous.readingSuppressions || {},
        readingExpiredIds: previous.readingExpiredIds || {}, readingImports: previous.readingImports || [], readingRevisions: previous.readingRevisions || {},
        ideas: loadIdeas(stored as Record<string, unknown>),
        ideasTrash, ideasRemovedIds: loadIdeasRemovedIds(stored as Record<string, unknown>, ideasTrash),
        projectActions: loadProjectActions(previous.projectActions),
      };
      delete (this.data.settings as PersonalSettings & { desktopPath?: string }).desktopPath;
      if (previous.readingWorkflowVersion !== 2) {
        // Retire the old review ledger once. This is not an import undo: saved
        // items, completed work, notes, recovery snapshots and source tombstones
        // remain intact. Write without unrelated expiration/attachment cleanup.
        const withoutReview = (item: ReadingItem): ReadingItem => {
          if (item.classification?.status !== 'review') return item;
          const { suggestedCategory: _suggestion, ...classification } = item.classification;
          return { ...item, classification: { ...classification, status: 'ready' } };
        };
        this.save({ ...this.data, readingWorkflowVersion: 2, readingImports: [],
          readingItems: this.data.readingItems.map(withoutReview),
          readingTrash: this.data.readingTrash.map(entry => ({ ...entry, item: withoutReview(entry.item) })),
        });
      }
    }
    this.readingAttachments.recoverPurges(new Set([...this.data.readingItems, ...this.data.readingTrash.map(entry => entry.item)].flatMap(item => item.attachment ? [item.attachment.id] : [])));
  }

  private persist(next: SavedData): void {
    // Expiration needs no background service. The next write drops complete
    // snapshots while retaining small IDs and source suppression tombstones.
    const expiredIds = { ...next.readingExpiredIds };
    const now = Date.now();
    next = { ...next, ideasTrash: next.ideasTrash.filter(entry => Date.parse(entry.expiresAt) > now) };
    const readingTrash = next.readingTrash.filter(entry => {
      if (Date.parse(entry.expiresAt) > now) return true;
      expiredIds[entry.item.id] = entry.expiresAt;
      return false;
    });
    next = { ...next, readingTrash, readingExpiredIds: Object.fromEntries(Object.entries(expiredIds).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 10000)) };
    this.save(next);
    // Only unreferenced managed copies are eligible for cleanup. Originals are
    // never touched; live and recoverable items both retain their attachment.
    try { this.readingAttachments.cleanup(new Set([...next.readingItems, ...next.readingTrash.map(entry => entry.item)].flatMap(item => item.attachment ? [item.attachment.id] : []))); } catch { /* A locked orphan can be retried on the next write. */ }
  }

  private save(next: SavedData): void {
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

  todos(): PersonalTodo[] {
    this.pruneProjectActions();
    const todos = structuredClone(this.data.todos);
    const items = new Map(todos.some(todo => todo.source?.kind === 'reading') ? this.reading().items.map(item => [item.id, item]) : []);
    return todos.map(todo => {
      if (todo.source?.kind === 'project_action') {
        const action = this.data.projectActions.find(item => item.id === todo.source!.id && item.projectId === (todo.source as { projectId: string }).projectId);
        return { ...todo, source: action ? actionTodoSource(action, Boolean(this.projectLookup(action.projectId))) : { ...todo.source, available: false, linked: false } };
      }
      if (todo.source?.kind !== 'reading') return todo;
      const item = items.get(todo.source.id);
      return { ...todo, source: { ...todo.source, ...(item ? { title: item.title, type: item.type, url: item.url } : {}), available: Boolean(item) } };
    });
  }

  addReadingTodo(id: string, value: unknown = {}): { todo: PersonalTodo; todoId: string; created: boolean } {
    const body = objectBody(value);
    validateKeys(body, ['title', 'dueDate']);
    // Validate even on retries, without changing the existing task's choices.
    const title = 'title' in body ? todoTitle(body.title) : undefined;
    const dueDate = todoDate(body.dueDate);
    const item = this.reading().items.find(candidate => candidate.id === id);
    if (!item) throw new PersonalError('书架条目不存在或已移除', 404);
    const existing = this.data.todos.find(todo => todo.source?.kind === 'reading' && todo.source.id === id);
    if (existing) return { todo: this.todos().find(todo => todo.id === existing.id)!, todoId: existing.id, created: false };
    if (this.data.todos.length >= 5000) throw new PersonalError('待办已达到 5000 条，请先删除不需要的事项');
    const todo: PersonalTodo = {
      id: randomUUID(), title: title ?? todoTitle(item.title.slice(0, 200)), done: false,
      createdAt: new Date().toISOString(), dueDate,
      source: { kind: 'reading', id: item.id, title: item.title, type: item.type, url: item.url },
    };
    // A single atomic write links the task. Its deletion removes that link and
    // permits a later explicit add; no shelf status or import metadata changes.
    this.persist({ ...this.data, todos: [todo, ...this.data.todos] });
    return { todo: { ...structuredClone(todo), source: { ...todo.source!, available: true } }, todoId: todo.id, created: true };
  }

  addProjectTodo(key: string, title: string): { todo?: PersonalTodo; todoId: string; deleted: boolean; created: boolean } {
    if (typeof key !== 'string' || !key.trim() || key.length > 200) throw new PersonalError('项目关联标识无效');
    const links = this.data.projectTodoLinks || {};
    const linkedId = Object.hasOwn(links, key) ? links[key] : undefined;
    if (linkedId) {
      const existing = this.data.todos.find(todo => todo.id === linkedId);
      return { ...(existing ? { todo: structuredClone(existing) } : {}), todoId: linkedId, deleted: !existing, created: false };
    }
    if (this.data.todos.length >= 5000) throw new PersonalError('待办已达到 5000 条，请先删除不需要的事项');
    const todo: PersonalTodo = { id: randomUUID(), title: todoTitle(title), done: false, createdAt: new Date().toISOString(), dueDate: null };
    this.persist({ ...this.data, todos: [...this.data.todos, todo], projectTodoLinks: { ...links, [key]: todo.id } });
    return { todo: structuredClone(todo), todoId: todo.id, deleted: false, created: true };
  }

  addTodo(value: unknown): PersonalTodo {
    const body = objectBody(value);
    validateKeys(body, ['title', 'dueDate']);
    if (this.data.todos.length >= 5000) throw new PersonalError('待办已达到 5000 条，请先删除不需要的事项');
    const todo: PersonalTodo = { id: randomUUID(), title: todoTitle(body.title), done: false, createdAt: new Date().toISOString(), dueDate: todoDate(body.dueDate) };
    this.persist({ ...this.data, todos: [todo, ...this.data.todos] });
    return todo;
  }

  editTodo(id: string, value: unknown): PersonalTodo {
    this.pruneProjectActions();
    const body = objectBody(value);
    validateKeys(body, ['title', 'done', 'dueDate', 'result', 'actionRevision']);
    const current = this.data.todos.find(todo => todo.id === id);
    if (!current) throw new PersonalError('待办不存在', 404);
    const todo = { ...current };
    if ('title' in body) todo.title = todoTitle(body.title);
    if ('done' in body) {
      if (typeof body.done !== 'boolean') throw new PersonalError('完成状态无效');
      todo.done = body.done;
    }
    if ('dueDate' in body) todo.dueDate = todoDate(body.dueDate);
    const action = current.source?.kind === 'project_action' ? this.data.projectActions.find(item => item.id === current.source!.id && item.projectId === (current.source as { projectId: string }).projectId) : undefined;
    if (action) {
      const project = this.projectLookup(action.projectId) || { id: action.projectId, title: action.projectTitle, threads: action.thread ? [action.thread] : [] };
      const patch: Record<string, unknown> = { revision: body.actionRevision };
      if ('title' in body) patch.title = todo.title;
      if ('dueDate' in body) patch.dueDate = todo.dueDate;
      if ('result' in body) patch.result = body.result;
      if ('done' in body && todo.done !== (action.status === 'done')) patch.status = todo.done ? 'done' : 'active';
      const next = updateProjectAction(action, patch, project);
      this.saveProjectAction(next);
      return this.todos().find(item => item.id === id)!;
    }
    if ('result' in body || 'actionRevision' in body) throw new PersonalError('这个待办已不再关联下一步行动，请刷新后重试', 409);
    this.persist({ ...this.data, todos: this.data.todos.map(item => item.id === id ? todo : item) });
    return this.todos().find(item => item.id === id)!;
  }

  deleteTodo(id: string): void {
    this.pruneProjectActions();
    if (!this.data.todos.some(todo => todo.id === id)) throw new PersonalError('待办不存在', 404);
    this.persist({ ...this.data, todos: this.data.todos.filter(todo => todo.id !== id), projectActions: this.data.projectActions.map(action => {
      if (action.todoId !== id) return action;
      const next = { ...action, revision: action.revision + 1, updatedAt: new Date().toISOString() }; delete next.todoId; return next;
    }) });
  }

  configureProjectActions(lookup: (id: string) => ActionProject | undefined, purged: () => string[] = () => []): void {
    this.projectLookup = lookup; this.projectActionPurges = purged; this.pruneProjectActions();
  }

  pruneProjectActions(): void {
    const purged = new Set(this.projectActionPurges());
    const removed = this.data.projectActions.filter(action => purged.has(action.projectId));
    if (!removed.length) return;
    this.persist({ ...this.data, projectActions: this.data.projectActions.filter(action => !purged.has(action.projectId)),
      projectActionRemovedRequests: [...new Set([...(this.data.projectActionRemovedRequests || []), ...removed.flatMap(action => action.requestId ? [`${action.projectId}:${action.requestId}`] : [])])],
    });
  }

  private requireActionProject(id: string): ActionProject {
    this.pruneProjectActions();
    const project = this.projectLookup(id);
    if (!project) throw new PersonalError('项目不存在或已从小院移除，请刷新项目列表', 404);
    return project;
  }

  private requireProjectAction(projectId: string, id: string): ProjectNextAction {
    const action = this.data.projectActions.find(item => item.id === id && item.projectId === projectId);
    if (!action) throw new PersonalError('下一步行动不存在或已删除', 404);
    return action;
  }

  projectActions(projectId: string): { items: ProjectNextAction[] } {
    this.requireActionProject(projectId);
    return { items: structuredClone(this.data.projectActions.filter(item => item.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))) };
  }

  addProjectAction(projectId: string, value: unknown): { action: ProjectNextAction; created: boolean } {
    const project = this.requireActionProject(projectId);
    const request = projectActionRequest(value);
    if (request.requestId) {
      const existing = this.data.projectActions.find(item => item.projectId === projectId && item.requestId === request.requestId);
      if (existing) {
        if (existing.requestFingerprint !== request.requestFingerprint) throw new PersonalError('这个创建请求已经保存过不同内容，请刷新后编辑原行动', 409);
        return { action: structuredClone(existing), created: false };
      }
      if (this.data.projectActionRemovedRequests?.includes(`${projectId}:${request.requestId}`)) throw new PersonalError('这个行动请求曾被删除，请重新创建行动', 409);
    }
    const action = createProjectAction(project, value);
    if (this.data.projectActions.length >= 5000) throw new PersonalError('下一步行动已达到 5000 条，请先删除不需要的记录');
    this.persist({ ...this.data, projectActions: [action, ...this.data.projectActions] });
    return { action: structuredClone(action), created: true };
  }

  private saveProjectAction(action: ProjectNextAction): ProjectNextAction {
    const source = actionTodoSource(action, Boolean(this.projectLookup(action.projectId)));
    this.persist({ ...this.data,
      projectActions: this.data.projectActions.map(item => item.id === action.id ? action : item),
      todos: this.data.todos.map(todo => todo.source?.kind === 'project_action' && todo.source.id === action.id && todo.source.projectId === action.projectId ? { ...todo, title: action.title, dueDate: action.dueDate, done: action.status === 'done', source } : todo),
    });
    return structuredClone(action);
  }

  editProjectAction(projectId: string, id: string, value: unknown): ProjectNextAction {
    const project = this.requireActionProject(projectId);
    return this.saveProjectAction(updateProjectAction(this.requireProjectAction(projectId, id), value, project));
  }

  deleteProjectAction(projectId: string, id: string, value: unknown): void {
    this.requireActionProject(projectId);
    const body = actionFields(value, ['confirm', 'revision']);
    if (body.confirm !== true) throw new PersonalError('请确认删除下一步行动；关联待办与外部项目都会保留');
    const action = this.requireProjectAction(projectId, id);
    actionRevision(body.revision, action);
    this.persist({ ...this.data, projectActions: this.data.projectActions.filter(item => item.id !== id),
      projectActionRemovedRequests: action.requestId ? [...this.data.projectActionRemovedRequests || [], `${projectId}:${action.requestId}`] : this.data.projectActionRemovedRequests,
    });
  }

  deleteProjectActionCompletion(projectId: string, id: string, completionId: string, value: unknown): ProjectNextAction {
    this.requireActionProject(projectId);
    const body = actionFields(value, ['confirm', 'revision']);
    if (body.confirm !== true) throw new PersonalError('请确认删除这条完成结果；行动、其他结果和待办都会保留');
    const action = this.requireProjectAction(projectId, id);
    actionRevision(body.revision, action);
    if (!action.completions.some(entry => entry.id === completionId)) throw new PersonalError('这条完成结果不存在或已删除', 404);
    const next = { ...action, completions: action.completions.filter(entry => entry.id !== completionId), revision: action.revision + 1, updatedAt: new Date().toISOString() };
    if (action.currentResultId === completionId) { next.result = ''; delete next.currentResultId; }
    return this.saveProjectAction(next);
  }

  addProjectActionTodo(projectId: string, id: string, value: unknown): { todo: PersonalTodo; todoId: string; created: boolean } {
    this.requireActionProject(projectId);
    actionFields(value, []);
    const action = this.requireProjectAction(projectId, id);
    const existing = this.data.todos.find(todo => todo.source?.kind === 'project_action' && todo.source.id === id && todo.source.projectId === projectId);
    if (existing) return { todo: this.todos().find(todo => todo.id === existing.id)!, todoId: existing.id, created: false };
    if (this.data.todos.length >= 5000) throw new PersonalError('待办已达到 5000 条，请先删除不需要的事项');
    const now = new Date().toISOString();
    const next = { ...action, todoId: randomUUID(), revision: action.revision + 1, updatedAt: now };
    const todo: PersonalTodo = { id: next.todoId, title: next.title, dueDate: next.dueDate, done: next.status === 'done', createdAt: now, source: actionTodoSource(next, true) };
    this.persist({ ...this.data, projectActions: this.data.projectActions.map(item => item.id === id ? next : item), todos: [todo, ...this.data.todos] });
    return { todo: structuredClone(todo), todoId: todo.id, created: true };
  }

  ideas() {
    return { items: this.data.ideas.map(ideaSummary).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id)) };
  }

  idea(id: string): Idea {
    const idea = this.data.ideas.find(item => item.id === id);
    if (!idea) throw new PersonalError('这个想法不存在', 404);
    return structuredClone(idea);
  }

  private saveIdea(idea: Idea): Idea {
    this.persist({ ...this.data, ideas: this.data.ideas.map(item => item.id === idea.id ? idea : item) });
    return structuredClone(idea);
  }

  addIdea(value: unknown): Idea {
    const idea = createIdea(value, this.data.ideas.length);
    this.persist({ ...this.data, ideas: [...this.data.ideas, idea] });
    return structuredClone(idea);
  }

  // Used only by local extensions coordinating metadata with this shared store.
  // Public creation routes never accept a caller-supplied ID.
  addIdeaWithId(id: string, value: unknown): Idea {
    id = fixedIdeaId(id);
    const existing = this.data.ideas.find(idea => idea.id === id);
    if (existing) return structuredClone(existing);
    if (this.data.ideasRemovedIds.includes(id) || this.data.ideasTrash.some(entry => entry.idea.id === id)) throw new PersonalError('这个想法曾被删除，请从回收站恢复或新建其他想法', 409);
    const idea = createIdea(value, this.data.ideas.length, id);
    this.persist({ ...this.data, ideas: [...this.data.ideas, idea] });
    return structuredClone(idea);
  }

  editIdea(id: string, value: unknown): Idea { return this.saveIdea(updateIdea(this.idea(id), value)); }

  deleteIdea(id: string, value: unknown): void {
    const idea = this.idea(id);
    checkIdeaDeletion(idea, value);
    const now = Date.now();
    const entry: IdeaTrashEntry = { idea, deletedAt: new Date(now).toISOString(), expiresAt: new Date(now + IDEAS_TRASH_MS).toISOString() };
    this.persist({ ...this.data, ideas: this.data.ideas.filter(item => item.id !== id), ideasTrash: [...this.data.ideasTrash.filter(item => item.idea.id !== id), entry], ideasRemovedIds: [...new Set([...this.data.ideasRemovedIds, id])] });
  }

  ideasTrash() {
    return { items: this.data.ideasTrash.filter(entry => Date.parse(entry.expiresAt) > Date.now())
      .map(entry => ({ ...ideaSummary(entry.idea), deletedAt: entry.deletedAt, expiresAt: entry.expiresAt }))
      .sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt) || a.id.localeCompare(b.id)) };
  }

  restoreIdea(id: string, value: unknown): Idea {
    if (this.data.ideas.some(idea => idea.id === id)) throw new PersonalError('这个想法已经存在，无法重复恢复', 409);
    const entry = this.data.ideasTrash.find(item => item.idea.id === id);
    if (!entry) throw new PersonalError('回收站中的想法不存在或已过期', 404);
    const idea = restoreIdeaSnapshot(entry, value, this.data.ideas.length);
    this.persist({ ...this.data, ideas: [...this.data.ideas, idea], ideasTrash: this.data.ideasTrash.filter(item => item.idea.id !== id) });
    return structuredClone(idea);
  }

  addIdeaEntry(id: string, value: unknown): Idea { return this.saveIdea(appendIdeaEntry(this.idea(id), value)); }
  purgeIdea(id: string, value: unknown): void {
    const body = objectBody(value);
    validateKeys(body, ['deletedAt']);
    if (typeof body.deletedAt !== 'string' || !Number.isFinite(Date.parse(body.deletedAt))) throw new PersonalError('请提供回收站记录的删除时间');
    const entry = this.data.ideasTrash.find(item => item.idea.id === id);
    if (!entry) throw new PersonalError('回收站中的想法不存在或已过期', 404);
    if (entry.deletedAt !== body.deletedAt) throw new PersonalError('回收站记录已变更，请刷新后重试', 409);
    this.persist({ ...this.data, ideasTrash: this.data.ideasTrash.filter(item => item.idea.id !== id), ideasRemovedIds: [...new Set([...this.data.ideasRemovedIds, id])] });
  }
  editIdeaEntry(id: string, entryId: string, value: unknown): Idea { return this.saveIdea(updateIdeaEntry(this.idea(id), entryId, value)); }
  deleteIdeaEntry(id: string, entryId: string, value: unknown): Idea { return this.saveIdea(removeIdeaEntry(this.idea(id), entryId, value)); }

  vault(query = '') { return listVaultNotes(this.data.settings.vaultPath, query); }
  note(path: unknown) { return readVaultNote(this.data.settings.vaultPath, path); }

  reading() {
    const discovered = discoverReadingReports(this.data.settings, this.data.readingReports);
    const reports = discovered.reports.filter(report => !this.data.readingReports[report.item.id]?.hidden);
    return { items: [...structuredClone(this.data.readingItems).map(presentedReadingItem), ...reports.map(report => report.item)], sources: discovered.sources, scannedAt: discovered.scannedAt, trashCount: this.readingTrash().items.length };
  }

  addReading(value: unknown): ReadingItem {
    const body = objectBody(value);
    validateKeys(body, ['title', 'type', 'url', 'notes', 'status', 'coverUrl', 'category']);
    if (this.data.readingItems.length >= 5000) throw new PersonalError('书架已达到 5000 项，请先移除不需要的内容');
    const now = new Date().toISOString();
    const item: ReadingItem = { id: `reading:${randomUUID()}`, title: readingTitle(body.title), type: readingType(body.type), url: readingUrl(body.url), notes: readingNotes(body.notes), status: body.status === undefined ? 'unread' : readingStatus(body.status), category: readingCategory(body.category), addedAt: now, updatedAt: now, origin: 'manual' };
    item.classification = { status: body.category === undefined ? 'pending' : 'manual' };
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
      if (item.attachment && item.url) throw new PersonalError('本机文件条目不能改成链接，请另行导入');
      if (item.url) item.sourceKey = canonicalReadingSource(item.url); else delete item.sourceKey;
      if (item.attachment) item.sourceKey = `file:${item.attachment.id.split('.')[0]}`;
      if (item.sourceKey && item.sourceKey !== (current.url ? canonicalReadingSource(current.url) : '') && this.data.readingItems.some(previous => previous.id !== id && previous.url && canonicalReadingSource(previous.url) === item.sourceKey)) throw new PersonalError('书架中已有相同来源，请打开原条目', 409);
    }
    if (item.type !== 'book' && !item.url && !item.attachment) throw new PersonalError('这类内容需要填写链接或选择本机文件');
    if ('category' in body) item.classification = { status: 'manual' };
    else if (!coverOnly && current.classification?.status === 'pending') item.classification = { status: 'failed', message: '内容已修改，请重新运行本机分类。' };
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
      } else if (item.sourceKey || item.url) {
        readingSuppressions[item.sourceKey || canonicalReadingSource(item.url)] = now;
      }
      entries.push(entry);
    }
    return { ...this.data, readingItems: this.data.readingItems.filter(item => !selected.has(item.id)), readingReports, readingSuppressions, readingTrash: [...entries, ...this.data.readingTrash.filter(entry => !selected.has(entry.item.id))] };
  }

  readingTrash() {
    return { items: structuredClone(this.data.readingTrash.filter(entry => Date.parse(entry.expiresAt) > Date.now())).map(entry => ({ ...entry, item: presentedReadingItem(entry.item), expired: false })) };
  }

  purgeReading(id: string, value: unknown) {
    const body = objectBody(value);
    validateKeys(body, ['deletedAt']);
    if (typeof body.deletedAt !== 'string' || !Number.isFinite(Date.parse(body.deletedAt))) throw new PersonalError('请提供回收站记录的删除时间');
    const entry = this.data.readingTrash.find(item => item.item.id === id);
    if (!entry) throw new PersonalError('回收站内容不存在，请刷新后重试', 404);
    if (entry.deletedAt !== body.deletedAt) throw new PersonalError('回收站记录已变更，请刷新后重试', 409);
    const readingTrash = this.data.readingTrash.filter(item => item.item.id !== id);
    const attachment = entry.item.attachment;
    // Keep source suppression and the import audit so a scheduled import or
    // an old undo operation cannot silently bring back a purged item.
    const commit = () => this.persist({ ...this.data, readingTrash, readingExpiredIds: { ...this.data.readingExpiredIds, [id]: new Date().toISOString() } });
    const uniqueCopy = attachment && ![...this.data.readingItems, ...readingTrash.map(item => item.item)].some(item => item.attachment?.id === attachment.id);
    const cleanupPending = uniqueCopy ? this.readingAttachments.purgeManagedCopy(attachment, commit) : (commit(), false);
    return { deletedId: id, ...(cleanupPending ? { cleanupPending: true } : {}) };
  }

  restoreReading(value: unknown) {
    const body = objectBody(value);
    validateKeys(body, ['ids']);
    if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 10000 || body.ids.some(id => typeof id !== 'string' || !id || id.length > 128)) throw new PersonalError('请选择要恢复的阅读内容');
    const ids = [...new Set(body.ids as string[])];
    const currentItems = this.reading().items;
    const currentIds = new Set(currentItems.map(item => item.id));
    const sourceKeys = new Set(currentItems.map(item => item.sourceKey || (item.url ? canonicalReadingSource(item.url) : '')).filter(Boolean));
    const entries = ids.map(id => {
      const entry = this.data.readingTrash.find(candidate => candidate.item.id === id);
      if (this.data.readingExpiredIds[id] || (entry && Date.parse(entry.expiresAt) <= Date.now())) throw new PersonalError('这项内容已超过 30 天恢复期限', 410);
      if (!entry) throw new PersonalError('回收站内容不存在，请刷新后重试', 404);
      const sourceKey = entry.item.sourceKey || (entry.item.url ? canonicalReadingSource(entry.item.url) : '');
      if (currentIds.has(id) || (sourceKey && sourceKeys.has(sourceKey))) throw new PersonalError('书架中已有相同来源，无法重复恢复', 409);
      if (sourceKey) sourceKeys.add(sourceKey);
      if (entry.item.origin === 'report') findReadingReport(this.data.settings, this.data.readingReports, id);
      if (entry.item.attachment) this.readingAttachments.path(entry.item.attachment);
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
      if (item.sourceKey || item.url) delete readingSuppressions[item.sourceKey || canonicalReadingSource(item.url)];
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

  readingImports(): { items: ReadingImportBatch[] } { return { items: [] }; }

  curatedReadingCandidates(value: unknown) {
    const body = objectBody(value);
    validateKeys(body, ['items', 'coverage']);
    const payload = parseReadingImport(body);
    if (payload.items.some(item => !item.sourceKey.startsWith('bilibili:'))) throw new PersonalError('此入口只接收 B 站视频历史');
    const now = Date.now();
    const latest = new Map<string, number>();
    payload.items.forEach((item, index) => {
      const previousIndex = latest.get(item.sourceKey);
      if (previousIndex === undefined) { latest.set(item.sourceKey, index); return; }
      const previous = payload.items[previousIndex];
      const newer = Date.parse(item.viewedAt) - Date.parse(previous.viewedAt);
      if (newer > 0 || (newer === 0 && (item.progress ?? 2) > (previous.progress ?? 2))) latest.set(item.sourceKey, index);
    });
    const existing = new Set(this.data.readingItems.filter(item => item.url).map(item => canonicalReadingSource(item.url)));
    const items = payload.items.filter((item, index) => {
      const viewed = Date.parse(item.viewedAt);
      return latest.get(item.sourceKey) === index && !existing.has(item.sourceKey) && !this.data.readingSuppressions[item.sourceKey]
        && viewed >= now - READING_IMPORT_WINDOW_MS && viewed <= now && item.progress !== null && item.progress < 0.25;
    });
    return { items, skipped: payload.items.length - items.length, ...(payload.coverage ? { coverage: payload.coverage } : {}) };
  }

  importCuratedReading(value: unknown) {
    const body = objectBody(value);
    validateKeys(body, ['items', 'coverage']);
    if (!Array.isArray(body.items) || body.items.length > 1000) throw new PersonalError('导入 items 应为最多 1000 条的数组');
    // Validate the whole response before saving anything. Codex chooses content
    // and its category; it cannot override progress, duplicate or removal rules.
    const categories: ReadingCategory[] = [];
    const evidence = body.items.map(value => {
      const item = objectBody(value);
      validateKeys(item, ['title', 'url', 'notes', 'coverUrl', 'viewedAt', 'progress', 'category']);
      if (typeof item.category !== 'string' || !READING_CATEGORIES.includes(item.category as ReadingCategory)) throw new PersonalError('请选择有效的阅读分类');
      const { category, ...record } = item;
      categories.push(category as ReadingCategory);
      return record;
    });
    const parsed = parseReadingImport({ items: evidence, ...(body.coverage === undefined ? {} : { coverage: body.coverage }) });
    // Canonicalization may normalize URLs/timestamps, so keep categories aligned
    // with their original evidence before filtering the latest source record.
    const categoryByEvidence = new Map<string, ReadingCategory>();
    parsed.items.forEach((item, index) => {
      const key = JSON.stringify([item.sourceKey, item.viewedAt, item.progress, item.title]);
      if (!categoryByEvidence.has(key)) categoryByEvidence.set(key, categories[index]);
    });
    const eligible = this.curatedReadingCandidates({ items: evidence, ...(body.coverage === undefined ? {} : { coverage: body.coverage }) });
    if (this.data.readingItems.length + eligible.items.length > 5000) throw new PersonalError('书架已达到 5000 项，请先移除不需要的内容');
    const now = new Date().toISOString();
    const items: ReadingItem[] = eligible.items.map(candidate => ({
      id: `reading:${randomUUID()}`, title: candidate.title, type: 'video', url: candidate.url,
      notes: candidate.notes, status: 'unread', category: categoryByEvidence.get(JSON.stringify([candidate.sourceKey, candidate.viewedAt, candidate.progress, candidate.title]))!,
      sourceKey: candidate.sourceKey, addedAt: now, updatedAt: now, origin: 'manual', classification: { status: 'ready', model: 'Codex' },
      ...(candidate.coverUrl ? { coverUrl: candidate.coverUrl, coverCheckedAt: now } : {}),
    }));
    if (items.length) this.persist({ ...this.data, readingItems: [...items, ...this.data.readingItems] });
    return { items: structuredClone(items), skipped: eligible.skipped };
  }

  previewQuickReadingImport(value: unknown) {
    const candidates = parseQuickReading(value, this.readingAttachments);
    const existing = new Set(this.data.readingItems.map(item => item.sourceKey || (item.url ? canonicalReadingSource(item.url) : '')).filter(Boolean));
    for (const candidate of candidates) {
      if (candidate.sourceKey && existing.has(candidate.sourceKey)) { candidate.decision = 'duplicate'; candidate.reason = '同一来源已经在书架或本次导入中，保留现有条目。'; }
      else if (candidate.sourceKey && this.data.readingSuppressions[candidate.sourceKey]) { candidate.decision = 'suppressed'; candidate.reason = '这个来源曾被移除，请从回收站恢复。'; }
      else if (candidate.sourceKey) existing.add(candidate.sourceKey);
      if (candidate.manualCategory && candidate.decision === 'import') candidate.reason = '确认后加入书架，保留你选择的分类。';
    }
    return { candidates, counts: quickReadingCounts(candidates) };
  }

  importQuickReading(value: unknown) {
    const preview = this.previewQuickReadingImport(value);
    const accepted = preview.candidates.filter(candidate => candidate.decision === 'import');
    if (this.data.readingItems.length + accepted.length > 5000) throw new PersonalError('书架已达到 5000 项，请先移除不需要的内容');
    const now = new Date().toISOString(); const id = `import:${randomUUID()}`;
    const items: ReadingItem[] = accepted.map(candidate => ({
      id: `reading:${randomUUID()}`, title: candidate.title, type: candidate.type, url: candidate.url,
      notes: candidate.notes, status: 'unread', category: candidate.category, ...(candidate.sourceKey ? { sourceKey: candidate.sourceKey } : {}),
      addedAt: now, updatedAt: now, origin: 'manual',
      classification: { status: candidate.manualCategory ? 'manual' : 'pending' },
      ...(candidate.uploadId ? { attachment: this.readingAttachments.commit(candidate.uploadId) } : {}),
    }));
    const batch: SavedImportBatch = {
      id, source: 'quick', createdAt: now, counts: preview.counts, addedCount: items.length,
      duplicateCount: preview.counts.duplicates, suppressedCount: preview.counts.suppressed, excludedCount: 0, reviewCount: 0,
      itemIds: items.map(item => item.id), candidates: preview.candidates.map(candidate => ({
        index: candidate.index, title: candidate.title, url: candidate.url, notes: '', viewedAt: now, progress: null,
        sourceKey: candidate.sourceKey, category: candidate.category, reason: candidate.reason, decision: candidate.decision,
      })), canUndo: false,
      fingerprints: Object.fromEntries(items.map(item => [item.id, readingFingerprint(item)])),
      revisions: Object.fromEntries(items.map(item => [item.id, 0])),
    };
    if (items.length) this.persist({ ...this.data, readingItems: [...items, ...this.data.readingItems] });
    // Staged files are removed only after the shelf's atomic save succeeds.
    for (const candidate of accepted) if (candidate.uploadId) { try { this.readingAttachments.removeUpload(candidate.uploadId); } catch { /* Expire this temporary copy later. */ } }
    return { batch: { ...this.presentedImportBatch(batch), canUndo: false }, items: items.map(presentedReadingItem), candidates: preview.candidates, counts: preview.counts };
  }

  pendingReadingClassifications(ids?: string[]) {
    const wanted = ids ? new Set(ids) : undefined;
    return this.data.readingItems.filter(item => item.classification?.status === 'pending' && (!wanted || wanted.has(item.id))).map(item => ({
      input: { id: item.id, title: item.title, type: item.type, url: item.url, notes: item.notes, ...(item.attachment?.excerpt ? { excerpt: item.attachment.excerpt } : {}) },
      revision: this.data.readingRevisions[item.id] || 0,
    }));
  }

  startReadingClassification(id: string) {
    const current = this.data.readingItems.find(item => item.id === id);
    if (!current) throw new PersonalError('阅读内容不存在', 404);
    const oldRevision = this.data.readingRevisions[id] || 0;
    const revision = oldRevision + 1;
    const item: ReadingItem = { ...current, classification: { status: 'pending' } };
    const readingImports = this.data.readingImports.map(batch => batch.fingerprints[id] === readingFingerprint(current) && batch.revisions[id] === oldRevision ? { ...batch, revisions: { ...batch.revisions, [id]: revision } } : batch);
    this.persist({ ...this.data, readingItems: this.data.readingItems.map(value => value.id === id ? item : value), readingRevisions: { ...this.data.readingRevisions, [id]: revision }, readingImports });
    return this.pendingReadingClassifications([id])[0];
  }

  applyReadingClassification(id: string, revision: number, result: { category?: ReadingCategory; reason?: string; model?: string; confidence?: 'high' | 'medium' | 'low'; needsReview?: boolean; error?: string }): ReadingItem | null {
    const current = this.data.readingItems.find(item => item.id === id);
    if (!current || current.classification?.status !== 'pending' || (this.data.readingRevisions[id] || 0) !== revision) return null;
    const classification: ReadingClassification = result.error ? { status: 'failed', message: result.error.slice(0, 240) } : {
      status: 'ready', ...(result.model ? { model: result.model.slice(0, 200) } : {}),
      ...(result.reason ? { reason: result.reason.slice(0, 240) } : {}), ...(result.confidence ? { confidence: result.confidence } : {}),
    };
    const item: ReadingItem = { ...current, classification,
      ...(!result.error && !result.needsReview && result.category ? { category: readingCategory(result.category) } : {}) };
    // Automatic enrichment advances an unchanged import baseline. Any prior
    // user edit still has a different revision/fingerprint and remains protected.
    const readingImports = this.data.readingImports.map(batch => batch.fingerprints[id] === readingFingerprint(current) && batch.revisions[id] === revision ? { ...batch, fingerprints: { ...batch.fingerprints, [id]: readingFingerprint(item) } } : batch);
    this.persist({ ...this.data, readingItems: this.data.readingItems.map(value => value.id === id ? item : value), readingImports });
    return presentedReadingItem(structuredClone(item));
  }

  readingAttachment(id: string) {
    const item = this.data.readingItems.find(value => value.id === id);
    if (!item?.attachment) throw new PersonalError('附件不存在或已移入回收站', 404);
    return { attachment: structuredClone(item.attachment), path: this.readingAttachments.path(item.attachment) };
  }

  importReading(_value: unknown): never {
    throw new PersonalError('旧导入流程已停用，请使用书架的一键读取。', 410);
  }

  undoReadingImport(_id: string): never {
    throw new PersonalError('旧导入记录已清除；书架内容可直接移除，并从回收站恢复。', 410);
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

  async state() {
    return { settings: this.settings(), todos: this.todos(), calendar: await this.calendarState(), vault: this.vault() };
  }
}
