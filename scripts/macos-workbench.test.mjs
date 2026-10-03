import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { MacWorkbench, processIdentity } from './macos-workbench.mjs';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
async function fixture(t, options = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), '小院 launcher ')));
  mkdirSync(join(root, 'backend/dist'), { recursive: true });
  mkdirSync(join(root, 'frontend/dist'), { recursive: true });
  symlinkSync(join(repo, 'backend/node_modules'), join(root, 'backend/node_modules'), 'dir');
  writeFileSync(join(root, 'frontend/dist/index.html'), '<!doctype html>');
  writeFileSync(join(root, 'VERSION'), 'fixture');
  const probe = createServer();
  await new Promise(accept => probe.listen(0, '127.0.0.1', accept));
  const port = probe.address().port;
  await new Promise(accept => probe.close(accept));
  writeFileSync(join(root, 'backend/.env.example'), `PORT="${port}" # quoted dotenv value\n`);
  writeFileSync(join(root, 'backend/dist/index.js'), `
    const { createServer } = require('node:http');
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, appVersion: 'fixture' }));
    });
    server.listen(Number(process.env.PORT), '127.0.0.1');
    process.on('SIGTERM', () => server.close());
  `);
  const opened = [], messages = [];
  const workbench = new MacWorkbench(root, { env: { ...process.env, PORT: undefined }, log: message => messages.push(message), openBrowser: (...args) => opened.push(args), ...options });
  t.after(async () => {
    await workbench.run('stop');
    rmSync(root, { recursive: true, force: true });
  });
  return { workbench, root, port, opened, messages };
}

test('opens Chrome for both first start and service reuse, respecting --no-browser', async t => {
  const { workbench, port, opened } = await fixture(t);
  const first = await workbench.run('start');
  const repeated = await workbench.run('start');
  assert.equal(first.pid, repeated.pid);
  assert.deepEqual(opened, Array(2).fill(['/usr/bin/open', ['-b', 'com.google.Chrome', `http://127.0.0.1:${port}/`]]));
  await workbench.run('start', ['--no-browser']);
  assert.equal(opened.length, 2);
});

test('keeps the healthy server available when Chrome cannot be opened', async t => {
  const { workbench, port, messages } = await fixture(t, { openBrowser: () => { throw new Error('Chrome missing'); } });
  await workbench.run('start');
  assert.equal(await workbench.healthy(port), true);
  assert.ok(messages.includes(`Could not open Google Chrome. Open this address in Chrome: http://127.0.0.1:${port}/`));
});

test('starts once from a spaced Unicode path, preserves config and stops its detached server', async t => {
  const { workbench, root, port } = await fixture(t);
  const first = await workbench.run('start', ['--no-browser']);
  assert.equal(await workbench.healthy(port), true);
  const repeated = await workbench.run('start', ['--no-browser']);
  assert.equal(first.pid, repeated.pid);
  await assert.rejects(workbench.run('install'), /Stop the workbench/);
  const localConfig = readFileSync(join(root, 'backend/.env.local'), 'utf8');
  await workbench.run('stop');
  assert.equal(existsSync(workbench.stateFile), false);
  assert.equal(await workbench.healthy(port), false);
  assert.equal(readFileSync(join(root, 'backend/.env.local'), 'utf8'), localConfig);
  await workbench.run('stop');
});

test('refuses an occupied port and leaves the unrelated listener running', async t => {
  const { workbench, port } = await fixture(t);
  const other = createServer();
  await new Promise(accept => other.listen(port, '127.0.0.1', accept));
  try {
    await assert.rejects(workbench.run('start', ['--no-browser']), /already in use/);
    assert.equal(other.listening, true);
    assert.equal(existsSync(workbench.stateFile), false);
  } finally { await new Promise(accept => other.close(accept)); }
});

test('a launchd-style C locale can safely reuse and stop a server with a Chinese project path', async t => {
  const { workbench, root, port } = await fixture(t);
  const first = await workbench.run('start', ['--no-browser']);
  const module = pathToFileURL(join(repo, 'scripts/macos-workbench.mjs')).href;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { MacWorkbench, processIdentity } from ${JSON.stringify(module)};
    const workbench = new MacWorkbench(${JSON.stringify(root)}, { log: () => {} });
    const identity = processIdentity(${first.pid});
    const reused = await workbench.run('start', ['--no-browser']);
    await workbench.run('stop');
    console.log(JSON.stringify({ identity, pid: reused.pid }));
  `], { encoding: 'utf8', env: { ...process.env, LANG: 'C', LC_ALL: 'C' } });
  const result = JSON.parse(output);
  assert.equal(result.pid, first.pid); assert.equal(result.identity.command, first.command);
  assert.equal(result.identity.started, first.started); assert.equal(await workbench.healthy(port), false);
});

test('never signals a PID whose command differs from the recorded server', async t => {
  const { workbench, port } = await fixture(t);
  workbench.initialize();
  writeFileSync(workbench.stateFile, JSON.stringify({
    pid: process.pid, root: workbench.root, entry: workbench.entry, node: workbench.node,
    port, ...processIdentity(process.pid),
  }));
  try {
    await assert.rejects(workbench.run('stop'), /another process/);
    assert.equal(process.kill(process.pid, 0), true);
    assert.equal(existsSync(workbench.stateFile), true);
  } finally { rmSync(workbench.stateFile); }
});

test('rejects invalid ports and concurrent operations without changing local config', async t => {
  const { workbench, root } = await fixture(t);
  workbench.initialize();
  for (const port of ['0', '1023', '65536', '3456.5', 'oops', '']) {
    writeFileSync(join(root, 'backend/.env.local'), `PORT=${port}\n`);
    await assert.rejects(workbench.run('start', ['--no-browser']), /PORT must/);
  }
  mkdirSync(join(workbench.runtime, 'macos-operation.lock'));
  try { await assert.rejects(workbench.run('stop'), /in progress/); }
  finally { rmSync(join(workbench.runtime, 'macos-operation.lock'), { recursive: true }); }
  assert.equal(readFileSync(join(root, 'backend/.env.local'), 'utf8'), 'PORT=\n');
});
