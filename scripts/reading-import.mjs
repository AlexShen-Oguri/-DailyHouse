#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const usage = `DailyHouse reading import (local service must be running)
  node scripts/reading-import.mjs preview <history.json> [--port 3456]
  node scripts/reading-import.mjs apply <history.json> [--port 3456]
  node scripts/reading-import.mjs history [--port 3456]
  node scripts/reading-import.mjs undo <batch-id> [--port 3456]

preview never imports. apply revalidates and imports eligible candidates.
Input is browser-observed history, not a browser cookie or account export.
All data writes go through the workbench API; this command never edits its database.
See docs/reading-import.md for the input format and classification rules.`;

export async function run(argv, output = console.log) {
  if (!argv.length || argv.includes('--help')) { output(usage); return; }
  const args = [...argv];
  let port = '3456';
  const portIndex = args.indexOf('--port');
  if (portIndex !== -1) { port = args[portIndex + 1]; args.splice(portIndex, 2); }
  if (!/^\d+$/.test(port || '') || Number(port) < 1 || Number(port) > 65535) throw new Error('Use a local port from 1 to 65535.');
  const [command, argument] = args;
  if (!['preview', 'apply', 'history', 'undo'].includes(command) || args.length !== (command === 'history' ? 1 : 2) || (command !== 'history' && !argument)) throw new Error(usage);
  const base = `http://127.0.0.1:${Number(port)}/api/personal/reading`;
  async function api(path, method = 'GET', body) {
    let response;
    try {
      response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'Accept-Language': 'zh-CN' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000), redirect: 'error' });
    } catch { throw new Error('Cannot reach the local workbench. Start it and check the port; no database files were changed by this CLI.'); }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Workbench rejected the request (${response.status}): ${result.message || 'Unknown error'}`);
    return result;
  }
  if (command === 'history') { output(JSON.stringify(await api('/imports'), null, 2)); return; }
  if (command === 'undo') {
    if (argument.length > 200 || /[\u0000-\u0020\u007f]/.test(argument)) throw new Error('Invalid batch ID.');
    output(JSON.stringify(await api(`/imports/${encodeURIComponent(argument)}/undo`, 'POST', {}), null, 2)); return;
  }
  const input = resolve(argument);
  const info = await stat(input);
  if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error('Choose a JSON file no larger than 2 MB.');
  let payload;
  try { payload = JSON.parse((await readFile(input, 'utf8')).replace(/^\uFEFF/, '')); } catch { throw new Error('The history file must contain valid JSON.'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.items)) throw new Error('Expected an object with an items array.');
  const preview = await api('/imports/preview', 'POST', payload);
  if (command === 'preview') { output(JSON.stringify(preview, null, 2)); return; }
  // Server-side commit checks the time window and current user state again.
  // A preview is evidence for review, never authority to overwrite newer edits.
  output(JSON.stringify(await api('/imports', 'POST', payload), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
