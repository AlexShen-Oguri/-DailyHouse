// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import PrivateSync from './PrivateSync';
import DevelopmentTools, { ToolDiscussion } from './DevelopmentTools';
import { PreferencesProvider } from './Preferences';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./api', async original => ({ ...(await original<typeof import('./api')>()), request: mocks.request }));
let host: HTMLDivElement; let root: Root;
const now = '2026-10-04T12:00:00Z';
const baseStatus = { mode: 'local_only', device: { id: 'windows-fixture', name: 'Fixture Windows' }, configured: false, pending: 0, conflicts: [], scopes: [] };
const basePreview = { id: 'preview-one', device: baseStatus.device, createdAt: now, scopes: ['todos'], recordCount: 0, uploadCount: 0, downloadCount: 3, conflictCount: 0, emptyDevice: true, records: [], attachmentsExcluded: [{ name: 'fixture.pdf', size: 20 }], excluded: ['credentials excluded'] };
async function mount(element: React.ReactNode) { await act(async () => root.render(<PreferencesProvider>{element}</PreferencesProvider>)); }
function button(name: string) { const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === name); if (!found) throw new Error(name); return found; }
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function change(element: HTMLTextAreaElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); }
beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); localStorage.clear(); mocks.request.mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
describe('private sync review boundaries', () => {
  it('starts with no upload scope and blocks cloud approval until configured', async () => {
    mocks.request.mockImplementation(async path => path === '/private-sync/status' ? baseStatus : path === '/private-sync/devices' ? { items: [] } : basePreview);
    await mount(<PrivateSync/>); expect(button('检查迁移预览').disabled).toBe(true); expect([...host.querySelectorAll<HTMLInputElement>('input')].every(item => !item.checked)).toBe(true);
    await click(host.querySelector('input')!); await click(button('检查迁移预览'));
    expect(mocks.request).toHaveBeenCalledWith('/private-sync/preview', 'POST', { scopes: ['todos'] }); expect(button('审阅后确认此范围').disabled).toBe(true); expect(host.textContent).toContain('空数据不会清空云端'); expect(host.textContent).toContain('fixture.pdf');
    expect(mocks.request.mock.calls.some(([path]) => path === '/private-sync/approve' || path === '/private-sync/run')).toBe(false);
    await click(button('放弃预览')); expect(host.querySelector('.private-sync-preview')).toBeNull();
  });
  it('requires a separate preview confirmation and invalidates it when scope changes', async () => {
    mocks.request.mockImplementation(async path => path === '/private-sync/status' ? { ...baseStatus, configured: true, mode: 'preview_required' } : path === '/private-sync/devices' ? { items: [] } : basePreview);
    await mount(<PrivateSync/>); await click(host.querySelector('input')!); await click(button('检查迁移预览')); await click(button('审阅后确认此范围'));
    expect(mocks.request.mock.calls.some(([path]) => path === '/private-sync/approve')).toBe(false);
    await click(button('确认同步此预览')); expect(mocks.request).toHaveBeenCalledWith('/private-sync/approve', 'POST', { previewId: 'preview-one', confirmed: true });
    await click(host.querySelectorAll('input')[1]); expect(host.querySelector('.private-sync-preview')).toBeNull();
  });
  it('keeps both conflict versions visible and confirms device revocation', async () => {
    const conflict = { id: 'c', key: 'todos:one', kind: 'todos', local: { title: 'Local draft' }, remote: { title: 'Mac draft' } };
    mocks.request.mockImplementation(async path => path === '/private-sync/status' ? { ...baseStatus, configured: true, mode: 'conflict', conflicts: [conflict] } : path === '/private-sync/devices' ? { items: [{ id: 'mac-fixture', name: 'Fixture Mac' }], canManage: true } : {});
    await mount(<PrivateSync/>); expect(host.textContent).toContain('Local draft'); expect(host.textContent).toContain('Mac draft'); await click(button('采用本机版本'));
    expect(mocks.request.mock.calls.some(([path]) => String(path).includes('/resolve'))).toBe(false); await click(button('确认处理')); expect(mocks.request).toHaveBeenCalledWith('/private-sync/conflicts/c/resolve', 'POST', { choice: 'local', confirmed: true });
    await click(button('撤销访问')); expect(mocks.request.mock.calls.some(([path]) => String(path).endsWith('/revoke'))).toBe(false); await click(button('确认撤销此设备')); expect(mocks.request).toHaveBeenCalledWith('/private-sync/devices/mac-fixture/revoke', 'POST', { confirmed: true });
  });
  it('distinguishes a missing local source from deletion and explicitly confirms removal across devices', async () => {
    const conflict = { id: 'missing', key: 'todo:one', kind: 'todo', reason: 'local_missing', local: null, remote: { body: { title: 'A saved cloud task' } } };
    mocks.request.mockImplementation(async path => path === '/private-sync/status' ? { ...baseStatus, configured: true, mode: 'conflict', conflicts: [conflict] } : path === '/private-sync/devices' ? { items: [] } : {});
    await mount(<PrivateSync/>); expect(host.textContent).toContain('本机缺失不等同删除'); expect(button('找回云端版本')).toBeDefined();
    await click(button('永久删除共享记录…')); expect(host.textContent).toContain('不能从小院回收站恢复'); expect(host.textContent).toContain('外部对话、项目目录');
    expect(mocks.request.mock.calls.some(([path]) => String(path).includes('/resolve'))).toBe(false);
    await click(button('取消')); expect(mocks.request.mock.calls.some(([path]) => String(path).includes('/resolve'))).toBe(false);
    await click(button('永久删除共享记录…')); await click(button('确认从所有设备永久删除'));
    expect(mocks.request).toHaveBeenCalledWith('/private-sync/conflicts/missing/resolve', 'POST', { choice: 'local', confirmed: true });
  });
  it('keeps conflicting source identities without offering direct overwrite', async () => {
    const conflict = { id: 'source', key: 'reading:one', kind: 'reading', reason: 'same_source', local: { title: 'Local notes' }, remote: { title: 'Remote notes' } };
    mocks.request.mockImplementation(async path => path === '/private-sync/status' ? { ...baseStatus, configured: true, mode: 'conflict', conflicts: [conflict] } : { items: [] });
    await mount(<PrivateSync/>); expect(host.textContent).toContain('不能在这里直接覆盖'); expect(host.textContent).toContain('Local notes'); expect(host.textContent).toContain('Remote notes');
    expect([...host.querySelectorAll('button')].some(node => ['采用本机版本', '采用云端版本', '手动合并'].includes(node.textContent!.trim()))).toBe(false);
    expect(mocks.request.mock.calls.some(([, method]) => method === 'POST')).toBe(false);
  });
  it('shows revoked status even when the device list is denied after self-revocation', async () => {
    let revoked = false;
    mocks.request.mockImplementation(async path => {
      if (path === '/private-sync/status') return { ...baseStatus, configured: true, mode: revoked ? 'revoked' : 'synced', lastSyncedAt: now };
      if (path === '/private-sync/devices') { if (revoked) throw new Error('403 device access revoked'); return { items: [baseStatus.device], canManage: true }; }
      if (path === '/private-sync/devices/windows-fixture/revoke') { revoked = true; return { items: [], status: 'revoked' }; }
      throw new Error('Unexpected mutation');
    });
    await mount(<PrivateSync/>); await click(button('撤销访问')); await click(button('确认撤销此设备'));
    expect(host.textContent).toContain('此设备访问已撤销'); expect(host.textContent).toContain('403 device access revoked'); expect(host.querySelector('.private-sync-devices')).toBeNull();
    expect([...host.querySelectorAll('button')].some(node => ['同步已确认的范围', '撤销访问'].includes(node.textContent!.trim()))).toBe(false);
  });
  it('updates to offline status despite device-list failure and labels the last sync as historical', async () => {
    let offline = false;
    mocks.request.mockImplementation(async path => {
      if (path === '/private-sync/status') return { ...baseStatus, configured: true, mode: offline ? 'offline' : 'synced', pending: offline ? 2 : 0, lastSyncedAt: '2026-10-01T12:00:00Z' };
      if (path === '/private-sync/devices') { if (offline) throw new Error('Cloud device list unavailable'); return { items: [baseStatus.device], canManage: true }; }
      throw new Error('Viewing status must not sync');
    });
    await mount(<PrivateSync/>); expect(host.textContent).toContain('已完成上次同步'); offline = true; await click(button('重新检查状态'));
    expect(host.textContent).toContain('云端不可用 · 本机仍可使用'); expect(host.textContent).toContain('待同步 2'); expect(host.textContent).toContain('上次同步：'); expect(host.textContent).not.toContain('已完成上次同步');
    expect(host.querySelector('.private-sync-devices')).toBeNull(); expect(mocks.request.mock.calls.some(([, method]) => method === 'POST')).toBe(false);
  });
  it('distinguishes local record count from all preview rows and allows approval while retaining conflicts', async () => {
    const preview = { ...basePreview, recordCount: 3, uploadCount: 1, downloadCount: 1, conflictCount: 1, emptyDevice: false, records: [
      { kind: 'todo', id: 'a', title: 'A local task', action: 'upload' },
      { kind: 'todo', id: 'b', title: 'A cloud task', action: 'download' },
      { kind: 'todo', id: 'c', title: 'Two edits', action: 'conflict' },
      { kind: 'todo', id: 'd', title: 'An unchanged task', action: 'unchanged' },
    ] };
    mocks.request.mockImplementation(async path => path === '/private-sync/status' ? { ...baseStatus, configured: true, mode: 'preview_required' } : path === '/private-sync/devices' ? { items: [] } : preview);
    await mount(<PrivateSync/>); await click(host.querySelector('input')!); await click(button('检查迁移预览'));
    expect(host.textContent).toContain('本机 3 条记录 · 同步预览 4 项'); expect(host.textContent).toContain('逐项检查 4 条记录'); expect(host.textContent).toContain('确认范围不会覆盖这些冲突');
    expect(button('审阅后确认此范围').disabled).toBe(false); await click(button('审阅后确认此范围')); expect(mocks.request.mock.calls.some(([path]) => path === '/private-sync/approve')).toBe(false);
    await click(button('确认同步此预览')); expect(mocks.request).toHaveBeenCalledWith('/private-sync/approve', 'POST', { previewId: 'preview-one', confirmed: true });
    expect(mocks.request.mock.calls.some(([path]) => String(path).includes('/resolve') || path === '/private-sync/run')).toBe(false);
  });
  it('reviews preserving a live cloud reading and archiving the local duplicate before resolving', async () => {
    const conflict = { id: 'duplicate', key: 'reading:local', kind: 'reading', reason: 'same_source', local: { kind: 'reading', id: 'local', body: { title: 'Local title', notes: 'Keep the latest local notes' } }, remote: { kind: 'reading', id: 'cloud', body: { title: 'Cloud title', notes: 'Cloud notes' } } };
    mocks.request.mockImplementation(async path => path === '/private-sync/status' ? { ...baseStatus, configured: true, mode: 'conflict', conflicts: [conflict] } : { items: [] });
    await mount(<PrivateSync/>); await click(button('保留云端条目并收起本机重复项'));
    expect(host.textContent).toContain('本机重复条目及其最新笔记会保留在 30 天回收站'); expect(host.textContent).toContain('已在回收站的条目保持原恢复期限'); expect(host.textContent).toContain('不会自动合并两份笔记');
    expect(mocks.request.mock.calls.some(([, method]) => method === 'POST')).toBe(false); await click(button('取消')); expect(mocks.request.mock.calls.some(([, method]) => method === 'POST')).toBe(false);
    await click(button('保留云端条目并收起本机重复项')); await click(button('确认保留云端条目并收起本机重复项'));
    expect(mocks.request).toHaveBeenCalledWith('/private-sync/conflicts/duplicate/resolve', 'POST', { choice: 'remote', confirmed: true });
  });
  it('does not offer duplicate archive for a suppression-only cloud row or expired local copy', async () => {
    const local = { kind: 'reading', id: 'local', body: { title: 'Local title' } };
    const conflicts = [
      { id: 'suppressed', key: 'reading:local', kind: 'reading', reason: 'same_source', local, remote: { kind: 'readingSuppression', id: 'https://example.com/source', body: { removedAt: now } } },
      { id: 'expired', key: 'reading:old', kind: 'reading', reason: 'same_source', local: { ...local, deletedAt: '2000-01-01T00:00:00Z', expiresAt: '2000-01-31T00:00:00Z' }, remote: { kind: 'reading', id: 'cloud', body: { title: 'Cloud title' } } },
    ];
    mocks.request.mockImplementation(async path => path === '/private-sync/status' ? { ...baseStatus, configured: true, mode: 'conflict', conflicts } : { items: [] }); await mount(<PrivateSync/>);
    expect([...host.querySelectorAll('button')].some(node => ['保留云端条目并收起本机重复项', '采用云端版本', '采用本机版本'].includes(node.textContent!.trim()))).toBe(false);
    expect(mocks.request.mock.calls.some(([, method]) => method === 'POST')).toBe(false);
  });
});
describe('native tools on this device', () => {
  it('shows missing and signed-out tools without claiming model availability', async () => {
    mocks.request.mockResolvedValue({ checkedAt: now, deviceScope: 'current_device', tools: [{ id: 'codex', state: 'not_installed', checkedAt: now, capabilities: {}, message: 'fixture missing' }, { id: 'claude', state: 'signed_out', checkedAt: now, capabilities: {}, message: 'fixture login required' }] });
    await mount(<DevelopmentTools/>); expect(host.textContent).toContain('未安装'); expect(host.textContent).toContain('未登录'); expect(host.textContent).toContain('模型访问尚未探测'); expect(host.querySelector('.is-ready')).toBeNull();
    await click(button('重新检查安装与登录')); expect(mocks.request).toHaveBeenCalledWith('/development-tools/refresh', 'POST', {});
  });
  it('previews only explicitly selected context and retains a manual clipboard fallback', async () => {
    mocks.request.mockImplementation(async path => path === '/ideas/one' ? { id: 'one', title: 'Synthetic idea', revision: 2, entries: [{ id: 'selected', content: 'Share this', createdAt: now, kind: 'note' }, { id: 'private', content: 'Keep private', createdAt: now, kind: 'note' }] } : { tool: 'claude', text: 'Share this\nA fixture question', delivery: 'clipboard_only', sent: false, createdAt: now });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    await mount(<ToolDiscussion ideaId="one"/>); expect([...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].every(item => !item.checked)).toBe(true);
    await click(host.querySelectorAll<HTMLInputElement>('input[type=radio]')[1]); await click(host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[1]); await change(host.querySelector('textarea')!, 'A fixture question'); await click(button('预览选中的讨论上下文'));
    expect(mocks.request).toHaveBeenCalledWith('/development-tools/discussion-preview', 'POST', { tool: 'claude', ideaId: 'one', revision: 2, includeTitle: false, entryIds: ['selected'], question: 'A fixture question' });
    expect(host.textContent).toContain('尚未发送'); await click(button('复制选中的上下文')); expect(host.textContent).toContain('Ctrl+C / ⌘C'); expect(document.activeElement).toBe(host.querySelector('textarea[readonly]')); expect(mocks.request.mock.calls.filter(([, method]) => method === 'POST')).toHaveLength(1);
    await click(button('清除预览')); expect(host.querySelector('textarea[readonly]')).toBeNull();
  });
});
