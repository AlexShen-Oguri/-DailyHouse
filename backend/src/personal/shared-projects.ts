import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { PersonalError } from './types';
import type { ProjectResumeService } from './project-resume';
import type { DevelopmentTool, DevelopmentToolsService } from './development-tools';
import type { ProjectedRecord } from './sync-projection';
import { sameRecord } from './sync-ledger';

export interface SharedProject {
  id: string; title: string; goal: string; decisions: string; progress: string; nextStep: string; repoUrl: string;
  sourceIdeaId?: string; createdAt: string; updatedAt: string; revision: number;
}
interface ProjectTrash { project: SharedProject; deletedAt: string; expiresAt: string }
interface Link { tool: DevelopmentTool; localProjectId: string; path: string; verifiedAt: string }
interface Data { version: 1; items: SharedProject[]; trash: ProjectTrash[]; removed: string[]; requests: { id: string; projectId: string; fingerprint: string }[] }
const RECOVERY_MS = 30 * 86400000;
const uid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function fields(input: unknown, allowed: string[]) { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw new PersonalError('项目续航请求无效。'); return input as Record<string, unknown>; }
function text(input: unknown, limit: number, required = false) { if (typeof input !== 'string' || input.length > limit || required && !input.trim()) throw new PersonalError('项目续航文字无效或超过长度限制。'); return input.trim(); }
function repo(input: unknown) { const value = text(input, 500); if (value && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(value)) throw new PersonalError('请使用完整的 GitHub 仓库地址。'); return value; }
function body(input: Record<string, unknown>, previous?: SharedProject): Omit<SharedProject, 'id' | 'createdAt' | 'updatedAt' | 'revision'> {
  const result = { title: previous?.title ?? '', goal: previous?.goal ?? '', decisions: previous?.decisions ?? '', progress: previous?.progress ?? '', nextStep: previous?.nextStep ?? '', repoUrl: previous?.repoUrl ?? '', ...(previous?.sourceIdeaId ? { sourceIdeaId: previous.sourceIdeaId } : {}) };
  for (const key of ['title', 'goal', 'decisions', 'progress', 'nextStep'] as const) if (key in input) result[key] = text(input[key], key === 'title' ? 200 : key === 'nextStep' ? 2000 : 20000, ['title', 'goal'].includes(key));
  if ('repoUrl' in input) result.repoUrl = repo(input.repoUrl);
  if ('sourceIdeaId' in input) { if (!uid(input.sourceIdeaId) && !(typeof input.sourceIdeaId === 'string' && /^legacy-[a-f0-9]{24}$/.test(input.sourceIdeaId))) throw new PersonalError('灵感关联标识无效。'); result.sourceIdeaId = input.sourceIdeaId as string; }
  if (!result.title || !result.goal) throw new PersonalError('请填写项目标题和目标。');
  return result;
}
export function validateSharedProjectRecord(input: ProjectedRecord): ProjectedRecord {
  const value = fields(input, ['kind', 'id', 'body', 'deletedAt', 'expiresAt']);
  if (value.kind !== 'project' || !uid(value.id)) throw new PersonalError('共享项目标识无效。');
  if (value.body !== null) {
    const project = fields(value.body, ['id', 'title', 'goal', 'decisions', 'progress', 'nextStep', 'repoUrl', 'sourceIdeaId', 'createdAt', 'updatedAt']);
    if (project.id !== value.id || typeof project.createdAt !== 'string' || typeof project.updatedAt !== 'string' || !Number.isFinite(Date.parse(project.createdAt)) || !Number.isFinite(Date.parse(project.updatedAt))) throw new PersonalError('共享项目时间或标识无效。');
    const clean = body(project);
    if (Object.keys(clean).some(key => (clean as Record<string, unknown>)[key] !== project[key])) throw new PersonalError('共享项目内容无效。');
  }
  if (value.deletedAt !== undefined && (typeof value.deletedAt !== 'string' || !Number.isFinite(Date.parse(value.deletedAt)))) throw new PersonalError('项目删除时间无效。');
  if (value.expiresAt !== undefined && (value.body === null || typeof value.expiresAt !== 'string' || typeof value.deletedAt !== 'string' || Date.parse(value.expiresAt) - Date.parse(value.deletedAt) !== RECOVERY_MS)) throw new PersonalError('项目恢复期限无效。');
  if (value.deletedAt && value.body !== null && !value.expiresAt) throw new PersonalError('项目恢复期限无效。');
  return structuredClone(input);
}

