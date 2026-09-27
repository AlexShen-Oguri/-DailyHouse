import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import ReadingAttachment from './ReadingAttachment';

it('previews literal text safely, retries failure, and aborts when closed or unmounted', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const source = '<script>globalThis.previewExecuted = true</script>\n# A Markdown heading';
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, headers: new Headers(), arrayBuffer: async () => new TextEncoder().encode(source).buffer });
  vi.stubGlobal('fetch', fetchMock);
  const button = (label: string) => [...host.querySelectorAll('button')].find(node => node.textContent === label)!;
  try {
    await act(async () => root.render(<ReadingAttachment attachment={{ id: 'one', name: 'notes.md', size: 80, mime: 'text/plain', extension: '.md', url: '/api/personal/reading/one/attachment', downloadUrl: '/download' }}/>));
    await act(async () => button('打开文件').click()); expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => button('重试预览').click()); expect(host.querySelector('pre')?.textContent).toBe(source); expect(host.querySelector('script')).toBeNull(); expect((globalThis as Record<string, unknown>).previewExecuted).toBeUndefined();
    await act(async () => button('关闭预览').click()); expect(host.querySelector('pre')).toBeNull(); expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await act(async () => button('打开文件').click()); expect(host.querySelector('[role="status"]')?.textContent).toContain('正在读取');
    await act(async () => button('关闭预览').click()); expect(fetchMock.mock.calls[2][1].signal.aborted).toBe(true); expect(host.querySelector('section')).toBeNull();
    await act(async () => button('打开文件').click()); await act(async () => root.unmount()); expect(fetchMock.mock.calls[3][1].signal.aborted).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
