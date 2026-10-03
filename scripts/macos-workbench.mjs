import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, openSync, closeSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid saved process ID.');
  try {
    return {
      started: execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim(),
      command: execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim(),
    };
  } catch (error) {
    if (error.status === 1) return null;
    throw error;
  }
}

export class MacWorkbench {
  constructor(root, { env = process.env, log = console.log } = {}) {
    this.root = realpathSync(root);
    this.env = env;
    this.log = log;
    this.runtime = join(this.root, '.runtime');
    this.entry = join(this.root, 'backend/dist/index.js');
    this.stateFile = join(this.runtime, 'backend.macos.json');
    this.node = realpathSync(process.execPath);
  }

  initialize() {
    mkdirSync(this.runtime, { recursive: true, mode: 0o700 });
    mkdirSync(join(this.root, 'backend/data'), { recursive: true, mode: 0o700 });
    const config = join(this.root, 'backend/.env.local');
    if (!existsSync(config)) copyFileSync(join(this.root, 'backend/.env.example'), config);
  }

  port() {
    const config = parseEnv(readFileSync(join(this.root, 'backend/.env.local'), 'utf8'));
    const port = Number(this.env.PORT ?? config.PORT ?? 3456);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535.');
    return port;
  }

  managed() {
    if (!existsSync(this.stateFile)) return null;
    const state = JSON.parse(readFileSync(this.stateFile, 'utf8'));
    if (state.root !== this.root || state.entry !== this.entry || typeof state.node !== 'string') throw new Error('Saved server belongs to another installation. No process was stopped.');
    const current = processIdentity(state.pid);
    if (!current) { rmSync(this.stateFile); return null; }
    const expected = `${state.node} --import tsx ${this.entry}`;
    if (state.command !== expected || current.command !== expected || !state.started || current.started !== state.started) throw new Error('Saved PID belongs to another process. No process was stopped. Check .runtime/backend.macos.json.');
    return state;
  }

  async healthy(port) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000), redirect: 'error' });
      const health = await response.json();
      return response.ok && health.ok === true && health.appVersion === readFileSync(join(this.root, 'VERSION'), 'utf8').trim();
    } catch { return false; }
  }

  async available(port) {
    await new Promise((accept, reject) => {
      const probe = createServer();
      probe.once('error', () => reject(new Error(`Port ${port} is already in use. No other process was stopped.`)));
      probe.listen(port, '127.0.0.1', () => probe.close(accept));
    });
  }

  async npm(directory, args) {
    const executable = this.env.WORKBENCH_NPM_EXECUTABLE || 'npm';
    await new Promise((accept, reject) => {
      const child = spawn(executable, args, { cwd: join(this.root, directory), env: this.env, stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? accept() : reject(new Error(`${directory}: npm ${args[0]} failed (${code}).`)));
    });
  }

  async install(runTests = false) {
    if (this.managed()) throw new Error('Stop the workbench with Stop.command before reinstalling.');
    for (const directory of ['backend', 'frontend']) {
      if (!existsSync(join(this.root, directory, 'package-lock.json'))) throw new Error(`Missing ${directory}/package-lock.json.`);
      this.log(`Installing and building ${directory}...`);
      await this.npm(directory, ['ci', '--no-audit', '--no-fund', '--cache', join(this.runtime, 'npm-cache')]);
      await this.npm(directory, ['run', 'build']);
      if (runTests) await this.npm(directory, ['test']);
    }
    this.log('Installation complete. Double-click Start.command to open 日常小院.');
  }

  async start(noBrowser = false) {
    const port = this.port();
    const url = `http://127.0.0.1:${port}/`;
    const existing = this.managed();
    if (existing) {
      if (existing.port !== port || !await this.healthy(port)) throw new Error('Saved server or PORT has changed. Run Stop.command, then Start.command.');
      this.log(`Workbench is already running: ${url}`);
      if (!noBrowser) this.open(url);
      return existing;
    }
    await this.available(port);
    if (!existsSync(this.entry) || !existsSync(join(this.root, 'backend/node_modules/tsx/package.json')) || !existsSync(join(this.root, 'frontend/dist/index.html'))) await this.install();
    const stdout = openSync(join(this.runtime, 'backend.stdout.log'), 'a', 0o600);
    const stderr = openSync(join(this.runtime, 'backend.stderr.log'), 'a', 0o600);
    let child;
    try {
      child = spawn(this.node, ['--import', 'tsx', this.entry], {
        cwd: join(this.root, 'backend'), env: { ...this.env, NODE_ENV: 'production', PORT: String(port) }, detached: true, stdio: ['ignore', stdout, stderr],
      });
      await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
    } finally { closeSync(stdout); closeSync(stderr); }
    child.unref();
    const identity = processIdentity(child.pid);
    if (!identity) throw new Error('Server exited. See .runtime/backend.stderr.log.');
    const state = { pid: child.pid, root: this.root, entry: this.entry, node: this.node, port, ...identity };
    writeFileSync(this.stateFile, JSON.stringify(state), { mode: 0o600 });
    try {
      for (let attempt = 0; attempt < 40; attempt++) {
        if (!this.managed()) break;
        if (await this.healthy(port)) {
          this.log(`Workbench started: ${url}`);
          this.log('You may close this window. Double-click Stop.command to stop the background server.');
          if (!noBrowser) this.open(url);
          return state;
        }
        await delay(250);
      }
      throw new Error('Server did not become healthy. See .runtime/backend.stderr.log.');
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  open(url) {
    try { execFileSync('/usr/bin/open', [url]); }
    catch { this.log(`Open this address in your browser: ${url}`); }
  }

  async stop() {
    const state = this.managed();
    if (!state) { this.log('Workbench is not running.'); return; }
    process.kill(state.pid, 'SIGTERM');
    for (let attempt = 0; attempt < 40; attempt++) {
      await delay(250);
      const current = processIdentity(state.pid);
      if (!current || current.command !== state.command || current.started !== state.started) {
        rmSync(this.stateFile, { force: true });
        this.log('Workbench stopped.');
        return;
      }
    }
    throw new Error('Server is still shutting down. Retry Stop.command; the saved process was kept.');
  }

  async run(action, options = []) {
    if (!['install', 'start', 'stop'].includes(action) || options.some(option => option !== (action === 'install' ? '--run-tests' : action === 'start' ? '--no-browser' : null))) throw new Error('Usage: install [--run-tests] | start [--no-browser] | stop');
    this.initialize();
    const lock = join(this.runtime, 'macos-operation.lock');
    try { mkdirSync(lock); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      throw new Error('Another install, start or stop is in progress. If it was interrupted, remove .runtime/macos-operation.lock and retry.');
    }
    try {
      if (action === 'install') return await this.install(options.includes('--run-tests'));
      if (action === 'start') return await this.start(options.includes('--no-browser'));
      await this.stop();
    } finally { rmSync(lock, { recursive: true }); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const workbench = new MacWorkbench(root);
  try { await workbench.run(process.argv[2], process.argv.slice(3)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
