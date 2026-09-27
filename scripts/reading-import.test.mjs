import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { run } from './reading-import.mjs';

async function fixture(callback) {
  const root = await mkdtemp(join(tmpdir(), 'dailyhouse-cli-'));
  const file = join(root, 'personal.json');
  const contents = JSON.stringify({ readingItems: [{ id: 'keep', status: 'done', notes: 'Keep my notes' }] });
  await writeFile(file, contents);
  const calls = [];
  const task = { id: 'fixture-run', status: 'queued', scanned: 0 };
  let response = { status: 200, body: undefined, headers: {} };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const part of req) chunks.push(part);
    const body = Buffer.concat(chunks).toString();
    calls.push({ url: req.url, method: req.method, body, host: req.headers.host });
    const result = req.method === 'POST' ? task : req.url.endsWith('/reads') ? { items: [task] } : { run: task, bridge: { connected: true } };
    res.writeHead(response.status, { 'Content-Type': 'application/json', ...response.headers });
    res.end(response.body ?? JSON.stringify(result));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = String(server.address().port);
  try {
    await callback({ root, file, calls, task, port, respond: value => { response = value; } });
    assert.deepEqual(await readdir(root), ['personal.json']);
    assert.equal(await readFile(file, 'utf8'), contents, 'the CLI must not rewrite personal data');
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('dailyhouse-cli-'));
    await rm(root, { recursive: true, force: true });
  }
}

test('read requests one run and returns immediately; status/history only read the new endpoints', async () => {
  await fixture(async ({ calls, task, port }) => {
    const output = [];
    await run(['read', '--port', port], value => output.push(JSON.parse(value)));
    assert.deepEqual(output, [task]);
    assert.deepEqual(calls, [{ url: '/api/personal/reading/collection', method: 'POST', body: '{}', host: `127.0.0.1:${port}` }]);
    await run(['status', '--port', port], value => output.push(JSON.parse(value)));
    await run(['history', '--port', port], value => output.push(JSON.parse(value)));
    assert.deepEqual(calls.slice(1).map(({ url, method, body }) => ({ url, method, body })), [
      { url: '/api/personal/reading/collection', method: 'GET', body: '' },
      { url: '/api/personal/reading/reads', method: 'GET', body: '' },
    ]);
    assert.deepEqual(output.slice(1), [{ run: task, bridge: { connected: true } }, { items: [task] }]);
  });
});

test('retired commands and file/confirmation arguments fail before any request or data access', async () => {
  await fixture(async ({ file, calls, port }) => {
    for (const command of ['preview', 'apply', 'undo']) {
      await assert.rejects(run([command, file, '--port', port], () => {}), /已停用.*reading-import\.mjs read/u);
    }
    for (const args of [['read', file], ['read', '--acceptedUrls', 'https://example.com'], ['status', '{}'], ['history', '--port', port, '--port', port], ['read', '--help']]) {
      await assert.rejects(run([...args, ...(args.includes('--port') ? [] : ['--port', port])], () => {}), /DailyHouse reading collection/u);
    }
    assert.deepEqual(calls, []);
  });
});

test('rejects remote destinations and malformed ports; help does not start a read', async () => {
  await fixture(async ({ port, calls }) => {
    for (const value of ['https://example.com', '0', '65536', '-1', '3456/path', '3456.5']) {
      await assert.rejects(run(['read', '--port', value], () => {}), /本机端口/u);
    }
    await assert.rejects(run(['read', '--port'], () => {}), /本机端口/u);
    await assert.rejects(run(['unknown', '--port', port], () => {}), /DailyHouse reading collection/u);
    for (const args of [[], ['--help'], ['-h']]) {
      const output = []; await run(args, value => output.push(value));
      assert.equal(output.length, 1); assert.match(output[0], /最近 5 次读取/u);
    }
    assert.deepEqual(calls, []);
  });
});

test('reports API failure without claiming success or retrying the read', async () => {
  await fixture(async ({ calls, port, respond }) => {
    respond({ status: 503, body: JSON.stringify({ message: '请先登录 B 站' }) });
    const output = [];
    await assert.rejects(run(['read', '--port', port], value => output.push(value)), /503.*请先登录 B 站/u);
    assert.equal(calls.length, 1); assert.deepEqual(output, []);
    respond({ status: 200, body: '<html>Wrong service</html>' });
    await assert.rejects(run(['status', '--port', port], () => {}), /无法读取的结果/u);
    respond({ status: 302, headers: { Location: `http://127.0.0.1:${port}/must-not-follow` }, body: '{}' });
    await assert.rejects(run(['read', '--port', port], () => {}), /无法连接本机小院/u);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(call => !call.url.includes('must-not-follow')));
  });
});
