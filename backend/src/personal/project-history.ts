import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, realpathSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { PersonalError } from './types';
import { githubRemote } from './project-sources';

export interface HistoryProject { id: string; path: string; repo?: { url: string; match?: string } }
export interface HistoryRef { name: string; label: string; kind: 'branch' | 'remote' | 'tag'; hash: string }
export interface HistoryCommit { hash: string; shortHash: string; subject: string; message: string; author: { name: string; email: string }; authoredAt: string; committedAt: string; parents: string[]; refs: string[]; url?: string }
export interface ProjectHistoryPage { status: 'ready' | 'empty' | 'not_repository' | 'missing' | 'error'; message?: string; items: HistoryCommit[]; refs: HistoryRef[]; selectedRef: string; shallow: boolean; snapshotAt: string | null; nextCursor: string | null }
export type HistoryGit = (args: string[], cwd: string, input?: string) => Promise<string>;
interface Snapshot { id: string; projectId: string; root: string; tips: string[]; refs: HistoryRef[]; head?: string; selectedRef: string; shallow: boolean; shallowSignature: string; snapshotAt: string; accessedAt: number; repoUrl?: string }
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const IDLE_TTL = 30 * 60 * 1000;
const PAGE_LIMIT = 50;
const MAX_SNAPSHOTS = 100;

