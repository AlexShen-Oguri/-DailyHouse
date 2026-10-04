import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { PersonalError } from './types';
import { SYNC_SCOPES, type SharedRecord, type SyncDevice, type SyncOperation, type SyncResult, type SyncScope, type SyncTransport } from './sync-ledger';

export interface SupabaseSyncConfig { url: string; publishableKey: string; credentialsFile: string }
export interface DeviceSession { version: 1; destination: string; deviceId: string; deviceKey: string; accessToken: string; refreshToken: string; expiresAt: number }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function supabaseDestination(url: string): string {
  let parsed: URL; try { parsed = new URL(url); } catch { throw new Error('Invalid private Supabase URL.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname) || !['', '/'].includes(parsed.pathname) || parsed.search || parsed.hash) throw new Error('Use the HTTPS URL of your approved hosted Supabase project.');
  return parsed.origin;
}
export function validateDeviceSession(value: unknown, destination: string): DeviceSession {
  const session = value as DeviceSession;
  if (!session || typeof session !== 'object' || Object.keys(session).some(key => !['version', 'destination', 'deviceId', 'deviceKey', 'accessToken', 'refreshToken', 'expiresAt'].includes(key)) || session.version !== 1 || session.destination !== destination || !uuid.test(session.deviceId) || !/^[a-zA-Z0-9_-]{43}$/.test(session.deviceKey) || !session.accessToken || typeof session.accessToken !== 'string' || session.accessToken.length > 16000 || !session.refreshToken || typeof session.refreshToken !== 'string' || session.refreshToken.length > 4000 || !Number.isFinite(session.expiresAt)) throw new PersonalError('此设备的私人云端凭证无效，请重新授权。', 401);
  return structuredClone(session);
}
export function saveDeviceSession(file: string, session: DeviceSession) {
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error('The private credentials file must not be a symbolic link.');
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const pending = file + '.' + randomUUID() + '.tmp';
  writeFileSync(pending, JSON.stringify(session, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try { renameSync(pending, file); } finally { rmSync(pending, { force: true }); }
}
function readSession(file: string, destination: string) {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 40000 || process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error();
    return validateDeviceSession(JSON.parse(readFileSync(file, 'utf8')), destination);
  } catch { throw new PersonalError('此设备尚未完成私人云端登录或凭证文件权限不正确。', 401); }
}
/** Owner Auth session AND an out-of-band device grant. No privileged key or browser token. */
export class SupabaseSyncTransport implements SyncTransport {
  readonly destination: string;
  private refreshing?: Promise<DeviceSession>;
  constructor(private config: SupabaseSyncConfig, private deviceId: string, private fetcher: typeof fetch = fetch) {
    this.destination = supabaseDestination(config.url);
    if (!/^sb_publishable_[a-zA-Z0-9_-]+$/.test(config.publishableKey)) throw new Error('Use a publishable Supabase key, never a secret or service role key.');
  }
  private session() {
    const value = readSession(this.config.credentialsFile, this.destination);
    if (value.deviceId !== this.deviceId) throw new PersonalError('云端凭证属于另一台设备，请单独授权此设备。', 403);
    return value;
  }
  private async request(path: string, body: unknown, bearer?: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(this.destination + path, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000), headers: { apikey: this.config.publishableKey, 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) });
      if (!response.ok) {
        // SQL session/device denials use 42501, surfaced by PostgREST as 403.
        // Never forward the service response, which can contain private details.
        if (response.status === 400 && !path.startsWith('/auth/')) throw new PersonalError('私人云端拒绝了同步内容，请保留本机修改并重新检查预览。', 400);
        if ([400, 401, 403].includes(response.status)) throw new PersonalError('私人云端身份或设备授权无效，请重新登录或检查设备授权。', response.status === 400 ? 401 : response.status);
        if (response.status === 409) throw new PersonalError('同步请求发生冲突，请保留本机修改并重新预览。', 409);
        throw new PersonalError('私人云端暂时不可用，修改留在本机待同步。', 503);
      }
      const limit = 64 * 1024 * 1024;
      if (Number(response.headers.get('content-length')) > limit) throw new Error();
      if (!response.body) throw new Error();
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > limit) throw new Error(); chunks.push(next.value); } }
      finally { await reader.cancel().catch(() => undefined); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) { throw error instanceof PersonalError ? error : new PersonalError('私人云端暂时不可用，修改留在本机待同步。', 503); }
  }
  private refresh(session: DeviceSession): Promise<DeviceSession> {
    if (this.refreshing) return this.refreshing;
    const running = (async () => {
      const result = await this.request('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refreshToken }) as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!result.access_token || !result.refresh_token || !Number.isFinite(result.expires_in) || Number(result.expires_in) <= 0) throw new PersonalError('私人云端登录已失效，请在此设备重新登录。', 401);
      const next = validateDeviceSession({ ...session, accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + Number(result.expires_in) * 1000 }, this.destination);
      saveDeviceSession(this.config.credentialsFile, next); return next;
    })();
    this.refreshing = running;
    void running.finally(() => { if (this.refreshing === running) this.refreshing = undefined; }).catch(() => undefined);
    return running;
  }
  private async rpc(name: string, parameters: Record<string, unknown> = {}): Promise<unknown> {
    let session = this.session(); if (session.expiresAt <= Date.now() + 60000) session = await this.refresh(session);
    const call = () => this.request(`/rest/v1/rpc/dailyhouse_sync_${name}`, { p_device_id: session.deviceId, p_device_key: session.deviceKey, ...parameters }, session.accessToken);
    try { return await call(); }
    catch (error) { if (!(error instanceof PersonalError) || error.status !== 401) throw error; session = await this.refresh(this.session()); return call(); }
  }
  async probe() {
    const value = await this.rpc('probe') as { deviceId?: string; name?: string; scopes?: SyncScope[]; administrator?: boolean };
    if (value?.deviceId !== this.deviceId || typeof value.name !== 'string' || !Array.isArray(value.scopes) || value.scopes.some(scope => !SYNC_SCOPES.includes(scope)) || typeof value.administrator !== 'boolean') throw new PersonalError('私人云端设备验证响应无效。', 503);
    return value;
  }
  async pull(scopes: SyncScope[]): Promise<SharedRecord[]> {
    const value = await this.rpc('pull', { p_scopes: scopes }) as { items?: SharedRecord[]; complete?: boolean };
    if (value?.complete !== true || !Array.isArray(value.items) || value.items.length > 50000) throw new PersonalError('云端未返回完整同步快照，本机数据保持不变。', 503);
    return value.items;
  }
  async push(operation: SyncOperation): Promise<SyncResult> {
    const value = await this.rpc('push', { p_operation: operation }) as SyncResult;
    if (!value || !['accepted', 'conflict'].includes(value.status) || !('record' in value) || value.status === 'accepted' && !value.record) throw new PersonalError('云端没有确认同步结果。', 503);
    return value;
  }
  async devices(): Promise<SyncDevice[]> {
    const value = await this.rpc('devices') as { items?: SyncDevice[] };
    if (!Array.isArray(value?.items) || value.items.some(item => !uuid.test(item.id) || typeof item.name !== 'string' || !Array.isArray(item.scopes) || item.scopes.some(scope => !SYNC_SCOPES.includes(scope)) || typeof item.revoked !== 'boolean' || typeof item.administrator !== 'boolean')) throw new PersonalError('私人云端设备列表无效。', 503);
    return value.items;
  }
  async revoke(id: string) { if (!uuid.test(id)) throw new PersonalError('设备标识无效。'); await this.rpc('revoke', { p_target_id: id }); }
}
