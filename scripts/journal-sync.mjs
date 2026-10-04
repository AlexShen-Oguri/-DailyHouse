#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const usage = `DailyHouse work journal (start the local service first)
  node scripts/journal-sync.mjs read YYYY-MM-DD [--port 3456]
  node scripts/journal-sync.mjs publish --input .runtime/journal-pending.local.json [--port 3456]

read returns the saved page and revision, or revision 0 for a new date.
publish accepts JSON {date, revision, title?, codex?, life?, reflection?, status?, lifeState?}.
It updates the same date through the local API, preserving manual edits and deletion.
No raw chat export, credentials, direct database writes or remote destinations.`;

export async function run(argv, output = console.log) {
  if (!argv.length || (argv.length === 1 && ['--help', '-h'].includes(argv[0]))) { output(usage); return; }
  const args = [...argv];
  let port = '3456';
  const portIndex = args.indexOf('--port');
  if (portIndex !== -1) { port = args[portIndex + 1]; args.splice(portIndex, 2); }
  if (!/^\d+$/.test(port || '') || Number(port) < 1 || Number(port) > 65535) throw new Error('请使用有效本机端口；日记不接受远程上传地址。');
  const [command, option, inputFile] = args;
  let payload;
  if (command === 'read') {
    if (args.length !== 2 || !/^\d{4}-\d{2}-\d{2}$/.test(option ?? '')) throw new Error(usage);
  } else if (command === 'publish') {
    if (args.length !== 3 || option !== '--input' || !inputFile) throw new Error(usage);
    const input = statSync(inputFile);
    if (!input.isFile() || input.size > 256 * 1024) throw new Error('日记输入必须是小于 256 KB 的 JSON 文件。');
    try { payload = JSON.parse(readFileSync(inputFile, 'utf8')); } catch { throw new Error('日记输入不是有效 JSON。'); }
  } else throw new Error(usage);
  const base = `http://127.0.0.1:${Number(port)}/api/personal/journal`;
  let response;
  try {
    response = await fetch(command === 'read' ? `${base}/${option}` : `${base}/publish`, { method: command === 'read' ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Language': 'zh-CN' }, ...(command === 'publish' ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(15000), redirect: 'error' });
  } catch { throw new Error('无法连接本机小院，请先启动服务。日记尚未确认保存。'); }
  const result = await response.json().catch(() => null);
  if (command === 'read' && [404, 410].includes(response.status)) {
    // Do not mistake an old backend with no journal route for an empty date.
    if (response.status === 404 && result?.message !== '这一天尚未写日记') throw new Error('当前服务没有工作日记功能，请先更新并重启小院。');
    output(JSON.stringify({ date: option, exists: false, revision: 0, deleted: response.status === 410, message: result?.message })); return;
  }
  if (!response.ok || !result) throw new Error(`日记未保存（HTTP ${response.status}）：${result?.message ?? '无法读取服务结果'}`);
  if (result.date !== (command === 'read' ? option : payload?.date) || !Number.isSafeInteger(result.revision) || result.revision < 1 || !['draft', 'final'].includes(result.status)) throw new Error('日记保存结果未通过核对，请读取这一天的记录后重试。');
  output(JSON.stringify(command === 'read' ? { exists: true, ...result } : { ok: true, date: result.date, revision: result.revision, status: result.status, url: `http://127.0.0.1:${Number(port)}/#/journal/${result.date}` }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
