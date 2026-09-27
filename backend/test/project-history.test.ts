import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProjectHistory, historyGit, type HistoryProject } from '../src/personal/project-history';

const exec = promisify(execFile);
const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
async function git(path: string, ...args: string[]) { return (await exec('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd: path, windowsHide: true, encoding: 'utf8', timeout: 20000 })).stdout.trim(); }
async function fixture(commits = 3) {
  const path = mkdtempSync(join(tmpdir(), 'dailyhouse-history-')); directories.push(path);
  await git(path, 'init', '-b', 'main'); await git(path, 'config', 'user.name', 'History Test'); await git(path, 'config', 'user.email', 'history@example.test');
  for (let index = 0; index < commits; index++) await git(path, 'commit', '--allow-empty', '-m', `Commit ${index + 1}\n\n完整说明 ${index + 1}\n第二段保留。`);
  const project: HistoryProject = { id: 'project-one', path, repo: { url: 'https://github.com/AlexShen-Oguri/HistoryTest', match: 'remote' } };
  await git(path, 'remote', 'add', 'origin', `${project.repo!.url}.git`);
  return { path, project, history: new ProjectHistory() };
}
describe('paginated local project history', () => {
  it('returns complete messages and real metadata, including tags and verified GitHub links', async () => {
    const f = await fixture(); await git(f.path, 'tag', '-a', 'v1', '-m', 'Annotated tag');
    const page = await f.history.page(f.project, { limit: '2' });
    expect(page.status).toBe('ready'); expect(page.items).toHaveLength(2); expect(page.nextCursor).toBeTruthy();
    expect(page.items[0]).toMatchObject({ subject: 'Commit 3', author: { name: 'History Test', email: 'history@example.test' }, message: 'Commit 3\n\n完整说明 3\n第二段保留。\n' });
    expect(page.items[0].hash).toMatch(/^[0-9a-f]{40}$/); expect(page.items[0].parents).toHaveLength(1); expect(page.items[0].refs).toContain('v1'); expect(page.items[0].url).toBe(`${f.project.repo!.url}/commit/${page.items[0].hash}`);
    expect(page.refs).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'refs/heads/main', kind: 'branch' }), expect.objectContaining({ name: 'refs/tags/v1', kind: 'tag' })]));
    const last = await f.history.page(f.project, { limit: 2, cursor: page.nextCursor }); expect(last.items).toHaveLength(1); expect(last.items[0].parents).toEqual([]); expect(last.nextCursor).toBeNull();
  });
  it('pins pagination to old tips when a new commit is created between pages', async () => {
    const f = await fixture(5); const before = (await git(f.path, 'rev-list', '--all')).split('\n'); const first = await f.history.page(f.project, { limit: 2 });
    await git(f.path, 'commit', '--allow-empty', '-m', 'New after opening history');
    const hashes = first.items.map(c => c.hash); let cursor = first.nextCursor;
    while (cursor) { const page = await f.history.page(f.project, { cursor, limit: 2 }); hashes.push(...page.items.map(c => c.hash)); cursor = page.nextCursor; expect(page.snapshotAt).toBe(first.snapshotAt); }
    expect(hashes).toEqual(before); expect(new Set(hashes).size).toBe(5);
    expect((await f.history.page(f.project, { limit: 1 })).items[0].subject).toBe('New after opening history');
  });
  it('includes branches outside HEAD and nested annotated tags, and preserves merge parents', async () => {
    const f = await fixture(1); await git(f.path, 'checkout', '-b', 'feature'); await git(f.path, 'commit', '--allow-empty', '-m', 'Feature work'); await git(f.path, 'tag', '-a', 'inner', '-m', 'Inner'); await git(f.path, 'tag', '-a', 'outer', 'inner', '-m', 'Nested'); await git(f.path, 'checkout', 'main'); await git(f.path, 'commit', '--allow-empty', '-m', 'Main work'); await git(f.path, 'merge', '--no-ff', 'feature', '-m', 'Merge feature'); await git(f.path, 'checkout', '-b', 'unmerged'); await git(f.path, 'commit', '--allow-empty', '-m', 'Unmerged work'); await git(f.path, 'checkout', 'main');
    const all = await f.history.page(f.project, {}); expect(all.items.map(c => c.subject)).toContain('Unmerged work'); expect(all.items.find(c => c.subject === 'Merge feature')?.parents).toHaveLength(2);
    expect(all.refs.find(ref => ref.name === 'refs/tags/outer')?.hash).toBe(all.items.find(c => c.subject === 'Feature work')?.hash);
    const branch = await f.history.page(f.project, { ref: 'refs/heads/feature' }); expect(branch.items.map(c => c.subject)).toEqual(['Feature work', 'Commit 1']);
    const head = await f.history.page(f.project, { ref: 'HEAD' }); expect(head.items.map(c => c.subject)).not.toContain('Unmerged work');
  });
  it('rejects paths, argument injection, invalid limits, forged and cross-project cursors', async () => {
    const f = await fixture();
    for (const input of [{ path: f.path }, { ref: '--all' }, { ref: 'refs/heads/main --all' }, { ref: 'refs/heads/main\n--all' }, { ref: ['HEAD'] }, { limit: 0 }, { limit: 51 }, { cursor: '%%%bad' }]) await expect(f.history.page(f.project, input)).rejects.toThrow();
    await expect(f.history.page(f.project, { ref: 'refs/heads/missing' })).rejects.toMatchObject({ status: 404 });
    const first = await f.history.page(f.project, { limit: 1 });
    await expect(f.history.page({ ...f.project, id: 'another-project' }, { cursor: first.nextCursor })).rejects.toMatchObject({ status: 410 });
    await expect(f.history.page(f.project, { cursor: first.nextCursor, ref: 'HEAD' })).rejects.toThrow('更换分支');
    f.history.invalidate(f.project.id); await expect(f.history.page(f.project, { cursor: first.nextCursor })).rejects.toMatchObject({ status: 410 });
  });
  it('expires inactive snapshots without blocking new history reads', async () => {
    const f = await fixture(); let now = Date.now(); const history = new ProjectHistory(historyGit, () => now); const first = await history.page(f.project, { limit: 1 }); now += 31 * 60 * 1000;
    await expect(history.page(f.project, { cursor: first.nextCursor })).rejects.toMatchObject({ status: 410 }); expect((await history.page(f.project, {})).items).toHaveLength(3);
  });
  it('distinguishes unborn, non-Git and missing projects and supports unique child repositories', async () => {
    const f = await fixture(0); expect((await f.history.page(f.project, {})).status).toBe('empty');
    const plain = join(f.path, 'plain'); mkdirSync(plain); expect((await f.history.page({ ...f.project, path: plain }, {})).status).toBe('not_repository');
    expect((await f.history.page({ ...f.project, path: join(f.path, 'missing') }, {})).status).toBe('missing');
    const parent = mkdtempSync(join(tmpdir(), 'dailyhouse-history-parent-')); directories.push(parent); const child = join(parent, 'repo'); await git(parent, 'clone', f.path, child); expect((await f.history.page({ ...f.project, path: parent }, {})).status).toBe('empty');
  });
  it('truthfully marks shallow history and never fetches unavailable older commits', async () => {
    const f = await fixture(4); const clone = mkdtempSync(join(tmpdir(), 'dailyhouse-history-shallow-')); directories.push(clone); const path = join(clone, 'repo'); await git(clone, 'clone', '--depth=1', pathToFileURL(f.path).href, path);
    const before = readFileSync(join(path, '.git', 'shallow'), 'utf8'); const page = await f.history.page({ ...f.project, path }, {}); expect(page.status).toBe('ready'); expect(page.shallow).toBe(true); expect(page.items).toHaveLength(1); expect(page.nextCursor).toBeNull(); expect(readFileSync(join(path, '.git', 'shallow'), 'utf8')).toBe(before);
  });
  it('does not generate commit links for an inferred same-name repository', async () => { const f = await fixture(); const page = await f.history.page({ ...f.project, repo: { ...f.project.repo!, match: 'name' } }, {}); expect(page.items.every(commit => commit.url === undefined)).toBe(true); });
  it('does not assume a repository is unique from only the first 40 subdirectories', async () => { const path = mkdtempSync(join(tmpdir(), 'dailyhouse-history-many-')); directories.push(path); for (let index = 0; index < 45; index++) mkdirSync(join(path, String(index).padStart(3, '0'))); await git(join(path, '044'), 'init', '-b', 'main'); const history = new ProjectHistory(); const project = { id: 'many', path }; expect((await history.page(project, {})).status).toBe('empty'); await git(join(path, '000'), 'init', '-b', 'main'); expect((await history.page(project, {})).status).toBe('not_repository'); });
});