/** Portable project identity and authored context. Native directories and sessions never enter its projection. */
export class SharedProjectStore {
  private data: Data = { version: 1, items: [], trash: [], removed: [], requests: [] };
  private links: Record<string, Link> = {};
  constructor(private file: string, private linkFile: string, private device: { id: string; name: string }, private localProjects: Pick<ProjectResumeService, 'cachedProject'>, private tools: Pick<DevelopmentToolsService, 'requireAuthenticated' | 'status'>, private provenance: (record: ProjectedRecord) => { deviceId: string; deviceName: string; updatedAt: string }) {
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8')) as Data;
        if (data.version !== 1 || !Array.isArray(data.items) || !Array.isArray(data.trash) || !Array.isArray(data.removed) || !Array.isArray(data.requests)) throw new Error();
        for (const item of data.items) { validateSharedProjectRecord(this.project(item)); if (!Number.isSafeInteger(item.revision) || item.revision < 1) throw new Error(); }
        for (const item of data.trash) validateSharedProjectRecord({ ...this.project(item.project), deletedAt: item.deletedAt, expiresAt: item.expiresAt });
        if (data.removed.some(id => !uid(id))) throw new Error();
        data.requests = data.requests.map(request => ({ ...request, fingerprint: /^[a-f0-9]{64}$/.test(request.fingerprint) ? request.fingerprint : createHash('sha256').update(request.fingerprint).digest('hex') }));
        this.data = data;
      } catch { throw new Error('Shared projects are invalid. Restore their private backup before continuing.'); }
    }
    if (existsSync(linkFile)) {
      try { const value = JSON.parse(readFileSync(linkFile, 'utf8')); if (value.version !== 1 || value.deviceId !== device.id || !value.links || typeof value.links !== 'object') throw new Error(); this.links = value.links; }
      catch { throw new Error('Project links belong to another device or are invalid. They were not applied.'); }
    }
  }
  private write(file: string, value: unknown) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file + '.tmp', JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 }); renameSync(file + '.tmp', file); }
  private save() { this.write(this.file, this.data); }
  private saveLinks() { this.write(this.linkFile, { version: 1, deviceId: this.device.id, links: this.links }); }
  private project(item: SharedProject): ProjectedRecord { const { revision: _revision, ...value } = item; return { kind: 'project', id: item.id, body: value }; }
  private get(id: string) { const item = this.data.items.find(project => project.id === id); if (!item) throw new PersonalError('项目续航记录不存在。', 404); return item; }
  private current(item: SharedProject, revision: unknown) { if (revision !== item.revision) throw new PersonalError('项目已更新，请保留草稿并重新读取。', 409); }
  private present(item: SharedProject) {
    const link = this.links[item.id], workspace = link && this.localProjects.cachedProject(link.localProjectId);
    let available = false;
    if (link && workspace?.path === link.path && isAbsolute(link.path)) { try { available = lstatSync(link.path).isDirectory() && !lstatSync(link.path).isSymbolicLink(); } catch { /* Missing device-local code is not a shared-data error. */ } }
    return { ...structuredClone(item), provenance: this.provenance(this.project(item)), ...(link ? { local: { ...link, available, nativeSessionVerified: false, command: { executable: link.tool, args: [], cwd: link.path, started: false, nativeSessionRestored: false } } } : {}) };
  }
  list() { return { items: this.data.items.map(item => this.present(item)), trashCount: this.trash().items.length }; }
  create(input: unknown) {
    const value = fields(input, ['title', 'goal', 'decisions', 'progress', 'nextStep', 'repoUrl', 'sourceIdeaId', 'requestId']), clean = body(value);
    const requestId = value.requestId;
    if (requestId !== undefined && !uid(requestId)) throw new PersonalError('项目创建请求标识无效。');
    const fingerprint = createHash('sha256').update(JSON.stringify(clean)).digest('hex'), existing = this.data.requests.find(item => item.id === requestId);
    if (existing) { if (existing.fingerprint !== fingerprint) throw new PersonalError('重试请求不能更改原内容。', 409); if (this.data.removed.includes(existing.projectId) || !this.data.items.some(item => item.id === existing.projectId)) throw new PersonalError('该记录已删除，旧请求不能恢复它。', 410); return this.present(this.get(existing.projectId)); }
    if (this.data.items.length + this.data.trash.length >= 5000) throw new PersonalError('项目续航记录过多。');
    const time = new Date().toISOString(), item: SharedProject = { id: randomUUID(), ...clean, createdAt: time, updatedAt: time, revision: 1 };
    this.data.items.push(item); if (requestId) this.data.requests.push({ id: requestId as string, projectId: item.id, fingerprint }); this.save(); return this.present(item);
  }
  edit(id: string, input: unknown) {
    const value = fields(input, ['revision', 'title', 'goal', 'decisions', 'progress', 'nextStep', 'repoUrl', 'sourceIdeaId']), item = this.get(id); this.current(item, value.revision);
    Object.assign(item, body(value, item), { updatedAt: new Date().toISOString(), revision: item.revision + 1 }); this.save(); return this.present(item);
  }
  remove(id: string, input: unknown) { const value = fields(input, ['revision', 'confirmed']), item = this.get(id); this.current(item, value.revision); if (value.confirmed !== true) throw new PersonalError('请确认仅删除小院记录。'); const deletedAt = new Date().toISOString(); this.data.items = this.data.items.filter(project => project.id !== id); this.data.trash.push({ project: item, deletedAt, expiresAt: new Date(Date.parse(deletedAt) + RECOVERY_MS).toISOString() }); this.save(); }
  trash() { return { items: structuredClone(this.data.trash.filter(item => Date.parse(item.expiresAt) > Date.now())) }; }
  restore(id: string, input: unknown) { if (fields(input, ['confirmed']).confirmed !== true) throw new PersonalError('请确认恢复小院记录。'); const entry = this.data.trash.find(item => item.project.id === id && Date.parse(item.expiresAt) > Date.now()); if (!entry) throw new PersonalError('项目恢复期限已过。', 410); const project = { ...entry.project, revision: entry.project.revision + 1, updatedAt: new Date().toISOString() }; this.data.items.push(project); this.data.trash = this.data.trash.filter(item => item.project.id !== id); this.save(); return this.present(project); }
  purge(id: string, input: unknown) { if (fields(input, ['confirmed']).confirmed !== true) throw new PersonalError('请确认永久删除小院记录。'); if (!this.data.trash.some(item => item.project.id === id)) throw new PersonalError('项目回收站记录不存在。', 404); this.data.trash = this.data.trash.filter(item => item.project.id !== id); if (!this.data.removed.includes(id)) this.data.removed.push(id); delete this.links[id]; this.save(); this.saveLinks(); }
  async link(id: string, input: unknown) {
    const value = fields(input, ['revision', 'tool', 'localProjectId']), item = this.get(id); this.current(item, value.revision);
    if (!['codex', 'claude'].includes(value.tool as string) || typeof value.localProjectId !== 'string') throw new PersonalError('请选择本机已有项目和开发工具。');
    await this.tools.requireAuthenticated(value.tool as DevelopmentTool);
    const project = this.localProjects.cachedProject(value.localProjectId);
    if (!project || !isAbsolute(project.path) || !existsSync(project.path) || lstatSync(project.path).isSymbolicLink() || !lstatSync(project.path).isDirectory()) throw new PersonalError('本机项目目录尚未验证。', 409);
    if (item.repoUrl && (project.repo?.match !== 'remote' || project.git.remote?.toLowerCase() !== item.repoUrl.toLowerCase())) throw new PersonalError('本机项目的仓库关联与这份续航记录不一致。', 409);
    this.links[id] = { tool: value.tool as DevelopmentTool, localProjectId: project.id, path: project.path, verifiedAt: new Date().toISOString() }; this.saveLinks(); return this.present(item);
  }
  unlink(id: string, input: unknown) { this.get(id); if (fields(input, ['confirmed']).confirmed !== true) throw new PersonalError('请确认解除此设备的关联。'); delete this.links[id]; this.saveLinks(); return this.present(this.get(id)); }
  async handoff(id: string, input: unknown) {
    const value = fields(input, ['tool', 'confirmed']), item = this.get(id);
    if (value.confirmed !== true || !['codex', 'claude'].includes(value.tool as string)) throw new PersonalError('请确认要交接的工具和项目上下文。');
    await this.tools.requireAuthenticated(value.tool as DevelopmentTool);
    const current = this.present(item), link = current.local;
    const text = [`${item.title}`, `Goal: ${item.goal}`, `Decisions: ${item.decisions}`, `Progress: ${item.progress}`, `Next step: ${item.nextStep}`, `Repository: ${item.repoUrl || '(not linked)'}`, 'This is saved DailyHouse context, not a restored native conversation. Preserve the tool’s own approvals. Do not create a duplicate repository or project.'].join('\n\n');
    return { text, recipe: { executable: value.tool, args: [], ...(link?.available && link.tool === value.tool ? { cwd: link.path } : {}), started: false, nativeSessionRestored: false }, existingSession: false };
  }
  syncExport(): ProjectedRecord[] { return [...this.data.items.map(item => this.project(item)), ...this.data.trash.map(item => Date.parse(item.expiresAt) > Date.now() ? { ...this.project(item.project), deletedAt: item.deletedAt, expiresAt: item.expiresAt } : { kind: 'project', id: item.project.id, body: null, deletedAt: item.deletedAt }), ...this.data.removed.map(id => ({ kind: 'project', id, body: null }))]; }
  syncApply(records: ProjectedRecord[]) {
    records.forEach(validateSharedProjectRecord); const next = structuredClone(this.data), before = new Map(this.syncExport().map(item => [item.id, item]));
    for (const record of records) {
      if (sameRecord(before.get(record.id), record)) continue;
      const prior = next.items.find(item => item.id === record.id) ?? next.trash.find(item => item.project.id === record.id)?.project;
      next.items = next.items.filter(item => item.id !== record.id); next.trash = next.trash.filter(item => item.project.id !== record.id);
      next.removed = next.removed.filter(id => id !== record.id);
      if (record.body) { const project = { ...record.body, revision: (prior?.revision ?? 0) + 1 } as unknown as SharedProject; if (record.deletedAt) next.trash.push({ project, deletedAt: record.deletedAt, expiresAt: record.expiresAt! }); else next.items.push(project); }
      else if (!next.removed.includes(record.id)) next.removed.push(record.id);
    }
    this.write(this.file, next); this.data = next;
  }
}
