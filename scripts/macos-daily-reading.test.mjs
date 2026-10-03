import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MacDailyReading, collectionTime } from './macos-daily-reading.mjs';

async function fixture(callback) {
  const directory = mkdtempSync(join(tmpdir(), 'dailyhouse-schedule-'));
  const root = join(directory, '小院 & Garden'); mkdirSync(root);
  mkdirSync(join(root, '.runtime/node/bin'), { recursive: true }); writeFileSync(join(root, '.runtime/node/bin/node'), 'fixture');
  const commands = [], calls = [], starts = [];
  let loaded = false, now = Date.parse('2026-10-03T14:01:00Z');
  let state = { outcome: 'waiting_browser', date: '2026-10-03' };
  const exec = (file, args) => {
    commands.push({ file, args });
    if (file.endsWith('/node')) return 'v24.18.0\n';
    if (file === '/usr/bin/plutil') return execFileSync(file, args, { encoding: 'utf8' });
    if (args[0] === 'print' && !loaded) throw Object.assign(new Error('not loaded'), { status: 113 });
    if (args[0] === 'bootstrap') loaded = true;
    if (args[0] === 'bootout') loaded = false;
  };
  const helper = new MacDailyReading(root, { home: directory, uid: 501, platform: 'darwin', now: () => now, exec,
    workbench: { run: async (...args) => starts.push(args), port: () => 4567 },
    fetch: async (url, options) => { calls.push({ url, ...options }); return { ok: true, json: async () => structuredClone(state) }; },
  });
  try { await callback({ helper, directory, root, commands, calls, starts, time: value => { now = Date.parse(value); }, state: value => { state = value; } }); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test('New York 10:00 works in summer, winter and both DST transitions, independently of system timezone', () => {
  for (const [before, due, date] of [
    ['2026-10-03T13:59:59Z', '2026-10-03T14:00:00Z', '2026-10-03'],
    ['2026-01-03T14:59:59Z', '2026-01-03T15:00:00Z', '2026-01-03'],
    ['2026-03-08T13:59:59Z', '2026-03-08T14:00:00Z', '2026-03-08'],
    ['2026-11-01T14:59:59Z', '2026-11-01T15:00:00Z', '2026-11-01'],
  ]) {
    assert.deepEqual(collectionTime(Date.parse(before)), { due: false, date });
    assert.deepEqual(collectionTime(Date.parse(due)), { due: true, date });
  }
  assert.deepEqual(collectionTime(Date.parse('2026-10-04T02:00:00Z')), { date: '2026-10-03', due: true });
});

test('agent installs only this checkout, starts at login and checks each minute; removing it preserves all data', async () => {
  await fixture(async ({ helper, commands, root }) => {
    const data = join(root, 'personal-fixture.json'); writeFileSync(data, 'preserve');
    assert.equal(helper.enable().loaded, true);
    const plist = readFileSync(helper.agentFile, 'utf8');
    assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
    assert.match(plist, /<key>StartInterval<\/key><integer>60<\/integer>/);
    assert.match(plist, /小院 &amp; Garden/);
    assert.ok(plist.includes(helper.node.replace('&', '&amp;')));
    const count = commands.filter(command => command.args[0] === 'bootstrap').length;
    helper.enable(); assert.equal(commands.filter(command => command.args[0] === 'bootstrap').length, count);
    assert.equal(helper.disable().installed, false); assert.equal(existsSync(helper.agentFile), false);
    assert.equal(readFileSync(data, 'utf8'), 'preserve');
    helper.disable();
    assert.ok(commands.filter(command => command.args[0] === 'bootout').every(command => command.args[1] === helper.target));
  });
});

test('foreign and symlink launch agents are neither overwritten nor deleted', async () => {
  await fixture(async ({ helper, directory }) => {
    mkdirSync(dirname(helper.agentFile), { recursive: true });
    writeFileSync(helper.agentFile, '<plist>foreign</plist>');
    assert.throws(() => helper.enable(), /another installation/); assert.throws(() => helper.disable(), /another installation/);
    assert.equal(readFileSync(helper.agentFile, 'utf8'), '<plist>foreign</plist>');
    rmSync(helper.agentFile); const target = join(directory, 'foreign.plist'); writeFileSync(target, helper.plist()); symlinkSync(target, helper.agentFile);
    assert.throws(() => helper.disable(), /not a managed file/); assert.equal(existsSync(target), true);
  });
});

test('before 10:00 does not start a service or browser; a late login waits for the extension and opens Chrome once', async () => {
  await fixture(async ({ helper, commands, calls, starts, time, state }) => {
    time('2026-10-03T13:59:59Z'); assert.equal((await helper.check()).outcome, 'before_time');
    assert.equal(starts.length + calls.length + commands.length, 0);
    time('2026-10-03T18:00:00Z'); await helper.check(); await helper.check();
    assert.equal(commands.filter(command => command.file === '/usr/bin/open').length, 1);
    assert.deepEqual(commands.find(command => command.file === '/usr/bin/open').args, ['-b', 'com.google.Chrome', 'http://127.0.0.1:4567/#/reading']);
    assert.ok(starts.every(args => JSON.stringify(args) === '["start",["--no-browser"]]'));
    state({ outcome: 'started', date: '2026-10-03' }); await helper.check();
    const count = calls.length; await helper.check(); assert.equal(calls.length, count);
    time('2026-10-04T14:10:00Z'); state({ outcome: 'waiting_browser', date: '2026-10-04' }); await helper.check();
    assert.equal(commands.filter(command => command.file === '/usr/bin/open').length, 2);
    assert.ok(calls.every(call => call.url === 'http://127.0.0.1:4567/api/personal/reading/collection/daily' && call.redirect === 'error'));
  });
});

test('adopts today’s heartbeat/manual attempt without opening Chrome and remembers it across checker restarts', async () => {
  await fixture(async ({ helper, commands, calls, state }) => {
    state({ outcome: 'already_started', date: '2026-10-03' });
    await helper.check(); assert.equal(commands.length, 0); assert.equal(calls.at(-1).method, 'POST');
    const count = calls.length; await helper.check(); assert.equal(calls.length, count);
    assert.deepEqual(JSON.parse(readFileSync(helper.browserFile, 'utf8')), { version: 1, date: '2026-10-03', attempted: true });
  });
});

test('first login on a later morning catches the last missed 10:00 once, then collects the new day after 10:00', async () => {
  await fixture(async ({ helper, time, state, calls }) => {
    helper.enable(); time('2026-10-05T12:00:00Z');
    state({ outcome: 'started', date: '2026-10-04' });
    assert.equal((await helper.check()).date, '2026-10-04');
    assert.equal(calls.at(-1).body, '{"catchUp":true}');
    assert.ok(calls.at(-1).url.endsWith('/daily?catchUp=true'));
    const count = calls.length; await helper.check(); assert.equal(calls.length, count);
    time('2026-10-05T14:00:00Z'); state({ outcome: 'started', date: '2026-10-05' });
    assert.equal((await helper.check()).date, '2026-10-05'); assert.equal(calls.at(-1).body, '{}');
  });
});

test('unrelated port/start failures and older servers never trigger a fallback read or terminate processes', async () => {
  await fixture(async ({ helper, commands, calls }) => {
    helper.workbench.run = async () => { throw new Error('Port occupied'); };
    await assert.rejects(helper.check(), /Port occupied/); assert.equal(commands.length + calls.length, 0);
    helper.workbench.run = async () => {};
    helper.request = async () => ({ ok: false, status: 404 });
    await assert.rejects(helper.check(), /404.*No fallback read/); assert.equal(commands.length, 0);
  });
});
