// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HashRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkflowPage from './Workflow';
import type { WorkflowDraft, WorkflowItem } from './workflow-model';

const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn() }));
vi.mock('./api', async importOriginal => ({ ...(await importOriginal<typeof import('./api')>()), request: mocks.request }));
vi.mock('./Workspace', () => ({ useWorkspace: () => ({ data: { todos: [] }, refresh: mocks.refresh }) }));

const item = (id: string, title: string, overrides: Partial<WorkflowItem> = {}): WorkflowItem => ({
  id, title, url: '', kind: 'idea', track: 'other', status: 'inbox', question: '', excerpt: '',
  notes: '', nextAction: '', resumeAt: '', readingId: null, todoId: null,
  createdAt: '2026-09-26T10:00:00Z', updatedAt: '2026-09-26T10:00:00Z', ...overrides,
});
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
let items: WorkflowItem[];
let host: HTMLDivElement;
let root: Root;
let writeFailure: string;
let clipboardDescriptor: PropertyDescriptor | undefined;
let originalUrl: string;

function button(name: string | RegExp): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll('button')).find(node => typeof name === 'string'
    ? node.textContent?.trim() === name : name.test(node.textContent?.trim() ?? ''));
  if (!result) throw new Error(`Button not found: ${String(name)}`);
  return result;
}
function control<T extends Control>(name: string): T {
  const result = Array.from(host.querySelectorAll<Control>('input, select, textarea')).find(node => {
    if (node.getAttribute('aria-label') === name) return true;
    const label = node.closest('label')?.cloneNode(true) as HTMLLabelElement | undefined;
    label?.querySelectorAll('input, select, textarea').forEach(element => element.remove());
    return label?.textContent?.trim() === name;
  });
  if (!result) throw new Error(`Control not found: ${name}`);
  return result as T;
}
function entry(title: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll<HTMLButtonElement>('.wf-list button')).find(node => node.querySelector('strong')?.textContent === title);
  if (!result) throw new Error(`Workflow item not found: ${title}`);
  return result;
}
async function click(element: HTMLElement) { await act(async () => { element.click(); }); }
async function change(element: Control, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
async function mount() { await act(async () => { root.render(<MemoryRouter><WorkflowPage/></MemoryRouter>); }); }
async function unmountForReturn() { await act(async () => { root.unmount(); }); root = createRoot(host); }
async function mountWithNavigation() {
  window.history.replaceState(null, '', '#/workflow');
  await act(async () => {
    root.render(<HashRouter><Routes>
      <Route path="/workflow" element={<WorkflowPage/>}/>
      <Route path="/todos" element={<h1>Fixture tasks page</h1>}/>
    </Routes></HashRouter>);
  });
}
const writes = () => mocks.request.mock.calls.filter(([, method]) => method && method !== 'GET');

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  writeFailure = '';
  originalUrl = window.location.href;
  sessionStorage.clear();
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  items = [
    item('paper-1', 'Attention paper', { kind: 'paper', track: 'aiml', url: 'https://arxiv.org/abs/1706.03762', question: 'Why scale attention?' }),
    item('idea-1', 'Small game prototype', { track: 'game', nextAction: 'Sketch one interaction' }),
  ];
  mocks.request.mockReset(); mocks.refresh.mockReset();
  mocks.request.mockImplementation(async (path: string, method = 'GET', body?: Partial<WorkflowDraft>) => {
    if (method === 'GET' && path === '/workflow') return { items: structuredClone(items) };
    if (writeFailure) throw new Error(writeFailure);
    if (method === 'POST' && path === '/workflow') {
      const created = item(`captured-${items.length}`, body?.title ?? '', body);
      items.unshift(created);
      return { ...created };
    }
    if (method === 'PATCH' && path.startsWith('/workflow/')) {
      const current = items.find(entry => entry.id === decodeURIComponent(path.slice('/workflow/'.length)));
      if (!current) throw new Error(`Unknown fixture item: ${path}`);
      Object.assign(current, body);
      return { ...current };
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  window.history.replaceState(null, '', originalUrl);
  sessionStorage.clear();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
  vi.restoreAllMocks();
});

describe('workflow capture', () => {
  it('suggests a video and direction locally, saves once, then opens the new record', async () => {
    await mount();
    expect(button('放入待整理').disabled).toBe(true);
    await change(control('想学或想做什么'), '机器学习里的梯度下降');
    await change(control('来源链接（可选）'), 'https://www.bilibili.com/video/BV123');
    expect(control<HTMLSelectElement>('类型').value).toBe('video');
    expect(control<HTMLSelectElement>('方向').value).toBe('aiml');
    expect(writes()).toEqual([]);
    await click(button('放入待整理'));
    expect(writes()).toEqual([['/workflow', 'POST', {
      title: '机器学习里的梯度下降', url: 'https://www.bilibili.com/video/BV123', kind: 'video', track: 'aiml',
    }]]);
    expect(control<HTMLInputElement>('想学或想做什么').value).toBe('');
    expect(control<HTMLInputElement>('来源链接（可选）').value).toBe('');
    expect(entry('机器学习里的梯度下降').getAttribute('aria-pressed')).toBe('true');
    expect(control<HTMLInputElement>('标题').value).toBe('机器学习里的梯度下降');
  });

  it('respects manual type and track choices when the title or source changes', async () => {
    await mount();
    await change(control('想学或想做什么'), 'AI reading');
    await change(control('来源链接（可选）'), 'https://youtube.com/watch?v=123');
    await change(control('类型'), 'course');
    await change(control('方向'), 'coursework');
    await change(control('想学或想做什么'), 'Game lecture');
    await change(control('来源链接（可选）'), 'https://arxiv.org/abs/123');
    expect(control<HTMLSelectElement>('类型').value).toBe('course');
    expect(control<HTMLSelectElement>('方向').value).toBe('coursework');
    await click(button('放入待整理'));
    expect(writes()[0]).toEqual(['/workflow', 'POST', {
      title: 'Game lecture', url: 'https://arxiv.org/abs/123', kind: 'course', track: 'coursework',
    }]);
  });

  it('retains failed capture input and permits retry without adding a phantom record', async () => {
    await mount();
    await change(control('想学或想做什么'), 'A small experiment');
    await change(control('来源链接（可选）'), 'https://example.org/material');
    writeFailure = 'Disk is unavailable';
    await click(button('放入待整理'));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Disk is unavailable');
    expect(control<HTMLInputElement>('想学或想做什么').value).toBe('A small experiment');
    expect(control<HTMLInputElement>('来源链接（可选）').value).toBe('https://example.org/material');
    expect(items).toHaveLength(2);
    expect(host.querySelectorAll('.wf-list li')).toHaveLength(2);
    expect(button('放入待整理').disabled).toBe(false);
    writeFailure = '';
    await click(button('放入待整理'));
    expect(items).toHaveLength(3);
    expect(entry('A small experiment')).toBeDefined();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('workflow editing and switching', () => {
  it('keeps a failed editor save available for retry without changing the stored record', async () => {
    await mount();
    await click(entry('Attention paper'));
    await change(control('学习笔记 / AI 对话后的收获'), 'I still need to understand variance.');
    await change(control('下次从哪里继续'), 'Section 3.2');
    writeFailure = 'Could not persist notes';
    await click(button('保存整理'));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not persist notes');
    expect(control<HTMLTextAreaElement>('学习笔记 / AI 对话后的收获').value).toBe('I still need to understand variance.');
    expect(control<HTMLInputElement>('下次从哪里继续').value).toBe('Section 3.2');
    expect(items[0].notes).toBe('');
    expect(host.querySelector('.wf-save-state')?.textContent).toBe('有未保存的修改');
    writeFailure = '';
    await click(button('保存整理'));
    expect(items.find(item => item.id === 'paper-1')?.notes).toBe('I still need to understand variance.');
    expect(host.querySelector('.wf-save-state')?.textContent).toBe('已保存在本机');
  });

  it('requires an explicit choice before dropping unsaved changes on item switches', async () => {
    await mount();
    await click(entry('Attention paper'));
    await change(control('学习笔记 / AI 对话后的收获'), 'Unsaved understanding');
    await click(entry('Small game prototype'));
    expect(host.querySelector('.wf-unsaved[role="alert"]')?.textContent).toContain('未保存的修改');
    expect(control<HTMLInputElement>('标题').value).toBe('Attention paper');
    await click(button('继续编辑'));
    expect(host.querySelector('.wf-unsaved')).toBeNull();
    expect(control<HTMLTextAreaElement>('学习笔记 / AI 对话后的收获').value).toBe('Unsaved understanding');
    await click(entry('Small game prototype'));
    await click(button('放弃修改并打开'));
    expect(control<HTMLInputElement>('标题').value).toBe('Small game prototype');
    expect(entry('Small game prototype').getAttribute('aria-pressed')).toBe('true');
    await click(entry('Attention paper'));
    expect(control<HTMLTextAreaElement>('学习笔记 / AI 对话后的收获').value).toBe('');
    expect(writes()).toEqual([]);
  });

  it('allows switching after a successful save and restores the saved note', async () => {
    await mount();
    await click(entry('Attention paper'));
    await change(control('学习笔记 / AI 对话后的收获'), 'Saved interpretation');
    await click(button('保存整理'));
    await click(entry('Small game prototype'));
    expect(host.querySelector('.wf-unsaved')).toBeNull();
    expect(control<HTMLInputElement>('标题').value).toBe('Small game prototype');
    await click(entry('Attention paper'));
    expect(control<HTMLTextAreaElement>('学习笔记 / AI 对话后的收获').value).toBe('Saved interpretation');
    expect(writes()).toHaveLength(1);
  });
});

describe('workflow asynchronous capture and navigation', () => {
  it('disables capture inputs during a request and protects edits made before its response arrives', async () => {
    await mount();
    await click(entry('Attention paper'));
    await change(control('想学或想做什么'), 'Delayed idea');
    let finishCapture!: (created: WorkflowItem) => void;
    mocks.request.mockImplementationOnce(() => new Promise(resolve => { finishCapture = resolve; }));
    await click(button('放入待整理'));
    for (const name of ['想学或想做什么', '来源链接（可选）', '类型', '方向']) expect(control(name).disabled).toBe(true);
    expect(button('保存中…').disabled).toBe(true);
    await click(button('保存中…'));
    expect(writes()).toHaveLength(1);
    await change(control('学习笔记 / AI 对话后的收获'), 'Typed while capture was pending');
    const created = item('delayed-idea', 'Delayed idea');
    await act(async () => { items.unshift(created); finishCapture({ ...created }); });
    expect(entry('Delayed idea')).toBeDefined();
    expect(control<HTMLInputElement>('标题').value).toBe('Attention paper');
    expect(control<HTMLTextAreaElement>('学习笔记 / AI 对话后的收获').value).toBe('Typed while capture was pending');
    expect(host.querySelector('.wf-unsaved')?.textContent).toContain('未保存的修改');
    expect(control('想学或想做什么').disabled).toBe(false);
    await click(button('继续编辑'));
    expect(control<HTMLTextAreaElement>('学习笔记 / AI 对话后的收获').value).toBe('Typed while capture was pending');
    expect(writes()).toHaveLength(1);
  });

  it('protects the currently selected draft when a delayed shelf import finishes', async () => {
    await mount();
    await click(entry('Attention paper'));
    mocks.request.mockResolvedValueOnce({ items: [{
      id: 'shelf-video', title: 'An imported video', notes: '', type: 'video', origin: 'manual',
    }], sources: [] });
    await click(button('从待读书架挑选'));
    let finishImport!: (created: WorkflowItem) => void;
    mocks.request.mockImplementationOnce(() => new Promise(resolve => { finishImport = resolve; }));
    await click(button('引入 / 打开'));
    expect(button('引入中…').disabled).toBe(true);
    await click(entry('Small game prototype'));
    await change(control('学习笔记 / AI 对话后的收获'), 'New draft after import began');
    const imported = item('imported-video', 'An imported video', { kind: 'video', readingId: 'shelf-video' });
    await act(async () => { items.unshift(imported); finishImport({ ...imported }); });
    expect(control<HTMLInputElement>('标题').value).toBe('Small game prototype');
    expect(control<HTMLTextAreaElement>('学习笔记 / AI 对话后的收获').value).toBe('New draft after import began');
    expect(host.querySelector('.wf-unsaved')?.textContent).toContain('未保存的修改');
    expect(entry('An imported video').getAttribute('aria-pressed')).toBe('false');
    await click(button('放弃修改并打开'));
    expect(control<HTMLInputElement>('标题').value).toBe('An imported video');
    expect(writes()).toEqual([['/workflow/import-reading', 'POST', { id: 'shelf-video' }]]);
  });

  it('disables collection actions while the initial load is pending or failed, then allows retry', async () => {
    let rejectLoad!: (reason: Error) => void;
    mocks.request.mockImplementationOnce(() => new Promise((_, reject) => { rejectLoad = reject; }));
    await mount();
    await change(control('想学或想做什么'), 'Waiting thought');
    expect(button('放入待整理').disabled).toBe(true);
    expect(button('从待读书架挑选').disabled).toBe(true);
    await click(button('从待读书架挑选'));
    expect(mocks.request.mock.calls).toEqual([['/workflow']]);
    await act(async () => { rejectLoad(new Error('Initial load unavailable')); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Initial load unavailable');
    expect(button('放入待整理').disabled).toBe(true);
    expect(button('从待读书架挑选').disabled).toBe(true);
    await click(button('重试'));
    expect(button('放入待整理').disabled).toBe(false);
    expect(button('从待读书架挑选').disabled).toBe(false);
    expect(control<HTMLInputElement>('想学或想做什么').value).toBe('Waiting thought');
    expect(writes()).toEqual([]);
  });

  it('keeps unsaved notes when staying and only leaves after explicitly discarding them', async () => {
    await mountWithNavigation();
    await click(entry('Attention paper'));
    await change(control('学习笔记 / AI 对话后的收获'), 'Keep until I decide');
    const tasksLink = host.querySelector<HTMLAnchorElement>('a[href="#/todos"]')!;
    expect(tasksLink).not.toBeNull();
    await click(tasksLink);
    expect(window.location.hash).toBe('#/workflow');
    expect(host.querySelector('.wf-unsaved')?.textContent).toContain('离开前请保存');
    expect(document.activeElement).toBe(host.querySelector('.wf-unsaved'));
    await click(button('留下继续编辑'));
    expect(host.querySelector('.wf-unsaved')).toBeNull();
    expect(control<HTMLTextAreaElement>('学习笔记 / AI 对话后的收获').value).toBe('Keep until I decide');
    await click(tasksLink);
    await click(button('放弃修改并离开'));
    expect(window.location.hash).toBe('#/todos');
    expect(host.querySelector('h1')?.textContent).toBe('Fixture tasks page');
    expect(items.find(item => item.id === 'paper-1')?.notes).toBe('');
    expect(writes()).toEqual([]);
    await unmountForReturn();
    await mountWithNavigation();
    expect(control<HTMLInputElement>('标题').value).toBe('Attention paper');
    expect(control<HTMLTextAreaElement>('学习笔记 / AI 对话后的收获').value).toBe('');
  });

  it('allows a saved editor to leave without a discard prompt', async () => {
    await mountWithNavigation();
    await click(entry('Attention paper'));
    await change(control('学习笔记 / AI 对话后的收获'), 'Saved before leaving');
    await click(button('保存整理'));
    await click(host.querySelector<HTMLAnchorElement>('a[href="#/todos"]')!);
    expect(window.location.hash).toBe('#/todos');
    expect(host.querySelector('h1')?.textContent).toBe('Fixture tasks page');
    expect(items.find(item => item.id === 'paper-1')?.notes).toBe('Saved before leaving');
  });
});

describe('workflow tab-local draft recovery', () => {
  it('recovers the selected item and its unsaved draft when the page is mounted again', async () => {
    await mount();
    await click(entry('Attention paper'));
    await change(control('学习笔记 / AI 对话后的收获'), 'Recover this unfinished explanation');
    await change(control('原文片段 / 字幕 / 作业要求'), 'A passage saved only in this tab');
    await unmountForReturn();
    await mount();
    expect(control<HTMLInputElement>('标题').value).toBe('Attention paper');
    expect(control<HTMLTextAreaElement>('学习笔记 / AI 对话后的收获').value).toBe('Recover this unfinished explanation');
    expect(control<HTMLTextAreaElement>('原文片段 / 字幕 / 作业要求').value).toBe('A passage saved only in this tab');
    expect(host.querySelector('.wf-save-state')?.textContent).toBe('有未保存的修改');
    expect(items[0].notes).toBe('');
    expect(writes()).toEqual([]);
    await click(button('保存整理'));
    expect(sessionStorage.getItem('dailyhouse-workflow-draft:paper-1')).toBeNull();
    await unmountForReturn();
    await mount();
    expect(control<HTMLTextAreaElement>('学习笔记 / AI 对话后的收获').value).toBe('Recover this unfinished explanation');
    expect(host.querySelector('.wf-save-state')?.textContent).toBe('已保存在本机');
  });

  it('does not resurrect a draft explicitly discarded when opening another item', async () => {
    await mount();
    await click(entry('Attention paper'));
    await change(control('学习笔记 / AI 对话后的收获'), 'Explicitly discarded note');
    await click(entry('Small game prototype'));
    await click(button('放弃修改并打开'));
    expect(sessionStorage.getItem('dailyhouse-workflow-draft:paper-1')).toBeNull();
    await unmountForReturn();
    await mount();
    expect(control<HTMLInputElement>('标题').value).toBe('Small game prototype');
    await click(entry('Attention paper'));
    expect(control<HTMLTextAreaElement>('学习笔记 / AI 对话后的收获').value).toBe('');
    expect(host.querySelector('.wf-save-state')?.textContent).toBe('已保存在本机');
    expect(writes()).toEqual([]);
  });

  it('does not restore an older draft over a record updated since the draft was captured', async () => {
    await mount();
    await click(entry('Attention paper'));
    await change(control('学习笔记 / AI 对话后的收获'), 'Old baseline draft');
    await unmountForReturn();
    const paper = items.find(item => item.id === 'paper-1')!;
    paper.updatedAt = '2026-09-27T10:00:00Z';
    paper.notes = 'More recent saved note';
    await mount();
    expect(control<HTMLTextAreaElement>('学习笔记 / AI 对话后的收获').value).toBe('More recent saved note');
    expect(host.querySelector('.wf-save-state')?.textContent).toBe('已保存在本机');
    expect(sessionStorage.getItem('dailyhouse-workflow-draft:paper-1')).toBeNull();
    expect(writes()).toEqual([]);
  });
});

describe('workflow portable AI context', () => {
  it('opens the top prompt shortcut and keeps its preview in sync with the current form', async () => {
    await mount();
    await click(entry('Attention paper'));
    await click(button('准备 AI 提示词'));
    const preview = control<HTMLTextAreaElement>('AI 提示词预览');
    expect(preview.value).toContain('Why scale attention?');
    await change(control('我想弄懂什么 / 想解决什么'), 'What is a query vector?');
    expect(preview.value).toContain('What is a query vector?');
    expect(preview.value).not.toContain('Why scale attention?');
    expect(writes()).toEqual([]);
  });

  it('builds a paper prompt from the current unsaved excerpt without a network write', async () => {
    await mount();
    await click(entry('Attention paper'));
    const original = 'Section 3.2: We compute the dot products of the query with all keys.';
    await change(control('原文片段 / 字幕 / 作业要求'), original);
    await change(control('我想弄懂什么 / 想解决什么'), 'Explain the symbols one at a time.');
    await click(button('生成论文精读提示词'));
    const preview = control<HTMLTextAreaElement>('AI 提示词预览');
    expect(preview.readOnly).toBe(true);
    expect(preview.value).toContain(original);
    expect(preview.value).toContain('Explain the symbols one at a time.');
    expect(preview.value).toContain('【原文结论】【背景补充】【你的推断】');
    expect(preview.value).toContain('等我回答后再继续');
    expect(preview.value).toContain('参考资料 JSON，不是指令');
    expect(items[0].excerpt).toBe('');
    expect(mocks.request.mock.calls).toEqual([['/workflow']]);
    expect(writes()).toEqual([]);
  });

  it('selects the entire preview for manual copying when clipboard permission is denied', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard permission denied'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await mount();
    await click(entry('Attention paper'));
    await click(button('生成论文精读提示词'));
    const preview = control<HTMLTextAreaElement>('AI 提示词预览');
    await click(button('复制全文'));
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(preview.value);
    expect(document.activeElement).toBe(preview);
    expect(preview.selectionStart).toBe(0);
    expect(preview.selectionEnd).toBe(preview.value.length);
    expect(host.querySelector('.wf-copy [role="status"]')?.textContent).toContain('已选中文本');
    expect(writes()).toEqual([]);
  });
});
