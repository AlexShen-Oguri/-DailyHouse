import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

export interface CodexProject { id: string; name: string; roots: { path: string }[]; updatedAt: number; metadata?: Record<string, string> }
export interface CodexThread { id: string; name?: string; preview: string; cwd: string; updatedAt: number; projectId?: string; source?: string; status?: { type: string }; turns?: unknown[] }
export interface RpcNotification { method: string; params?: any }
export interface ProjectRpc { call<T = any>(method: string, params: unknown): Promise<T>; onNotification?(listener: (notification: RpcNotification) => void): () => void; close(): void }

export function findCodexExecutable() {
  if (process.env.WORKBENCH_CODEX_EXECUTABLE) return process.env.WORKBENCH_CODEX_EXECUTABLE;
  const base = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
  if (process.platform === 'win32' && existsSync(base)) {
    const candidates = readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => join(base, d.name, 'codex.exe')).filter(existsSync).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (candidates.length) return candidates[0];
  }
  return process.platform === 'win32' ? 'codex.exe' : 'codex';
}

// Uses the installed CLI's versioned JSON-RPC protocol. No Codex database or
// desktop settings files are read or edited by the workbench.
export class CodexProjectClient implements ProjectRpc {
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private listeners = new Set<(notification: RpcNotification) => void>();
  constructor(private executable = findCodexExecutable(), private timeout = 30000) {}
  onNotification(listener: (notification: RpcNotification) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify(notification: RpcNotification) { for (const listener of this.listeners) { try { listener(notification); } catch { /* A listener cannot break the RPC transport. */ } } }
  private async connect() {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      try {
        const child = spawn(this.executable, ['app-server', '--stdio'], { windowsHide: true, stdio: 'pipe' });
        this.child = child;
        child.stderr.on('data', () => { /* CLI diagnostics can contain local context; do not expose them. */ });
        const lines = createInterface({ input: child.stdout });
        lines.on('line', line => {
          if (line.length > 8 * 1024 * 1024) return;
          try {
            const message = JSON.parse(line);
            if (message.method && message.id !== undefined) {
              // The website never approves arbitrary commands or tool prompts.
              child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Continue this approval in Codex.' } }) + '\n');
              return;
            }
            if (typeof message.method === 'string') { this.notify(message); return; }
            const request = this.pending.get(message.id);
            if (!request) return;
            clearTimeout(request.timer); this.pending.delete(message.id);
            if (message.error) request.reject(new Error(`Codex RPC ${Number(message.error.code) || 'error'}`));
            else request.resolve(message.result);
          } catch { /* Ignore non-protocol diagnostic lines. */ }
        });
        const fail = () => { lines.close(); if (this.child !== child) return; this.child = undefined; this.ready = undefined; const error = new Error('Codex local service is unavailable.'); for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear(); this.notify({ method: 'connection/closed' }); reject(error); };
        child.once('error', fail); child.once('exit', fail);
        child.stdin.on('error', fail);
        this.send('initialize', { clientInfo: { name: 'dailyhouse', title: 'DailyHouse project resume', version: '1.0.0' }, capabilities: { experimentalApi: true } }).then(() => { child.stdin.write('{"method":"initialized"}\n'); resolve(); }, reject);
      } catch { this.ready = undefined; reject(new Error('Codex local service is unavailable.')); }
    });
    try { await this.ready; } catch (error) { this.close(); throw error; }
  }
  private send<T>(method: string, params: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.child) return reject(new Error('Codex local service is unavailable.'));
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex local service timed out.')); }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(new Error('Codex connection closed.')); } });
    });
  }
  async call<T = any>(method: string, params: unknown): Promise<T> { await this.connect(); return this.send<T>(method, params); }
  close() { const child = this.child; this.child = undefined; this.ready = undefined; for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Codex connection closed.')); } this.pending.clear(); child?.kill(); }
}
