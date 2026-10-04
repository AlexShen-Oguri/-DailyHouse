import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './journal-sync.mjs';
const originalFetch = globalThis.fetch;
const directories = [];
afterEach(() => { globalThis.fetch = originalFetch; for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function input(payload) { const dir = mkdtempSync(join(tmpdir(), 'journal-cli-')); directories.push(dir); const file = join(dir, 'journal.json'); writeFileSync(file, JSON.stringify(payload)); return file; }
test('uses only loopback and returns a new-date revision while distinguishing a deleted date', async () => {
  const output = [];
  globalThis.fetch = async (url, options) => { assert.equal(url, 'http://127.0.0.1:3456/api/personal/journal/2026-10-03'); assert.equal(options.redirect, 'error'); return Response.json({ message: '这一天尚未写日记' }, { status: 404 }); };
  await run(['read', '2026-10-03'], text => output.push(JSON.parse(text)));
  assert.equal(output[0].revision, 0); assert.equal(output[0].deleted, false);
  globalThis.fetch = async () => Response.json({ message: 'deleted' }, { status: 410 });
  await run(['read', '2026-10-03'], text => output.push(JSON.parse(text))); assert.equal(output[1].deleted, true);
});
test('does not mistake a backend without the feature for an empty journal', async () => {
  globalThis.fetch = async () => Response.json({ message: '这个功能已移除或不存在。' }, { status: 404 });
  await assert.rejects(run(['read', '2026-10-03']), /更新并重启/);
});
test('publishes through the API and reports success only after confirmation', async () => {
  const payload = { date: '2026-10-03', revision: 2, life: 'synthetic' }; const file = input(payload); const output = [];
  globalThis.fetch = async (url, options) => { assert.equal(url, 'http://127.0.0.1:3456/api/personal/journal/publish'); assert.deepEqual(JSON.parse(options.body), payload); return Response.json({ date: payload.date, revision: 3, status: 'final' }); };
  await run(['publish', '--input', file], value => output.push(JSON.parse(value))); assert.deepEqual(output[0], { ok: true, date: '2026-10-03', revision: 3, status: 'final', url: 'http://127.0.0.1:3456/#/journal/2026-10-03' });
  globalThis.fetch = async () => Response.json({ message: 'conflict' }, { status: 409 });
  await assert.rejects(run(['publish', '--input', file]), /HTTP 409/);
  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(run(['publish', '--input', file]), /尚未确认保存/);
});
test('rejects remote destinations and oversized inputs before connecting', async () => {
  globalThis.fetch = async () => { throw new Error('must not connect'); };
  await assert.rejects(run(['read', '2026-10-03', '--port', 'https://example.com']), /本机端口/);
  const file = input({ codex: 'x'.repeat(300000) }); await assert.rejects(run(['publish', '--input', file]), /256 KB/);
});
