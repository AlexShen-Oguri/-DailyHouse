#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MacWorkbench } from './macos-workbench.mjs';

const clock = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
export function collectionTime(now) {
  const parts = Object.fromEntries(clock.formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, due: Number(parts.hour) >= 10 };
}
const xml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);

/** Opt-in login/wake checker. It never reads browser credentials or launches a model itself. */
export class MacDailyReading {
  constructor(root, { home = homedir(), uid = process.getuid?.(), platform = process.platform, exec = execFileSync, now = Date.now, fetch: request = globalThis.fetch, workbench } = {}) {
    this.root = realpathSync(root); this.uid = uid; this.platform = platform;
    this.exec = exec; this.now = now; this.request = request;
    this.runtime = join(this.root, '.runtime');
    this.node = join(this.runtime, 'node/bin/node');
    this.script = join(this.root, 'scripts/macos-daily-reading.mjs');
    this.label = `com.dailyhouse.bilibili.${createHash('sha256').update(this.root).digest('hex').slice(0, 16)}`;
    this.agentFile = join(home, 'Library/LaunchAgents', `${this.label}.plist`);
    this.target = `gui/${uid}/${this.label}`;
    this.browserFile = join(this.runtime, 'daily-reading-browser.json');
    this.scheduleFile = join(this.runtime, 'daily-reading-schedule.json');
    this.workbench = workbench ?? new MacWorkbench(this.root, { log: () => {}, env: { ...process.env,
      PATH: `${join(this.runtime, 'node/bin')}:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? '/usr/bin:/bin'}`,
      WORKBENCH_NPM_EXECUTABLE: join(this.runtime, 'node/bin/npm'),
    } });
  }
  requireMac() { if (this.platform !== 'darwin' || !Number.isInteger(this.uid)) throw new Error('This daily collection helper requires a macOS login session.'); }
  plist() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${this.label}</string>
<key>ProgramArguments</key><array><string>${xml(this.node)}</string><string>${xml(this.script)}</string><string>check</string><string>--quiet</string></array>
<key>WorkingDirectory</key><string>${xml(this.root)}</string>
<key>StandardErrorPath</key><string>${xml(join(this.runtime, 'daily-reading.stderr.log'))}</string>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>60</integer>
<key>ProcessType</key><string>Background</string>
</dict></plist>
`;
  }
  owned() {
    if (!existsSync(this.agentFile)) return false;
    if (!lstatSync(this.agentFile).isFile()) throw new Error('The saved launch agent is not a managed file. Nothing was replaced or removed.');
    const saved = readFileSync(this.agentFile, 'utf8');
    if (!saved.includes(`<key>Label</key><string>${this.label}</string>`)
      || !saved.includes(`<key>WorkingDirectory</key><string>${xml(this.root)}</string>`)
      || !saved.includes(`<string>${xml(this.script)}</string>`)) throw new Error('The saved launch agent belongs to another installation. Nothing was replaced or removed.');
    return true;
  }
  loaded() {
    try { this.exec('/bin/launchctl', ['print', this.target], { stdio: 'ignore' }); return true; }
    catch (error) { if (error.status !== undefined) return false; throw error; }
  }
  enable() {
    this.requireMac(); this.owned();
    if (!existsSync(this.node) || !/^v24\./.test(this.exec(this.node, ['--version'], { encoding: 'utf8' }).trim())) throw new Error('Run Install.command first; the verified project-local Node.js 24 runtime is required.');
    mkdirSync(dirname(this.agentFile), { recursive: true });
    mkdirSync(this.runtime, { recursive: true, mode: 0o700 });
    const contents = this.plist();
    if (existsSync(this.agentFile) && readFileSync(this.agentFile, 'utf8') === contents && this.loaded()) return this.status();
    const temporary = `${this.agentFile}.tmp`;
    try {
      writeFileSync(temporary, contents, { mode: 0o600 });
      this.exec('/usr/bin/plutil', ['-lint', temporary], { stdio: 'ignore' });
      if (this.loaded()) this.exec('/bin/launchctl', ['bootout', this.target], { stdio: 'ignore' });
      renameSync(temporary, this.agentFile);
      writeFileSync(this.scheduleFile, JSON.stringify({ version: 1, enabledDate: collectionTime(this.now()).date }), { mode: 0o600 });
      this.exec('/bin/launchctl', ['enable', this.target], { stdio: 'ignore' });
      this.exec('/bin/launchctl', ['bootstrap', `gui/${this.uid}`, this.agentFile], { stdio: 'ignore' });
      if (!this.loaded()) throw new Error('The daily collection launch agent did not load. Retry Enable-DailyCollection.command.');
    } finally { rmSync(temporary, { force: true }); }
    return this.status();
  }
  disable() {
    this.requireMac();
    if (this.owned()) {
      if (this.loaded()) this.exec('/bin/launchctl', ['bootout', this.target], { stdio: 'ignore' });
      rmSync(this.agentFile);
    }
    return { installed: false, loaded: false, label: this.label };
  }
  status() { this.requireMac(); const installed = this.owned(); return { installed, loaded: installed && this.loaded(), label: this.label }; }
  async api(port, method = 'GET', catchUp = false) {
    const response = await this.request(`http://127.0.0.1:${port}/api/personal/reading/collection/daily${catchUp ? '?catchUp=true' : ''}`, {
      method, headers: { 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(catchUp ? { catchUp: true } : {}) } : {}),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Daily collection API unavailable (HTTP ${response.status}). No fallback read was started.`);
    const state = await response.json();
    if (!['before_time', 'already_started', 'active', 'waiting_browser', 'due', 'started'].includes(state.outcome)) throw new Error('Daily collection API returned an invalid state. No fallback read was started.');
    return state;
  }
  async check() {
    this.requireMac();
    const time = collectionTime(this.now());
    const dueDate = time.due ? time.date : new Date(Date.parse(`${time.date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
    let enabledDate = time.date;
    if (existsSync(this.scheduleFile)) {
      const schedule = JSON.parse(readFileSync(this.scheduleFile, 'utf8'));
      if (schedule.version !== 1 || typeof schedule.enabledDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(schedule.enabledDate)) throw new Error('Daily schedule activation state is invalid. Preserve the file before retrying.');
      enabledDate = schedule.enabledDate;
    }
    if (dueDate < enabledDate) return { outcome: 'before_time', date: time.date };
    let opened;
    if (existsSync(this.browserFile)) {
      opened = JSON.parse(readFileSync(this.browserFile, 'utf8'));
      if (opened.version !== 1 || typeof opened.date !== 'string' || (opened.attempted !== undefined && typeof opened.attempted !== 'boolean')) throw new Error('Daily browser startup state is invalid. Preserve the file before retrying.');
    }
    if (opened?.date === dueDate && opened.attempted) return { outcome: 'already_started', date: dueDate };
    // The existing launcher verifies process ownership, reuses the healthy service,
    // and refuses occupied ports. It never stops unrelated processes.
    await this.workbench.run('start', ['--no-browser']);
    const port = this.workbench.port();
    const state = await this.api(port, 'GET', !time.due);
    if (['before_time', 'active'].includes(state.outcome)) return state;
    if (state.outcome !== 'already_started' && opened?.date !== state.date) {
      this.exec('/usr/bin/open', ['-b', 'com.google.Chrome', `http://127.0.0.1:${port}/#/reading`], { stdio: 'ignore' });
      this.saveBrowser({ date: state.date });
    }
    // Waiting for the extension is not an attempt. A later check starts once it
    // connects; the service admits at most one daily attempt across both triggers.
    const result = await this.api(port, 'POST', !time.due);
    if (['started', 'already_started'].includes(result.outcome)) this.saveBrowser({ date: result.date, attempted: true });
    return result;
  }
  saveBrowser(state) {
    mkdirSync(this.runtime, { recursive: true, mode: 0o700 });
    writeFileSync(`${this.browserFile}.tmp`, JSON.stringify({ version: 1, ...state }), { mode: 0o600 });
    renameSync(`${this.browserFile}.tmp`, this.browserFile);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  const helper = new MacDailyReading(dirname(dirname(fileURLToPath(import.meta.url))));
  try {
    const [action, ...options] = process.argv.slice(2);
    if (!['enable', 'disable', 'status', 'check'].includes(action) || options.some(option => action !== 'check' || option !== '--quiet')) throw new Error('Usage: macos-daily-reading.mjs enable | disable | status | check [--quiet]');
    const result = await helper[action]();
    if (!options.includes('--quiet')) console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
