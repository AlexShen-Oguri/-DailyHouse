import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalPicker, pickerScript } from '../src/personal/local-picker';

const temporary: string[] = [];
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');
afterEach(() => { temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });
describe('local file selection', () => {
  it('returns a chosen Unicode ICS path without applying any settings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'garden-picker-')); temporary.push(dir);
    const path = join(dir, '学期.ics'); writeFileSync(path, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR');
    const run = vi.fn(async () => encode({ path }));
    expect(await new LocalPicker({ platform: 'win32', run }).choose({ kind: 'calendar' })).toEqual({ path });
    expect(run.mock.calls[0][0]).toContain('Multiselect = $false');
  });
  it('returns cancellation and allows a subsequent picker', async () => {
    const run = vi.fn(async () => encode({ cancelled: true }));
    const picker = new LocalPicker({ platform: 'win32', run });
    expect(await picker.choose({ kind: 'vault' })).toEqual({ cancelled: true });
    expect(await picker.choose({ kind: 'readingTech' })).toEqual({ cancelled: true });
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('rejects caller commands and unsupported platforms before spawning', async () => {
    const run = vi.fn(); const picker = new LocalPicker({ platform: 'win32', run });
    await expect(picker.choose({ kind: 'calendar', command: 'anything' })).rejects.toMatchObject({ status: 400 });
    await expect(picker.choose({ kind: '__proto__' })).rejects.toMatchObject({ status: 400 });
    await expect(new LocalPicker({ platform: 'linux', run }).choose({ kind: 'vault' }, true)).rejects.toMatchObject({ status: 501 });
    expect(run).not.toHaveBeenCalled();
  });
  it('blocks overlapping dialogs and releases the lock after cancellation', async () => {
    let finish!: (value: string) => void;
    const run = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const picker = new LocalPicker({ platform: 'win32', run });
    const first = picker.choose({ kind: 'vault' });
    await expect(picker.choose({ kind: 'vault' })).rejects.toMatchObject({ status: 409 });
    finish(encode({ cancelled: true })); await first;
  });
  it('kills a waiting picker on abort and rejects nonlocal paths', async () => {
    const controller = new AbortController();
    const run = (_script: string, signal: AbortSignal) => new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    const promise = new LocalPicker({ platform: 'win32', run }).choose({ kind: 'vault' }, false, controller.signal);
    controller.abort(); await expect(promise).rejects.toMatchObject({ status: 499 });
    await expect(new LocalPicker({ platform: 'win32', run: async () => encode({ path: '\\\\remote\\share' }) }).choose({ kind: 'vault' })).rejects.toMatchObject({ status: 400 });
  });
  it('uses constant dialog scripts and suppresses folder creation', () => {
    expect(pickerScript('vault')).toContain('ShowNewFolderButton = $false');
    expect(pickerScript('calendar', true)).toContain('Choose a calendar ICS file');
    expect(pickerScript('calendar')).toContain('ToBase64String');
  });
});