export const historyGit: HistoryGit = (args, cwd, input) => new Promise((resolveValue, reject) => {
  const child = execFile('git', ['--no-optional-locks', '--no-pager', '--no-replace-objects', '-c', 'log.showSignature=false', ...args], { cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 30000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } }, (error, stdout) => error ? reject(new Error('Local Git history read failed.')) : resolveValue(stdout));
  child.stdin?.on('error', () => { /* The bounded child may exit before consuming stdin. */ });
  child.stdin?.end(input || '');
});
function localRoot(project: HistoryProject): { status: 'ready'; root: string } | { status: 'not_repository' | 'missing' | 'error' } {
  if (!isAbsolute(project.path) || project.path.startsWith('\\\\') || project.path.startsWith('//')) return { status: 'error' };
  if (!existsSync(project.path)) return { status: 'missing' };
  try {
    if (lstatSync(project.path).isSymbolicLink() || !lstatSync(project.path).isDirectory()) return { status: 'error' };
    let root = resolve(project.path);
    if (!existsSync(join(root, '.git'))) {
      const directories = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.') && !['node_modules', 'vendor', 'dist'].includes(entry.name));
      if (directories.length > 2000) return { status: 'error' };
      const children = directories.map(entry => join(root, entry.name)).filter(path => existsSync(join(path, '.git')));
      if (children.length !== 1) return { status: 'not_repository' };
      root = children[0];
    }
    if (lstatSync(join(root, '.git')).isSymbolicLink()) return { status: 'error' };
    return { status: 'ready', root: realpathSync(root) };
  } catch { return { status: 'error' }; }
}
function cursorData(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,300}$/.test(value)) throw new PersonalError('提交历史游标无效，请重新打开历史', 400);
  try { const data = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); if (Object.keys(data).sort().join(',') !== 'offset,snapshot' || typeof data.snapshot !== 'string' || !/^[0-9a-f-]{36}$/.test(data.snapshot) || !Number.isSafeInteger(data.offset) || data.offset < 1 || data.offset > 1000000000) throw new Error(); return data as { snapshot: string; offset: number }; }
  catch { throw new PersonalError('提交历史游标无效，请重新打开历史', 400); }
}
function query(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['ref', 'cursor', 'limit'].includes(key))) throw new PersonalError('提交历史查询无效');
  const input = value as Record<string, unknown>; const limit = input.limit === undefined ? 30 : typeof input.limit === 'string' && /^\d{1,2}$/.test(input.limit) ? Number(input.limit) : input.limit;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > PAGE_LIMIT) throw new PersonalError('每页提交数须为 1 至 50');
  const ref = input.ref === undefined ? 'all' : input.ref;
  if (typeof ref !== 'string' || ref.length > 1024 || /[\x00-\x20\x7f]/.test(ref) || (ref !== 'all' && ref !== 'HEAD' && !/^refs\/(heads|remotes|tags)\//.test(ref))) throw new PersonalError('请选择列表中的分支或标签');
  if (input.cursor !== undefined && input.ref !== undefined) throw new PersonalError('翻页时不能同时更换分支，请重新加载历史');
  return { limit, ref, ...(input.cursor !== undefined ? { cursor: cursorData(input.cursor) } : {}) };
}
function empty(status: ProjectHistoryPage['status'], selectedRef: string, message?: string): ProjectHistoryPage { return { status, ...(message ? { message } : {}), items: [], refs: [], selectedRef, shallow: false, snapshotAt: null, nextCursor: null }; }
function parseCommits(output: string, snapshot: Snapshot): HistoryCommit[] {
  if (!output.trim()) return [];
  const chunks = output.split('\0'); if (chunks.pop()?.trim()) throw new Error('Invalid Git record terminator');
  if (chunks.length % 8 !== 0) throw new Error('Invalid Git record fields');
  const result: HistoryCommit[] = [];
  for (let index = 0; index < chunks.length; index += 8) {
    const [rawHash, shortHash, name, email, authoredAt, committedAt, parentText, message] = chunks.slice(index, index + 8); const hash = rawHash.trim(); const parents = parentText ? parentText.split(' ') : [];
    if (!OID.test(hash) || !/^[0-9a-f]{4,64}$/.test(shortHash) || parents.some(p => !OID.test(p))) throw new Error('Invalid commit identity');
    const refs = snapshot.refs.filter(ref => ref.hash === hash).map(ref => ref.label); if (snapshot.head === hash) refs.unshift('HEAD');
    result.push({ hash, shortHash, subject: message.split(/\r?\n/, 1)[0], message, author: { name, email }, authoredAt, committedAt, parents, refs, ...(snapshot.repoUrl ? { url: `${snapshot.repoUrl}/commit/${hash}` } : {}) });
  }
  return result;
}

export class ProjectHistory {
  private snapshots = new Map<string, Snapshot>();
  constructor(private git: HistoryGit = historyGit, private now: () => number = Date.now) {}
  invalidate(projectId: string) { for (const [id, snapshot] of this.snapshots) if (snapshot.projectId === projectId) this.snapshots.delete(id); }
  private async shallowState(root: string) {
    const shallow = (await this.git(['rev-parse', '--is-shallow-repository'], root)).trim() === 'true';
    if (!shallow) return { shallow, signature: '' };
    const raw = (await this.git(['rev-parse', '--git-path', 'shallow'], root)).trim(); const path = resolve(root, raw);
    // Git worktrees legitimately store their shallow boundary in the shared git
    // directory. This path comes from Git, never from the HTTP request.
    const info = lstatSync(path); if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) throw new Error('Invalid shallow boundary');
    const contents = readFileSync(path, 'utf8');
    return { shallow, signature: createHash('sha256').update(contents).digest('hex') };
  }
  private async snapshot(project: HistoryProject, root: string, selectedRef: string) {
    const [rawRefs, rawHead, shallow, remote] = await Promise.all([
      this.git(['for-each-ref', '--sort=refname', '--format=%(refname)%00%(objectname)%00%(*objectname)%00%(objecttype)%00%(*objecttype)', 'refs/heads', 'refs/remotes', 'refs/tags'], root),
      this.git(['rev-parse', '--verify', 'HEAD^{commit}'], root).catch(() => ''), this.shallowState(root), this.git(['remote', 'get-url', 'origin'], root).catch(() => ''),
    ]);
    const refs: HistoryRef[] = [];
    const unresolved = rawRefs.split(/\r?\n/).filter(Boolean).map(line => line.split('\0')).filter(([, object, , type, peeledType]) => type === 'tag' && peeledType !== 'commit' && OID.test(object));
    const resolvedTags = new Map<string, string>();
    if (unresolved.length) {
      const peeled = await this.git(['cat-file', '--batch-check=%(objectname) %(objecttype)'], root, `${unresolved.map(([, object]) => `${object}^{commit}`).join('\n')}\n`);
      peeled.split(/\r?\n/).forEach((line, index) => { const [hash, type] = line.split(' '); if (type === 'commit' && OID.test(hash) && unresolved[index]) resolvedTags.set(unresolved[index][1], hash); });
    }
    for (const line of rawRefs.split(/\r?\n/).filter(Boolean)) {
      const [name, object, peeled, type, peeledType] = line.split('\0'); let hash = type === 'commit' ? object : peeledType === 'commit' ? peeled : '';
      if (!/^refs\/(heads|remotes|tags)\//.test(name)) throw new Error('Invalid ref');
      if (type === 'tag' && !hash) hash = resolvedTags.get(object) || '';
      if (!OID.test(hash)) continue; // Blob/tree tags do not identify commit history.
      const kind = name.startsWith('refs/heads/') ? 'branch' : name.startsWith('refs/remotes/') ? 'remote' : 'tag';
      refs.push({ name, label: name.replace(/^refs\/(heads|remotes|tags)\//, ''), kind, hash });
    }
    const head = OID.test(rawHead.trim()) ? rawHead.trim() : undefined;
    if (selectedRef !== 'all' && selectedRef !== 'HEAD' && !refs.some(ref => ref.name === selectedRef)) throw new PersonalError('分支或标签不存在，请刷新提交历史', 404);
    const tips = selectedRef === 'all' ? [...new Set([...refs.map(ref => ref.hash), ...(head ? [head] : [])])].sort() : selectedRef === 'HEAD' ? head ? [head] : [] : [refs.find(ref => ref.name === selectedRef)!.hash];
    const snapshot: Snapshot = { id: randomUUID(), projectId: project.id, root, tips, refs, ...(head ? { head } : {}), selectedRef, shallow: shallow.shallow, shallowSignature: shallow.signature, snapshotAt: new Date(this.now()).toISOString(), accessedAt: this.now(), ...(project.repo?.match === 'remote' && githubRemote(remote)?.toLowerCase() === project.repo.url.toLowerCase() && /^https:\/\/github\.com\/AlexShen-Oguri\/[A-Za-z0-9_.-]+$/.test(project.repo.url) ? { repoUrl: project.repo.url } : {}) };
    for (const [id, cached] of this.snapshots) if (this.now() - cached.accessedAt > IDLE_TTL) this.snapshots.delete(id);
    while (this.snapshots.size >= MAX_SNAPSHOTS) this.snapshots.delete(this.snapshots.keys().next().value!);
    this.snapshots.set(snapshot.id, snapshot); return snapshot;
  }
  async page(project: HistoryProject, value: unknown): Promise<ProjectHistoryPage> {
    const input = query(value); const location = localRoot(project);
    if (location.status !== 'ready') return empty(location.status, input.ref);
    let snapshot: Snapshot; let offset = 0;
    try {
      const actualRoot = (await this.git(['rev-parse', '--show-toplevel'], location.root)).trim();
      if (realpathSync(actualRoot) !== location.root) return empty('error', input.ref, '项目的 Git 根目录已变化，请刷新项目后重试');
      if (input.cursor) {
        const cached = this.snapshots.get(input.cursor.snapshot);
        if (!cached || cached.projectId !== project.id || cached.root !== location.root || this.now() - cached.accessedAt > IDLE_TTL) throw new PersonalError('提交历史快照已过期，请刷新历史后继续', 410);
        const current = await this.shallowState(location.root);
        if (current.shallow !== cached.shallow || current.signature !== cached.shallowSignature) { this.snapshots.delete(cached.id); throw new PersonalError('本机历史范围已变化，请刷新历史后继续', 409); }
        snapshot = cached; snapshot.accessedAt = this.now(); offset = input.cursor.offset;
      } else snapshot = await this.snapshot(project, location.root, input.ref);
      if (!snapshot.tips.length) return { ...empty('empty', snapshot.selectedRef), refs: snapshot.refs, shallow: snapshot.shallow, snapshotAt: snapshot.snapshotAt };
      const log = await this.git(['log', '--no-decorate', '--no-show-signature', '--topo-order', '--encoding=UTF-8', '--format=tformat:%H%x00%h%x00%an%x00%ae%x00%aI%x00%cI%x00%P%x00%B%x00', `--max-count=${input.limit + 1}`, `--skip=${offset}`, '--stdin', '--'], snapshot.root, `${snapshot.tips.join('\n')}\n`);
      const commits = parseCommits(log, snapshot); const more = commits.length > input.limit; const items = commits.slice(0, input.limit);
      return { status: items.length ? 'ready' : 'empty', items, refs: snapshot.refs, selectedRef: snapshot.selectedRef, shallow: snapshot.shallow, snapshotAt: snapshot.snapshotAt, nextCursor: more ? Buffer.from(JSON.stringify({ snapshot: snapshot.id, offset: offset + items.length })).toString('base64url') : null };
    } catch (error) {
      if (error instanceof PersonalError) throw error;
      return empty('error', input.ref, '本机提交历史暂时无法读取；可能是 Git 不可用、对象缺失或本页内容超过读取限制。请刷新或减少每页数量后重试。');
    }
  }
}
