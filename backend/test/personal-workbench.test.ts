import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { once } from 'node:events';
import { createPersonalApp } from '../src/personal/app';
import { parseCalendarEvents, validateCalendarUrl } from '../src/personal/calendar';
import { listVaultNotes, readVaultNote } from '../src/personal/files';
import { PersonalStore } from '../src/personal/store';

let root: string;
let desktop: string;
let file: string;
let server: Server | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'personal-garden-'));
  desktop = join(root, 'Desktop');
  mkdirSync(desktop);
  file = join(root, 'data', 'personal-workbench.json');
});
afterEach(async () => {
  if (server) {
    const closing = new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closing;
    server = undefined;
  }
  rmSync(root, { recursive: true, force: true });
});

const calendar = (events: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Personal Garden//EN\r\n${events}\r\nEND:VCALENDAR`;

describe('personal workbench', () => {
  it('persists manual additions, changes and deletion independently of the legacy database', () => {
    const store = new PersonalStore(file, desktop);
    const todo = store.addTodo({ title: '  Math homework  ', dueDate: '2026-10-01' });
    expect(todo.title).toBe('Math homework');
    store.editTodo(todo.id, { done: true });
    const reloaded = new PersonalStore(file, desktop);
    expect(reloaded.todos()).toEqual([{ ...todo, done: true }]);
    reloaded.deleteTodo(todo.id);
    expect(new PersonalStore(file, desktop).todos()).toEqual([]);
    expect(() => store.addTodo({ title: 'Invalid', dueDate: '2026-02-31' })).toThrow('日期');
    expect(() => store.addTodo({ title: '', source: 'xhs' })).toThrow();
  });

  it('keeps subscription tokens write-only and rejects arbitrary network targets', () => {
    const store = new PersonalStore(file, desktop);
    const settings = store.updateSettings({ calendarUrl: 'webcal://p01-caldav.icloud.com/published/2/private-token' });
    expect(settings.calendarUrlConfigured).toBe(true);
    expect(JSON.stringify(settings)).not.toContain('private-token');
    expect(readFileSync(file, 'utf8')).toContain('private-token');
    for (const url of ['http://localhost/test', 'https://icloud.com.evil.example/feed', 'https://user:pass@icloud.com/feed', 'file:///C:/test.ics']) expect(() => validateCalendarUrl(url)).toThrow();
    const google = store.updateSettings({ calendarUrl: 'https://calendar.google.com/calendar/ical/fixture%40example.com/private-google-token/basic.ics' });
    expect(google.calendarUrlConfigured).toBe(true);
    expect(JSON.stringify(google)).not.toContain('google-token');
    expect(JSON.stringify(store.settings())).not.toContain('fixture%40example.com');
  });

  it('migrates the retired workflow once and then reads legacy tasks without rewriting data', async () => {
    const legacy = { version: 1, settings: { desktopPath: desktop, animationEnabled: false }, todos: [{ id: 'keep', title: 'Saved task', done: false, createdAt: '2026-09-26T00:00:00Z', dueDate: null }] };
    mkdirSync(join(root, 'data'));
    writeFileSync(file, JSON.stringify(legacy));
    const store = new PersonalStore(file, desktop);
    const migrated = readFileSync(file, 'utf8');
    expect(JSON.parse(migrated)).toMatchObject({ readingWorkflowVersion: 2, readingImports: [], todos: legacy.todos, settings: { animationEnabled: false } });
    expect(JSON.parse(migrated).settings).not.toHaveProperty('desktopPath');
    const readMarker = new Date('2000-01-01T00:00:00.000Z'); utimesSync(file, readMarker, readMarker);
    expect(store.settings()).not.toHaveProperty('desktopPath');
    expect(await store.state()).not.toHaveProperty('desktop');
    expect(store.todos()).toEqual(legacy.todos);
    expect(new PersonalStore(file, desktop).todos()).toEqual(legacy.todos);
    expect(readFileSync(file, 'utf8')).toBe(migrated);
    expect(statSync(file).mtime.getTime()).toBe(readMarker.getTime());
    store.updateSettings({ animationEnabled: true });
    const persisted = JSON.parse(readFileSync(file, 'utf8'));
    expect(persisted.settings).not.toHaveProperty('desktopPath');
    expect(persisted.settings.animationEnabled).toBe(true);
    expect(persisted.todos).toEqual(legacy.todos);
    expect(statSync(file).mtime.getTime()).toBeGreaterThan(readMarker.getTime());
  });

  it('reads only markdown inside a valid Obsidian vault and blocks traversal and hidden files', () => {
    const vault = join(root, 'Vault');
    mkdirSync(join(vault, '.obsidian'), { recursive: true });
    mkdirSync(join(vault, 'Course'));
    writeFileSync(join(vault, 'Course', 'Algebra.md'), '# Algebra\nA note');
    writeFileSync(join(vault, '.obsidian', 'secret.md'), 'secret');
    writeFileSync(join(root, 'outside.md'), 'outside');
    expect(listVaultNotes(vault, 'algebra').notes).toHaveLength(1);
    expect(readVaultNote(vault, 'Course/Algebra.md').content).toContain('# Algebra');
    for (const path of ['../outside.md', '.obsidian/secret.md', 'Course/../../outside.md', 'C:\\outside.md', '/outside.md']) expect(() => readVaultNote(vault, path)).toThrow();
    expect(() => readVaultNote(vault, 'Course/no-file.md')).toThrow('不存在');
  });

  it('does not follow directory junctions outside the vault', () => {
    const vault = join(root, 'Vault');
    const outside = join(root, 'Outside');
    mkdirSync(join(vault, '.obsidian'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.md'), 'do not read');
    symlinkSync(outside, join(vault, 'linked'), 'junction');
    expect(listVaultNotes(vault).notes).toEqual([]);
    expect(() => readVaultNote(vault, 'linked/secret.md')).toThrow('符号链接');
  });

  it('expands repeated Apple events through DST and applies exceptions and moved instances', async () => {
    const body = calendar(`BEGIN:VEVENT\r\nUID:class\r\nDTSTAMP:20261001T000000Z\r\nDTSTART;TZID=America/New_York:20261025T090000\r\nDTEND;TZID=America/New_York:20261025T100000\r\nRRULE:FREQ=WEEKLY;COUNT=4\r\nEXDATE;TZID=America/New_York:20261108T090000\r\nSUMMARY:Class\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:class\r\nDTSTAMP:20261001T000000Z\r\nRECURRENCE-ID;TZID=America/New_York:20261115T090000\r\nDTSTART;TZID=America/New_York:20261115T110000\r\nDTEND;TZID=America/New_York:20261115T120000\r\nSUMMARY:Moved class\r\nEND:VEVENT`);
    const events = await parseCalendarEvents(body, new Date('2026-10-24T12:00:00Z'));
    expect(events.map(event => event.start)).toEqual(['2026-10-25T13:00:00.000Z', '2026-11-01T14:00:00.000Z', '2026-11-15T16:00:00.000Z']);
    expect(events[2].title).toBe('Moved class');
  });

  it('preserves all-day dates and excludes cancelled events', async () => {
    const body = calendar(`BEGIN:VEVENT\r\nUID:day\r\nDTSTAMP:20260926T000000Z\r\nDTSTART;VALUE=DATE:20260927\r\nDTEND;VALUE=DATE:20260928\r\nSUMMARY:Day off\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:cancelled\r\nDTSTAMP:20260926T000000Z\r\nDTSTART:20260927T120000Z\r\nDTEND:20260927T130000Z\r\nSUMMARY:Cancelled\r\nSTATUS:CANCELLED\r\nEND:VEVENT`);
    const events = await parseCalendarEvents(body, new Date('2026-09-26T12:00:00Z'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ allDay: true, start: '2026-09-27', end: '2026-09-28' });
  });

  it('serves CRUD over the real HTTP API and rejects retired routes and cross-origin writes', async () => {
    const store = new PersonalStore(file, desktop);
    server = createPersonalApp(store).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server port');
    const url = `http://127.0.0.1:${address.port}`;
    const post = (path: string, body: unknown, origin?: string) => fetch(`${url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
    const response = await post('/api/personal/todos', { title: 'HTTP task' });
    expect(response.status).toBe(201);
    const todo = await response.json() as { id: string };
    const state = await fetch(`${url}/api/personal/state`).then(response => response.json()) as { todos: unknown[]; settings: Record<string, unknown> };
    expect(state.todos).toHaveLength(1);
    expect(state).not.toHaveProperty('desktop');
    expect(state.settings).not.toHaveProperty('desktopPath');
    expect((await post('/api/personal/todos', { title: 'Cross origin' }, 'https://evil.example')).status).toBe(403);
    expect((await fetch(`${url}/api/personal/todos`, { method: 'POST', body: 'title=simple-form' })).status).toBe(415);
    for (const path of ['/api/xhs/live', '/api/hotspots/status', '/api/scan/run', '/api/productivity/todos', '/api/finance/overview', '/api/settings', '/api/personal/desktop']) expect((await fetch(`${url}${path}`)).status).toBe(404);
    expect((await post('/api/personal/desktop/scan', {})).status).toBe(404);
    expect((await fetch(`${url}/api/personal/todos/${todo.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await fetch(`${url}/api/personal/finance`)).status).toBe(404);
    expect(await fetch(`${url}/api/personal/state`).then(response => response.json())).not.toHaveProperty('finance');
  });
});
