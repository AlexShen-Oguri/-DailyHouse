#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const usage = `DailyHouse reading collection（请先启动本机小院服务）
  node scripts/reading-import.mjs read [--port 3456]
  node scripts/reading-import.mjs status [--port 3456]
  node scripts/reading-import.mjs history [--port 3456]

read 发起一次读取并立即返回任务；使用 status 查看进度和结果。
浏览器扩展读取近一周的 B 站历史，由独立 Codex 对话筛选、分类并放入书架。
history 只显示最近 5 次读取。所有结果以 JSON 输出，便于定时流程使用。
不接收历史文件或人工确认列表，不直接读写个人数据库。
旧 preview / apply / undo 命令已停用。详情见 docs/reading-import.md。`;

const retired = new Set(['preview', 'apply', 'undo']);
const commands = new Set(['read', 'status', 'history']);

export async function run(argv, output = console.log) {
  if (!argv.length || (argv.length === 1 && ['--help', '-h'].includes(argv[0]))) { output(usage); return; }
  const args = [...argv];
  if (retired.has(args[0])) throw new Error(`“${args[0]}”已停用：无需预览、逐项确认或导入历史文件。请运行 node scripts/reading-import.mjs read，再用 status 查看结果；书架内容可直接移除，并从回收站恢复。`);
  let port = '3456';
  const portIndex = args.indexOf('--port');
  if (portIndex !== -1) { port = args[portIndex + 1]; args.splice(portIndex, 2); }
  if (!/^\d+$/.test(port || '') || Number(port) < 1 || Number(port) > 65535) throw new Error('请使用 1–65535 的本机端口；不接受远程地址。');
  const [command] = args;
  if (!commands.has(command) || args.length !== 1) throw new Error(usage);
  const base = `http://127.0.0.1:${Number(port)}/api/personal/reading`;
  async function api(path, method = 'GET', body) {
    let response;
    try {
      response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'Accept-Language': 'zh-CN' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000), redirect: 'error' });
    } catch { throw new Error('无法连接本机小院，请先启动服务并检查端口。本命令没有直接修改任何数据库文件。'); }
    let result;
    try { result = await response.json(); }
    catch { throw new Error(`小院返回了无法读取的结果（HTTP ${response.status}），请检查本机服务。`); }
    if (!response.ok) throw new Error(`小院未能完成请求（HTTP ${response.status}）：${typeof result?.message === 'string' ? result.message : '请检查服务状态后重试。'}`);
    return result;
  }
  const result = command === 'read' ? await api('/collection', 'POST', {})
    : await api(command === 'status' ? '/collection' : '/reads');
  output(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
