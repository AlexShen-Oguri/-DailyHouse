import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PersonalStore } from './store';
import { parseReadingImport, type ReadingImportCandidate } from './reading-import';
import { readingCategory } from './reading-categories';
import { CodexReadingError } from './codex-reading-client';
import { PersonalError, type ReadingCategory } from './types';
export const READING_EXTENSION_ID = 'nfgkhikgfkidmpngfifhfgpfifnnbnfc';
export type CollectionStatus = 'queued' | 'reading' | 'importing' | 'completed' | 'partial' | 'needs_login' | 'failed' | 'cancelled';
export type CollectionIssue = 'needs_login' | 'page_unavailable' | 'unsupported_page' | 'read_failed' | 'bridge_disconnected' | 'timeout' | 'server_restarted' | 'import_failed' | 'codex_failed' | 'codex_busy';
type Coverage = { from: string; to: string; complete: boolean };
export interface CollectionRun {
  id: string; status: CollectionStatus; createdAt: string; updatedAt: string; scanned: number;
  coverage?: Coverage; result?: { added: number; skipped: number; itemIds: string[] };
  threadId?: string; conversationUrl?: string; issue?: CollectionIssue;
  failure?: { code: CodexReadingError['code']; reason?: string };
}
export interface CollectionSelector {
  select(candidates: ReadingImportCandidate[], options: { runId: string; coverage: Coverage; signal?: AbortSignal; onThread?: (thread: { id: string; url: string }) => void | Promise<void> }): Promise<{ selected: { index: number; category: ReadingCategory }[] }>;
}
interface CollectionOptions { now?: () => number; selector?: CollectionSelector; extensionPath?: string }
type DailyAttempt = { date: string; runId: string };
const newYorkClock = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
function dailyTime(now: number) {
  const parts = Object.fromEntries(newYorkClock.formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, due: Number(parts.hour) >= 10 };
}
const previousDate = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
const ACTIVE = new Set<CollectionStatus>(['queued', 'reading', 'importing']);
const READ_FAILURES = new Set<CollectionIssue>(['needs_login', 'page_unavailable', 'unsupported_page', 'read_failed']);
const TOTAL_TIMEOUT = 30 * 60000, LEASE_TIMEOUT = 2 * 60000, CONNECTED_TIMEOUT = 90000, WINDOW = 7 * 86400000;
function fields(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new PersonalError('采集请求包含无效字段');
  return value as Record<string, unknown>;
}
function count(value: unknown, minimum = 0) {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > 20000) throw new PersonalError('采集条目数量无效');
  return value as number;
}
function evidence(item: ReadingImportCandidate) {
  return { title: item.title, url: item.url, notes: item.notes, viewedAt: item.viewedAt, progress: item.progress, ...(item.coverUrl ? { coverUrl: item.coverUrl } : {}) };
}
/** Browser evidence is organized in a separate Codex conversation. Only five summaries survive. */
export class ReadingCollectionService {
  private runs: CollectionRun[] = [];
  private dailyAttempt?: DailyAttempt;
  private token?: string; private lastSeenAt?: number; private leaseAt?: number;
  private controller?: AbortController;
  private pending: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  readonly extensionPath: string;
  constructor(private readonly file: string, private readonly store: Pick<PersonalStore, 'curatedReadingCandidates' | 'importCuratedReading'>, private readonly options: CollectionOptions = {}) {
    this.now = options.now ?? Date.now; this.extensionPath = options.extensionPath ?? '';
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (saved.version === 1) { this.save(); return; }
      if (saved.version !== 2 || !Array.isArray(saved.runs) || saved.runs.some((run: CollectionRun) => !run || typeof run.id !== 'string' || !['queued', 'reading', 'importing', 'completed', 'partial', 'needs_login', 'failed', 'cancelled'].includes(run.status))) throw new Error('Reading collection status is invalid. Preserve the file before retrying.');
      this.runs = saved.runs.slice(0, 5);
      if (saved.dailyAttempt !== undefined) {
        if (!saved.dailyAttempt || !/^\d{4}-\d{2}-\d{2}$/.test(saved.dailyAttempt.date) || typeof saved.dailyAttempt.runId !== 'string' || !saved.dailyAttempt.runId) throw new Error('Daily collection status is invalid. Preserve the file before retrying.');
        this.dailyAttempt = { date: saved.dailyAttempt.date, runId: saved.dailyAttempt.runId };
      }
      if (this.run && ACTIVE.has(this.run.status)) this.finish('failed', 'server_restarted');
    }
  }
  private get run() { return this.runs[0] ?? null; }
  private timestamp() { return new Date(this.now()).toISOString(); }
  private save() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 2, runs: this.runs.slice(0, 5), ...(this.dailyAttempt ? { dailyAttempt: this.dailyAttempt } : {}) }, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }
  private visible() { return this.run ? structuredClone(this.run) : null; }
  private update(value: Partial<CollectionRun>) {
    if (!this.run) return;
    this.runs[0] = { ...this.run, ...value, updatedAt: this.timestamp() }; this.save();
  }
  private finish(status: CollectionStatus, issue?: CollectionIssue) { this.update({ status, issue }); this.token = undefined; this.leaseAt = undefined; }
  private expire() {
    if (!this.run || !ACTIVE.has(this.run.status)) return;
    if (this.now() - Date.parse(this.run.createdAt) >= TOTAL_TIMEOUT) { this.controller?.abort(); this.finish('failed', 'timeout'); }
    else if (this.run.status === 'reading' && this.leaseAt !== undefined && this.now() - this.leaseAt >= LEASE_TIMEOUT) this.finish('failed', 'bridge_disconnected');
    else if (this.run.status === 'queued' && this.lastSeenAt !== undefined && this.now() - Math.max(this.lastSeenAt, Date.parse(this.run.createdAt)) >= LEASE_TIMEOUT) this.finish('failed', 'bridge_disconnected');
  }
  state() {
    this.expire();
    return { bridge: { connected: this.lastSeenAt !== undefined && this.now() - this.lastSeenAt < CONNECTED_TIMEOUT, ...(this.lastSeenAt === undefined ? {} : { lastSeenAt: new Date(this.lastSeenAt).toISOString() }) }, run: this.visible(), history: structuredClone(this.runs) };
  }
  history() { this.expire(); return { items: structuredClone(this.runs) }; }
  start(value: unknown) {
    fields(value, []); this.expire();
    if (this.run && ACTIVE.has(this.run.status)) return this.visible()!;
    return this.begin();
  }
  private begin(date?: string) {
    this.token = undefined; this.leaseAt = undefined;
    this.runs = [{ id: randomUUID(), status: 'queued', createdAt: this.timestamp(), updatedAt: this.timestamp(), scanned: 0 } as CollectionRun, ...this.runs].slice(0, 5);
    const time = dailyTime(this.now());
    if (date || (time.due && this.dailyAttempt?.date !== time.date)) this.dailyAttempt = { date: date ?? time.date, runId: this.run!.id };
    this.save(); return this.visible()!;
  }
  dailyState(catchUp = false) {
    this.expire();
    const time = dailyTime(this.now());
    const date = catchUp && !time.due ? previousDate(time.date) : time.date, due = time.due || catchUp;
    const run = this.dailyAttempt?.date === date ? this.runs.find(run => run.id === this.dailyAttempt!.runId) ?? null
      : this.runs.find(run => { const time = dailyTime(Date.parse(run.createdAt)); return time.date === date && time.due; }) ?? null;
    const outcome = !due ? 'before_time' : this.dailyAttempt?.date === date ? 'already_started'
      : run ? 'already_started' : this.run && ACTIVE.has(this.run.status) ? 'active'
      : this.state().bridge.connected ? 'due' : 'waiting_browser';
    return { date, timeZone: 'America/New_York', outcome, run: this.run && ACTIVE.has(this.run.status) ? this.visible() : run ? structuredClone(run) : null };
  }
  /** Atomic daily admission, shared by the 10:00 heartbeat and login/wake checker. */
  daily(value: unknown) {
    const body = fields(value, ['catchUp']);
    if (body.catchUp !== undefined && typeof body.catchUp !== 'boolean') throw new PersonalError('补采参数无效');
    const state = this.dailyState(body.catchUp === true);
    if (state.outcome === 'already_started' && this.dailyAttempt?.date !== state.date && state.run) {
      this.dailyAttempt = { date: state.date, runId: state.run.id }; this.save();
    }
    if (state.outcome !== 'due') return state;
    return { ...state, outcome: 'started', run: this.begin(state.date) };
  }
  cancel(id: string, value: unknown) {
    fields(value, []); this.requireRun(id); this.expire();
    if (this.run && ACTIVE.has(this.run.status)) { this.controller?.abort(); this.finish('cancelled'); }
    return this.visible()!;
  }
  clear(id: string, value: unknown) {
    const body = fields(value, ['confirm']); this.expire(); const entry = this.runs.find(run => run.id === id);
    if (!entry) throw new PersonalError('读取记录不存在或已被清除', 404);
    if (body.confirm !== true) throw new PersonalError('请确认删除这条读取记录；书架内容会保留');
    if (ACTIVE.has(entry.status)) throw new PersonalError('请先取消正在进行的读取', 409);
    this.runs = this.runs.filter(run => run.id !== id); this.save(); return { clearedId: id };
  }
  private requireRun(id: string) { if (!this.run || this.run.id !== id) throw new PersonalError('采集任务不存在或已被清除', 404); return this.run; }
  private job() { const to = this.run!.createdAt; return { id: this.run!.id, from: new Date(Date.parse(to) - WINDOW).toISOString(), to }; }
  poll(value: unknown) { fields(value, []); this.expire(); this.lastSeenAt = this.now(); return { job: this.run?.status === 'queued' ? this.job() : null }; }
  claim(id: string, value: unknown) {
    fields(value, []); this.expire(); const run = this.requireRun(id);
    if (run.status !== 'queued') throw new PersonalError('这个读取任务已被领取、结束或取消', 409);
    this.token = randomBytes(32).toString('hex'); this.lastSeenAt = this.now(); this.leaseAt = this.now();
    this.update({ status: 'reading' }); return { job: this.job(), token: this.token };
  }
  private authorize(id: string, token: unknown) {
    this.expire(); const run = this.requireRun(id);
    if (run.status !== 'reading' || !this.token) throw new PersonalError('这个读取任务已结束或取消', 409);
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(this.token))) throw new PersonalError('采集凭据已失效，请重新读取', 403);
    this.lastSeenAt = this.now(); this.leaseAt = this.now(); return run;
  }
  progress(id: string, value: unknown) {
    const body = fields(value, ['token', 'scanned']); const scanned = count(body.scanned); const run = this.authorize(id, body.token);
    this.update({ scanned: Math.max(run.scanned, scanned) }); return { status: this.run!.status };
  }
  fail(id: string, value: unknown) {
    const body = fields(value, ['token', 'issue']);
    if (!READ_FAILURES.has(body.issue as CollectionIssue)) throw new PersonalError('采集失败原因无效');
    this.authorize(id, body.token); this.finish(body.issue === 'needs_login' ? 'needs_login' : 'failed', body.issue as CollectionIssue); return this.visible()!;
  }
  submit(id: string, value: unknown) {
    const body = fields(value, ['token', 'items', 'coverage', 'scanned', 'issue']); const run = this.authorize(id, body.token);
    if (body.issue !== undefined && !READ_FAILURES.has(body.issue as CollectionIssue)) throw new PersonalError('采集失败原因无效');
    const payload = parseReadingImport({ items: body.items, coverage: body.coverage });
    if (!payload.coverage) throw new PersonalError('请提供实际读取的覆盖范围');
    if (payload.items.some(item => !item.sourceKey.startsWith('bilibili:'))) throw new PersonalError('此入口只接收 B 站视频历史');
    if (body.issue && payload.coverage.complete) throw new PersonalError('读取存在问题时不能标记为完整同步');
    const job = this.job(), from = Date.parse(payload.coverage.from), to = Date.parse(payload.coverage.to);
    if (to !== Date.parse(job.to) || from < Date.parse(job.from) || (payload.coverage.complete && from !== Date.parse(job.from))) throw new PersonalError('采集覆盖范围必须与本次读取窗口一致');
    if (payload.items.some(item => Date.parse(item.viewedAt) < from || Date.parse(item.viewedAt) > to)) throw new PersonalError('观看记录必须位于实际读取的覆盖范围内');
    const scanned = body.scanned === undefined ? payload.items.length : count(body.scanned, payload.items.length);
    const eligible = this.store.curatedReadingCandidates({ items: body.items, coverage: payload.coverage });
    this.update({ status: 'importing', scanned: Math.max(run.scanned, scanned), coverage: payload.coverage }); this.token = undefined; this.leaseAt = undefined;
    const controller = new AbortController(); this.controller = controller;
    this.pending = this.organize(id, eligible.items, payload.coverage, body.issue as CollectionIssue | undefined, controller);
    return this.visible()!;
  }
  private async organize(id: string, candidates: ReadingImportCandidate[], coverage: Coverage, issue: CollectionIssue | undefined, controller: AbortController) {
    const current = () => this.run?.id === id && this.run.status === 'importing' && !controller.signal.aborted;
    let stage: CollectionIssue = 'codex_failed';
    try {
      let selected: { index: number; category: ReadingCategory }[] = [];
      if (candidates.length) {
        if (!this.options.selector) throw new Error('Codex is not configured');
        const result = await this.options.selector.select(candidates, { runId: id, coverage, signal: controller.signal, onThread: thread => { if (current()) this.update({ threadId: thread.id, conversationUrl: thread.url }); } });
        if (!Array.isArray(result.selected) || result.selected.length > candidates.length) throw new Error('Invalid Codex selection');
        const seen = new Set<number>();
        selected = result.selected.map(item => {
          if (!Number.isInteger(item.index) || item.index < 0 || item.index >= candidates.length || seen.has(item.index)) throw new Error('Invalid Codex candidate');
          seen.add(item.index); return { index: item.index, category: readingCategory(item.category) };
        });
      }
      if (!current()) return;
      stage = 'import_failed';
      const imported = this.store.importCuratedReading({ items: selected.map(item => ({ ...evidence(candidates[item.index]), category: item.category })), coverage });
      this.update({ result: { added: imported.items.length, skipped: this.run!.scanned - imported.items.length, itemIds: imported.items.map(item => item.id) } });
      this.finish(coverage.complete ? 'completed' : 'partial', issue);
    } catch (error) {
      if (current()) {
        if (stage === 'codex_failed' && error instanceof CodexReadingError) this.update({ failure: { code: error.code, ...(error.reason ? { reason: error.reason } : {}) } });
        this.finish('failed', stage === 'codex_failed' && error instanceof CodexReadingError && error.code === 'busy' ? 'codex_busy' : stage);
      }
    }
    finally { if (this.controller === controller) this.controller = undefined; }
  }
  whenIdle() { return this.pending; }
  close() { this.controller?.abort(); if (this.run && ACTIVE.has(this.run.status)) this.finish('failed', 'server_restarted'); }
}
