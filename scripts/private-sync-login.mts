import '../backend/src/bootstrapEnv.ts';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { SupabaseSyncTransport, saveDeviceSession, supabaseDestination, validateDeviceSession } from '../backend/src/personal/supabase-sync.ts';

// Account password is read only from an interactive terminal and never persisted.
const repoDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = process.env.WORKBENCH_DATA_DIR || join(repoDirectory, 'backend/data');
const pendingFile = join(dataDirectory, 'sync-device.local.json');
const credentialsFile = join(dataDirectory, 'sync-credentials.local.json');
const deviceFile = join(dataDirectory, 'private-sync.json');
function secret(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Use an interactive terminal; do not pipe credentials or put them in arguments.');
  process.stdout.write(label); emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((accept, reject) => {
    let value = '';
    const cleanup = () => { process.stdin.off('keypress', listener); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    const listener = (character: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
      if (key?.ctrl && key.name === 'c') { cleanup(); reject(new Error('Cancelled.')); }
      else if (key?.name === 'return' || key?.name === 'enter') { cleanup(); accept(value); }
      else if (key?.name === 'backspace') value = value.slice(0, -1);
      else if (character && !key?.ctrl && !key?.meta && !/[\r\n\u0000-\u001f]/.test(character) && value.length < 4096) value += character;
    };
    process.stdin.on('keypress', listener);
  });
}
function ownJson(file: string) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 40000 || process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error('Private file permissions are invalid.');
  return JSON.parse(readFileSync(file, 'utf8'));
}
async function main() {
  if (process.argv.length > 3 || process.argv.length === 3 && process.argv[2] !== '--prepare-device') throw new Error('Supported option: --prepare-device. No passwords or tokens are accepted as arguments.');
  if (!existsSync(deviceFile)) throw new Error('Start DailyHouse once to create this device’s stable identity.');
  // The sidecar can exceed credential-file limits; only its identity is used here.
  const deviceState = JSON.parse(readFileSync(deviceFile, 'utf8'));
  const device = deviceState.device as { id: string; name: string };
  if (deviceState.version !== 1 || !/^[a-f0-9-]{36}$/i.test(device?.id) || typeof device.name !== 'string' || device.name.length > 100) throw new Error('Device identity is invalid.');
  if (process.argv[2] === '--prepare-device') {
    if (existsSync(credentialsFile)) throw new Error('This device already has credentials; revoke it before creating a different grant.');
    let pending: { version: number; deviceId: string; deviceKey: string };
    if (existsSync(pendingFile)) pending = ownJson(pendingFile);
    else { pending = { version: 1, deviceId: device.id, deviceKey: randomBytes(32).toString('base64url') }; mkdirSync(dataDirectory, { recursive: true }); writeFileSync(pendingFile, JSON.stringify(pending, null, 2), { mode: 0o600 }); }
    if (pending.deviceId !== device.id || !/^[a-zA-Z0-9_-]{43}$/.test(pending.deviceKey)) throw new Error('Device grant preparation belongs to another device.');
    console.log(JSON.stringify({ deviceId: device.id, deviceName: device.name, deviceKeySha256: createHash('sha256').update(pending.deviceKey).digest('hex') }, null, 2));
    console.log('Only the key hash is displayed. Approve this device in the private database, then run npm run sync:login. No data has been uploaded.'); return;
  }
  const url = process.env.DAILYHOUSE_SUPABASE_URL || '', key = process.env.DAILYHOUSE_SUPABASE_PUBLISHABLE_KEY || '';
  const destination = supabaseDestination(url);
  if (!/^sb_publishable_[a-zA-Z0-9_-]+$/.test(key)) throw new Error('Configure the approved project URL and publishable key in backend/.env.local.');
  const grant = existsSync(credentialsFile) ? ownJson(credentialsFile) : ownJson(pendingFile);
  if ((grant.deviceId !== device.id) || !/^[a-zA-Z0-9_-]{43}$/.test(grant.deviceKey)) throw new Error('This device has not been privately authorized.');
  if (grant.destination && grant.destination !== destination) throw new Error('Saved credentials belong to another project. Do not silently switch the cloud destination.');
  if (!process.stdin.isTTY) throw new Error('Use an interactive terminal.');
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const email: string = await new Promise(accept => terminal.question('Private owner email: ', accept)); terminal.close();
  let password = await secret('Private owner password (hidden): ');
  let response: Response;
  try { response = await fetch(destination + '/auth/v1/token?grant_type=password', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000), headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password }) }); }
  finally { password = ''; }
  if (!response.ok) throw new Error('Owner sign-in failed; no service response or password was saved.');
  const result = await response.json() as { access_token: string; refresh_token: string; expires_in: number };
  const session = validateDeviceSession({ version: 1, destination, deviceId: device.id, deviceKey: grant.deviceKey, accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + result.expires_in * 1000 }, destination);
  // Verify the server's owner + current Auth session + device grant before saving.
  const probe = await fetch(destination + '/rest/v1/rpc/dailyhouse_sync_probe', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000), headers: { apikey: key, Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_device_id: device.id, p_device_key: grant.deviceKey }) });
  if (!probe.ok || (await probe.json() as { deviceId: string }).deviceId !== device.id) throw new Error('Owner or device grant verification failed. Credentials were not replaced.');
  saveDeviceSession(credentialsFile, session);
  // No records are uploaded by login; Settings still requires a migration preview.
  await new SupabaseSyncTransport({ url, publishableKey: key, credentialsFile }, device.id).probe();
  console.log('This device is authenticated. Restart DailyHouse and inspect Settings → Private sync before approving any upload.');
}
main().catch(() => { console.error('Private sync setup did not complete. Check the approved configuration, device grant and account in your private terminal. No account details were logged.'); process.exitCode = 1; });
