import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { run } from './reading-import.mjs';

test('preview is read-only and apply stops if the server rejects its preview', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dailyhouse-cli-'));
  const file = join(root, 'history.json');
  const payload = { items: [{ title: 'Fixture lesson', url: 'https://www.bilibili.com/video/BV1gAtm69ER4/', viewedAt: '2026-09-27T12:00:00Z', progress: 0.1 }] };
  await writeFile(file, JSON.stringify(payload));
  const calls = [];
  let rejectPreview = false;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const part of req) chunks.push(part);
    calls.push({ url: req.url, method: req.method, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') });
    const rejected = rejectPreview && req.url.endsWith('/preview');
    res.writeHead(rejected ? 400 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rejected ? { message: 'Invalid coverage' } : { counts: { import: 1 } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = String(server.address().port);
  try {
    await run(['preview', file, '--port', port], () => {});
    assert.deepEqual(calls.map(c => c.url), ['/api/personal/reading/imports/preview']);
    assert.deepEqual(calls[0].body, payload);
    calls.length = 0; rejectPreview = true;
    await assert.rejects(run(['apply', file, '--port', port], () => {}), /Invalid coverage/);
    assert.equal(calls.length, 1);
    calls.length = 0; rejectPreview = false;
    await run(['apply', file, '--port', port], () => {});
    assert.deepEqual(calls.map(c => c.url), ['/api/personal/reading/imports/preview', '/api/personal/reading/imports']);
    assert.deepEqual(calls[1].body, payload);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('dailyhouse-cli-'));
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects remote destinations and malformed input before any API request', async () => {
  await assert.rejects(run(['history', '--port', 'https://example.com'], () => {}), /local port/);
  await assert.rejects(run(['apply'], () => {}), /DailyHouse reading import/);
});
