import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SupabaseSyncTransport, saveDeviceSession, supabaseDestination } from '../src/personal/supabase-sync';

let root: string;
const destination = 'https://synthetic-only.supabase.co', deviceId = randomUUID();
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dailyhouse-supabase-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
function setup(expiresAt = Date.now() + 3600000) {
  const file = join(root, 'sync-credentials.local.json');
  saveDeviceSession(file, { version: 1, destination, deviceId, deviceKey: 'a'.repeat(43), accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresAt });
  const fetcher = vi.fn<typeof fetch>();
  const transport = new SupabaseSyncTransport({ url: destination, publishableKey: 'sb_publishable_synthetic', credentialsFile: file }, deviceId, fetcher);
  return { file, fetcher, transport };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
describe('private Supabase transport with synthetic HTTP responses', () => {
  it('requires an approved hosted HTTPS origin and a publishable key', () => {
    for (const value of ['http://synthetic-only.supabase.co', 'https://evil.example', 'https://x.supabase.co/path', 'https://a:b@x.supabase.co', 'https://x.supabase.co?token=secret']) expect(() => supabaseDestination(value)).toThrow();
    expect(supabaseDestination(destination + '/')).toBe(destination);
    expect(() => new SupabaseSyncTransport({ url: destination, publishableKey: 'sb_secret_synthetic', credentialsFile: 'unused' }, deviceId)).toThrow();
  });
  it('sends owner session and device grant only to backend RPC, never privileged credentials', async () => {
    const { transport, fetcher } = setup(); fetcher.mockResolvedValue(json({ items: [], complete: true }));
    expect(await transport.pull(['todos'])).toEqual([]);
    const [url, options] = fetcher.mock.calls[0]; expect(url).toBe(destination + '/rest/v1/rpc/dailyhouse_sync_pull');
    expect(options).toMatchObject({ redirect: 'error', headers: { apikey: 'sb_publishable_synthetic', Authorization: 'Bearer synthetic-access' } });
    expect(JSON.parse(String(options?.body))).toEqual({ p_device_id: deviceId, p_device_key: 'a'.repeat(43), p_scopes: ['todos'] });
  });
  it('never treats partial or malformed remote snapshots as an empty cloud', async () => {
    const { transport, fetcher } = setup(); fetcher.mockResolvedValue(json({ items: [], complete: false }));
    await expect(transport.pull(['todos'])).rejects.toMatchObject({ status: 503 });
    fetcher.mockResolvedValue(json({ items: 'not an array', complete: true })); await expect(transport.pull(['todos'])).rejects.toMatchObject({ status: 503 });
  });
  it('fails closed before networking when credentials belong to a different device or project', async () => {
    const { transport, file, fetcher } = setup();
    const saved = JSON.parse(readFileSync(file, 'utf8')); saved.deviceId = randomUUID(); saveDeviceSession(file, saved);
    await expect(transport.pull(['todos'])).rejects.toMatchObject({ status: 403 }); expect(fetcher).not.toHaveBeenCalled();
    saved.deviceId = deviceId; saved.destination = 'https://other.supabase.co'; saveDeviceSession(file, saved);
    await expect(transport.pull(['todos'])).rejects.toMatchObject({ status: 401 }); expect(fetcher).not.toHaveBeenCalled();
  });
  it('coalesces expiring-session refreshes and persists rotated credentials on this device only', async () => {
    const { transport, fetcher, file } = setup(0);
    fetcher.mockImplementation(async url => String(url).includes('/auth/v1/token') ? json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600 }) : json({ items: [], complete: true }));
    await Promise.all([transport.pull(['todos']), transport.pull(['ideas'])]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/auth/v1/token'))).toHaveLength(1);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ accessToken: 'rotated-access', refreshToken: 'rotated-refresh', deviceId });
  });
  it('revoked-device 403 is final and does not create another grant or refresh a token', async () => {
    const { transport, fetcher } = setup(); fetcher.mockResolvedValue(json({ secret: 'never shown' }, 403));
    await expect(transport.pull(['todos'])).rejects.toMatchObject({ status: 403 }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not mislabel a record validation failure as a signed-out or revoked device', async () => {
    const { transport, fetcher } = setup(); fetcher.mockResolvedValue(json({ details: 'private' }, 400));
    await expect(transport.pull(['todos'])).rejects.toMatchObject({ status: 400 }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('refreshes a rejected access token once and preserves immutable retry operation ID', async () => {
    const { transport, fetcher } = setup(); const record = { kind: 'todo', id: randomUUID(), body: null, deletedAt: new Date().toISOString() };
    const operation = { id: randomUUID(), record, baseVersion: 2, action: 'purge' as const };
    fetcher.mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 })).mockResolvedValueOnce(json({ status: 'accepted', record: { ...record, version: 3 } }));
    await transport.push(operation);
    const bodies = fetcher.mock.calls.filter(([url]) => String(url).includes('/rpc/')).map(([, options]) => JSON.parse(String(options?.body)));
    expect(bodies[0]).toEqual(bodies[1]); expect(bodies[0].p_operation.id).toBe(operation.id);
  });
  it('sanitizes service/network errors and retains failed login credentials unchanged', async () => {
    const { transport, fetcher, file } = setup(0), before = readFileSync(file, 'utf8'); fetcher.mockResolvedValue(json({ message: 'private-account@example.invalid' }, 400));
    const failure = await transport.pull(['todos']).catch(error => error);
    expect(failure.status).toBe(401); expect(failure.message).not.toContain('@'); expect(readFileSync(file, 'utf8')).toBe(before);
    fetcher.mockRejectedValue(new Error('secret native debug output')); const offline = await transport.pull(['todos']).catch(error => error); expect(offline.status).toBe(503); expect(offline.message).not.toContain('secret');
  });
  it('rejects oversized responses before parsing and validates management responses', async () => {
    const { transport, fetcher } = setup(); fetcher.mockResolvedValue(new Response('{}', { headers: { 'content-length': String(65 * 1024 * 1024) } }));
    await expect(transport.pull(['todos'])).rejects.toMatchObject({ status: 503 });
    fetcher.mockResolvedValue(json({ deviceId: randomUUID(), name: 'wrong', scopes: ['todos'], administrator: false })); await expect(transport.probe()).rejects.toMatchObject({ status: 503 });
    fetcher.mockResolvedValue(json({ items: [{ id: deviceId, name: 'Mac', revoked: false, administrator: false, scopes: ['all'] }] })); await expect(transport.devices()).rejects.toMatchObject({ status: 503 });
  });
});
