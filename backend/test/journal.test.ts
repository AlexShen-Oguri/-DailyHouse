import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { JournalStore } from '../src/personal/journal';
import { PersonalStore } from '../src/personal/store';
import { createPersonalApp } from '../src/personal/app';

let root: string, file: string, store: JournalStore, server: Server | undefined;
const sample = (date = '2026-10-03') => ({ date, revision: 0, title: '示例工作日记', codex: '完成示例项目', status: 'draft', lifeState: 'waiting' });
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'garden-journal-')); file = join(root, 'journal.json'); store = new JournalStore(file); });
afterEach(async () => { vi.useRealTimers(); if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; } rmSync(root, { recursive: true, force: true }); });

describe('work journal persistence and conflict protection', () => {
  it('keeps one page per date, persists it and applies an identical retry without another revision', () => {
    const first = store.publish(sample());
    expect(first).toMatchObject({ date: '2026-10-03', revision: 1, timezone: 'America/New_York', editedFields: [] });
    const same = store.publish({ ...sample(), revision: 1 });
    expect(same).toEqual(first);
    expect(() => store.publish(sample())).toThrow('已更新');
    expect(() => store.create({ date: first.date, codex: 'duplicate' })).toThrow('已更新');
    expect(new JournalStore(file).get(first.date)).toEqual(first);
    expect(store.list().items).toHaveLength(1);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
  it('adds late life notes to the specified original date without replacing Codex progress', () => {
    const first = store.publish(sample());
    const next = store.publish({ date: first.date, revision: first.revision, life: '在现实中完成示例练习', lifeState: 'provided', status: 'final' });
    expect(next).toMatchObject({ codex: first.codex, life: '在现实中完成示例练习', revision: 2, status: 'final', lifeState: 'provided' });
    expect(store.list().items[0]).not.toHaveProperty('life');
    expect(store.list('练习').items).toHaveLength(1);
    expect(store.list('', '2026-09').items).toEqual([]);
  });
  it('rejects stale saves and protects only the fields actually edited manually', () => {
    store.publish(sample());
    store.edit('2026-10-03', { revision: 1, codex: '用户修改的总结' });
    expect(() => store.publish({ date: '2026-10-03', revision: 1, life: 'late' })).toThrow('已更新');
    expect(() => store.publish({ date: '2026-10-03', revision: 2, codex: 'overwrite' })).toThrow('手动修改');
    const next = store.publish({ date: '2026-10-03', revision: 2, life: '用户在聊天中补充', lifeState: 'provided' });
    expect(next.codex).toBe('用户修改的总结');
    expect(next.editedFields).toEqual(['codex']);
    expect(store.edit(next.date, { revision: 3, codex: next.codex }).revision).toBe(3);
  });
  it('requires delete confirmation and preserves other dates, tasks, source chats and files', () => {
    store.publish(sample()); store.publish(sample('2026-10-04'));
    const personal = new PersonalStore(join(root, 'personal.json'));
    const task = personal.addTodo({ title: 'unrelated task' });
    const source = join(root, 'original-chat.txt'); writeFileSync(source, 'original source');
    expect(() => store.remove('2026-10-03', { revision: 1 })).toThrow('确认');
    expect(() => store.remove('2026-10-03', { revision: 0, confirmed: true })).toThrow('已更新');
    store.remove('2026-10-03', { revision: 1, confirmed: true });
    expect(store.list().items.map(item => item.date)).toEqual(['2026-10-04']);
    expect(store.trash().items[0].date).toBe('2026-10-03');
    expect(new PersonalStore(join(root, 'personal.json')).todos()).toEqual([task]);
    expect(readFileSync(source, 'utf8')).toBe('original source');
    expect(() => new JournalStore(file).publish(sample())).toThrow('已删除');
    expect(() => store.create({ date: '2026-10-03', codex: 'manual' })).toThrow('回收站');
  });
  it('restores the same date and content with a new revision and stops automatic recreation after expiry', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
    const first = store.publish(sample()); store.remove(first.date, { revision: 1, confirmed: true });
    const restored = store.restore(first.date, { revision: 1 });
    expect(restored).toMatchObject({ ...first, revision: 2 });
    store.remove(first.date, { revision: 2, confirmed: true });
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
    expect(store.trash().items).toEqual([]);
    expect(() => store.restore(first.date, { revision: 2 })).toThrow('恢复期限');
    store.publish(sample('2026-11-05'));
    expect(JSON.parse(readFileSync(file, 'utf8')).trash).toEqual([]);
    expect(() => new JournalStore(file).publish(sample())).toThrow('已删除');
    expect(store.create({ date: first.date, codex: '用户明确新建' }).revision).toBe(3);
    expect(() => store.edit(first.date, { revision: 1, codex: '来自删除前的旧页面' })).toThrow('已更新');
  });
  it('rejects invalid dates, unsupported fields, unbounded text and invalid states', () => {
    for (const date of ['2026-02-31', '../secret', '2026-13-01', '0000-01-01']) expect(() => store.publish(sample(date))).toThrow('日期');
    for (const change of [{ revision: -1 }, { revision: 1.2 }, { revision: undefined }, { title: '' }, { codex: 'x'.repeat(24001) }, { status: 'done' }, { lifeState: 'unknown' }, { lifeState: 'provided' }, { remoteUrl: 'https://example.com' }]) expect(() => store.publish({ ...sample(), ...change })).toThrow();
    expect(() => store.list('', '2026-99')).toThrow();
    expect(store.list().items).toEqual([]);
  });
  it('never resets corrupt snapshots or rewrites data while reading', () => {
    store.publish(sample()); const before = readFileSync(file, 'utf8');
    const reloaded = new JournalStore(file); reloaded.list(); reloaded.get('2026-10-03'); reloaded.trash();
    expect(readFileSync(file, 'utf8')).toBe(before);
    writeFileSync(file, '{bad json'); expect(() => new JournalStore(file)).toThrow('restore');
    expect(readFileSync(file, 'utf8')).toBe('{bad json');
    const duplicate = JSON.parse(before); duplicate.entries.push(duplicate.entries[0]); writeFileSync(file, JSON.stringify(duplicate));
    expect(() => new JournalStore(file)).toThrow('restore');
  });
});

describe('work journal HTTP boundary', () => {
  async function start() {
    server = createPersonalApp(new PersonalStore(join(root, 'personal.json')), undefined, 3456, undefined, { journal: store }).listen(0, '127.0.0.1');
    await once(server, 'listening'); const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No server port');
    return `http://127.0.0.1:${address.port}/api/personal/journal`;
  }
  it('publishes, reads, searches, removes and restores via the shared protected API', async () => {
    const url = await start();
    const send = (path: string, method: string, payload: unknown) => fetch(url + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    expect((await send('/publish', 'POST', sample())).status).toBe(200);
    const read = await fetch(url + '/2026-10-03'); expect(read.headers.get('cache-control')).toBe('no-store');
    expect(await read.json()).toMatchObject({ codex: '完成示例项目', revision: 1 });
    expect((await fetch(url + '?q=示例').then(r => r.json()) as { items: unknown[] }).items).toHaveLength(1);
    expect((await send('/2026-10-03', 'DELETE', { revision: 1, confirmed: true })).status).toBe(204);
    expect((await fetch(url + '/2026-10-03')).status).toBe(410);
    expect((await send('/publish', 'POST', sample())).status).toBe(410);
    expect((await send('/2026-10-03/restore', 'POST', { revision: 1 })).status).toBe(200);
    expect((await send('/2026-10-03', 'PATCH', { revision: 1, life: 'stale' })).status).toBe(409);
  });
  it('blocks cross-site reads/writes, non-JSON deletion and overlarge bodies', async () => {
    const url = await start();
    for (const method of ['GET', 'POST', 'DELETE']) expect((await fetch(url, { method, headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: '{}' }) })).status).toBe(403);
    expect((await fetch(url, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    expect((await fetch(url + '/2026-10-03', { method: 'DELETE' })).status).toBe(415);
    expect((await fetch(url + '/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codex: 'x'.repeat(300000) }) })).status).toBe(413);
    expect(store.list().items).toEqual([]);
  });
  it('localizes fixed errors without translating authored journal content', async () => {
    const url = await start(); store.publish({ ...sample(), title: '日记日期无效', codex: '<script>not executable</script>' });
    const invalid = await fetch(url + '/invalid', { headers: { 'Accept-Language': 'en' } });
    expect(await invalid.json()).toEqual({ message: 'The journal date is invalid.' });
    const read = await fetch(url + '/2026-10-03', { headers: { 'Accept-Language': 'en' } });
    expect(await read.json()).toMatchObject({ title: '日记日期无效', codex: '<script>not executable</script>' });
  });
});
