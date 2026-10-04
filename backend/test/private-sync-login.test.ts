import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

let directory: string;
const id = randomUUID();
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'dailyhouse-device-setup-'));
  writeFileSync(join(directory, 'private-sync.json'), JSON.stringify({ version: 1, device: { id, name: 'Synthetic Windows' } }));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function run(args: string[]) {
  return execFileSync(process.execPath, ['--import', 'tsx', resolve('../scripts/private-sync-login.mts'), ...args], {
    cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe', timeout: 15000,
    env: { ...process.env, WORKBENCH_DATA_DIR: directory, DAILYHOUSE_SUPABASE_URL: '', DAILYHOUSE_SUPABASE_PUBLISHABLE_KEY: '' },
  });
}
describe('private device setup with isolated files', () => {
  it('prepares a stable device grant without a cloud destination, credentials or printed secret', () => {
    const first = run(['--prepare-device']);
    const pending = JSON.parse(readFileSync(join(directory, 'sync-device.local.json'), 'utf8'));
    expect(pending.deviceId).toBe(id); expect(pending.deviceKey).toMatch(/^[a-zA-Z0-9_-]{43}$/);
    expect(first).toContain(createHash('sha256').update(pending.deviceKey).digest('hex'));
    expect(first).not.toContain(pending.deviceKey); expect(first).toContain('No data has been uploaded');
    expect(run(['--prepare-device'])).toBe(first);
    expect(existsSync(join(directory, 'sync-credentials.local.json'))).toBe(false);
  });
  it('rejects unexpected arguments before creating any device secret or attempting login', () => {
    expect(() => run(['--prepare-device', 'synthetic-secret-argument'])).toThrow();
    expect(() => run(['--password', 'synthetic-secret-argument'])).toThrow();
    expect(existsSync(join(directory, 'sync-device.local.json'))).toBe(false);
    expect(existsSync(join(directory, 'sync-credentials.local.json'))).toBe(false);
  });
});
