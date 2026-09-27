// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Ideas from './Ideas';
import IdeaDetail from './IdeaDetail';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./api', async original => ({ ...(await original<typeof import('./api')>()), request: mocks.request }));

type Entry = { id: string; kind: 'initial' | 'note' | 'progress' | 'decision' | 'question'; content: string; createdAt: string; updatedAt: string };
type Idea = { id: string; title: string; status: 'growing' | 'parked' | 'done'; createdAt: string; updatedAt: string; revision: number; entries: Entry[] };
type Mutation = { title?: string; status?: Idea['status']; content?: string; kind?: Entry['kind']; revision?: number };
const entry = (id: string, content: string, kind: Entry['kind'] = 'initial', date = '2026-09-27T12:00:00Z'): Entry => ({ id, kind, content, createdAt: date, updatedAt: date });
const idea = (id: string, title: string, content: string): Idea => ({ id, title, status: 'growing', createdAt: '2026-09-27T12:00:00Z', updatedAt: '2026-09-27T12:00:00Z', revision: 1, entries: [entry(`${id}-initial`, content)] });
let records: Idea[];
let trash: { idea: Idea; deletedAt: string; expiresAt: string }[];
let host: HTMLDivElement;
let root: Root;
let failure: string;
let sequence: number;
let testRun = 0;

function button(name: string | RegExp, scope: ParentNode = host) {
  const match = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(node => {
    const value = node.getAttribute('aria-label') || node.textContent?.trim() || '';
    return typeof name === 'string' ? value === name : name.test(value);
  });
  if (!match) throw new Error(`Button not found: ${String(name)}`);
  return match;
}
function control<T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(name: string, scope: ParentNode = host): T {
  const match = Array.from(scope.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')).find(node => {
    if (node.getAttribute('aria-label') === name) return true;
    return Array.from(node.labels ?? []).some(label => label.textContent?.trim() === name || label.querySelector('span')?.textContent?.trim() === name || Array.from(label.childNodes).filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent).join('').trim() === name);
  });
  if (!match) throw new Error(`Control not found: ${name}`);
  return match as T;
}
async function click(element: HTMLElement) { await act(async () => { element.click(); }); }
async function change(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
function Location() { return <output data-location>{useLocation().pathname}</output>; }
async function mount(path = '/ideas') {
  await act(async () => {
    const initial = path === '/ideas/one' ? `/ideas/one-${testRun}` : path === '/ideas/two' ? `/ideas/two-${testRun}` : path;
    root.render(<MemoryRouter initialEntries={[initial]}><Location/><nav aria-label="test navigation"><Link to="/ideas" data-go="list">List</Link><Link to={`/ideas/one-${testRun}`} data-go="one">One</Link><Link to={`/ideas/two-${testRun}`} data-go="two">Two</Link></nav><Routes><Route path="/ideas" element={<Ideas/>}/><Route path="/ideas/:id" element={<IdeaDetail/>}/></Routes></MemoryRouter>);
  });
}
const navigate = async (to: string) => click(host.querySelector<HTMLAnchorElement>(`[data-go="${to}"]`)!);
const writes = () => mocks.request.mock.calls.filter(([, method]) => method && method !== 'GET');

async function serve(path: string, method = 'GET', body?: Mutation) {
  if (method === 'GET' && path === '/ideas') return { items: records.map(({ entries, ...record }) => ({ ...record, entryCount: entries.length, preview: entries[entries.length - 1]?.content.slice(0, 100) ?? '' })) };
  if (method === 'GET' && path === '/ideas/trash') return { items: trash.map(({ idea: { entries, ...record }, deletedAt, expiresAt }) => ({ ...record, entryCount: entries.length, preview: entries[entries.length - 1]?.content.slice(0, 100) ?? '', deletedAt, expiresAt })) };
  const [, id, , entryId] = path.slice(1).split('/');
  const current = records.find(record => record.id === id);
  if (method === 'GET' && current) return structuredClone(current);
  if (failure) throw new Error(failure);
  if (method === 'POST' && path === '/ideas') {
    const created = idea(`new-${testRun}`, body!.title!, body!.content!); records.push(created); return structuredClone(created);
  }
  if (method === 'POST' && path.endsWith('/restore')) {
    const deleted = trash.find(item => item.idea.id === id);
    if (!deleted) throw new Error('Deleted idea not found');
    deleted.idea.revision += 1;
    records.push(deleted.idea); trash = trash.filter(item => item.idea.id !== id);
    return structuredClone(deleted.idea);
  }
  if (!current) throw new Error('Idea not found');
  if (body?.revision !== current.revision) throw new Error('This idea changed in another window. Refresh before saving.');
  if (method === 'DELETE' && !path.includes('/entries')) {
    trash.push({ idea: structuredClone(current), deletedAt: '2026-09-27T12:00:00Z', expiresAt: '2026-10-27T12:00:00Z' });
    records = records.filter(record => record.id !== current.id); return undefined;
  }
  if (path.includes('/entries')) {
    if (method === 'POST') current.entries.push(entry(`update-${++sequence}`, body!.content!, body!.kind!, `2026-09-27T${String(12 + sequence).padStart(2, '0')}:00:00Z`));
    if (method === 'PATCH') Object.assign(current.entries.find(item => item.id === entryId)!, { content: body!.content, ...(body!.kind ? { kind: body!.kind } : {}), updatedAt: '2026-09-28T12:00:00Z' });
    if (method === 'DELETE') current.entries = current.entries.filter(item => item.id !== entryId);
  } else Object.assign(current, { ...(body?.title === undefined ? {} : { title: body.title }), ...(body?.status === undefined ? {} : { status: body.status }) });
  current.revision += 1; current.updatedAt = '2026-09-28T12:00:00Z';
  return structuredClone(current);
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); localStorage.setItem('dailyhouse-ideas-view', 'list'); sessionStorage.clear(); failure = ''; sequence = 0; trash = []; testRun++;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  records = [idea(`one-${testRun}`, 'A research game', 'Connect game mechanics to a small research experiment.'), idea(`two-${testRun}`, 'A second thought', 'Only show this body on its own page.')];
  mocks.request.mockReset(); mocks.request.mockImplementation(serve);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); vi.unstubAllGlobals(); });

describe('idea collection and dedicated pages', () => {
  it('creates an idea and opens its own page without including other ideas', async () => {
    await mount(); await click(button('新建想法'));
    await change(control<HTMLInputElement>('想法标题'), '  A tiny game  ');
    await change(control<HTMLTextAreaElement>('最初的想法'), '  Prototype a single mechanic first.  ');
    await click(button('创建并打开'));
    expect(writes()).toEqual([['/ideas', 'POST', { title: 'A tiny game', content: 'Prototype a single mechanic first.' }]]);
    expect(host.querySelector('[data-location]')?.textContent).toBe(`/ideas/new-${testRun}`);
    expect(host.querySelector('h1')?.textContent).toBe('A tiny game');
    expect(host.textContent).toContain('Prototype a single mechanic first.');
    expect(host.textContent).not.toContain('Only show this body on its own page.');
    expect(sessionStorage.getItem('dailyhouse-idea-draft:new')).toBeNull();
  });

  it('keeps the collection compact and opens the selected timeline', async () => {
    records[0].entries.push(entry('latest', 'Use a turn based prototype.', 'decision', '2026-09-27T13:00:00Z'));
    await mount();
    expect(host.textContent).toContain('Use a turn based prototype.');
    expect(host.textContent).not.toContain('Connect game mechanics to a small research experiment.');
    expect(host.querySelector('ol')).toBeNull();
    const selected = Array.from(host.querySelectorAll('a')).find(link => link.querySelector('h2')?.textContent === 'A research game')!;
    await click(selected);
    expect(host.querySelector('[data-location]')?.textContent).toBe(`/ideas/${records[0].id}`);
    expect(host.textContent).toContain('Connect game mechanics to a small research experiment.');
    expect(host.textContent).toContain('Use a turn based prototype.');
    expect(host.textContent).not.toContain('Only show this body on its own page.');
    expect(mocks.request).toHaveBeenCalledWith(`/ideas/${records[0].id}`);
  });

  it('filters summaries by search and status without fetching every detail', async () => {
    records[1].status = 'done';
    await mount(); await change(control<HTMLSelectElement>('筛选想法状态'), 'done');
    expect(host.textContent).toContain('A second thought'); expect(host.textContent).not.toContain('A research game');
    await change(control<HTMLSelectElement>('筛选想法状态'), 'all');
    await change(control<HTMLInputElement>('搜索想法'), 'research');
    expect(host.textContent).toContain('A research game'); expect(host.textContent).not.toContain('A second thought');
    expect(mocks.request.mock.calls).toEqual([['/ideas']]);
  });
});

const timelineRows = () => Array.from(host.querySelectorAll<HTMLLIElement>('ol.idea-timeline > li'));
const timelineRow = (content: string) => {
  const row = timelineRows().find(node => node.textContent?.includes(content));
  if (!row) throw new Error(`Timeline entry not found: ${content}`);
  return row;
};
async function append(content: string, kind: Entry['kind'] = 'note') {
  await change(control<HTMLSelectElement>('更新类型'), kind);
  await change(control<HTMLTextAreaElement>('这次的新想法'), content);
  await click(button('保存更新'));
}

describe('idea timeline updates', () => {
  it('appends multiple dated updates from the first thought to the latest progress', async () => {
    await mount('/ideas/one');
    await append('Build a one-room demo.', 'progress');
    await append('Use a turn based mechanic.', 'decision');
    const rows = timelineRows();
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Connect game mechanics to a small research experiment.');
    expect(rows[1].textContent).toContain('Build a one-room demo.'); expect(rows[1].textContent).toContain('进展');
    expect(rows[2].textContent).toContain('Use a turn based mechanic.'); expect(rows[2].textContent).toContain('决定');
    expect(rows.map(row => row.querySelector('time')?.dateTime)).toEqual(['2026-09-27T12:00:00Z', '2026-09-27T13:00:00Z', '2026-09-27T14:00:00Z']);
    expect(writes()).toEqual([
      [`/ideas/${records[0].id}/entries`, 'POST', { kind: 'progress', content: 'Build a one-room demo.', revision: 1 }],
      [`/ideas/${records[0].id}/entries`, 'POST', { kind: 'decision', content: 'Use a turn based mechanic.', revision: 2 }],
    ]);
    expect(control<HTMLTextAreaElement>('这次的新想法').value).toBe('');
    await change(control<HTMLSelectElement>('时间线顺序'), 'newest');
    expect(timelineRows()[0].textContent).toContain('Use a turn based mechanic.');
    await change(control<HTMLSelectElement>('时间线顺序'), 'oldest');
    expect(timelineRows()[0].textContent).toContain('Connect game mechanics to a small research experiment.');
  });

  it('edits the initial thought and later entries without changing their original date or duplicating them', async () => {
    records[0].entries.push(entry('editable', 'Maybe add scoring.', 'question', '2026-09-27T13:00:00Z'));
    await mount('/ideas/one');
    await click(button('编辑记录', timelineRows()[0]));
    expect(host.querySelector('select[aria-label="记录类型"]')).toBeNull();
    await change(control<HTMLTextAreaElement>('编辑内容'), 'A refined initial thought.');
    await click(button('保存记录'));
    expect(writes()[0]).toEqual([`/ideas/${records[0].id}/entries/${records[0].id}-initial`, 'PATCH', { content: 'A refined initial thought.', revision: 1 }]);
    expect(timelineRows()[0].querySelector('time')?.dateTime).toBe('2026-09-27T12:00:00Z');
    expect(timelineRows()[0].textContent).toContain('编辑于');
    await click(button('编辑记录', timelineRow('Maybe add scoring.')));
    await change(control<HTMLTextAreaElement>('编辑内容'), 'Use cooperative scoring.');
    await change(control<HTMLSelectElement>('记录类型'), 'decision');
    await click(button('保存记录'));
    expect(writes()[1]).toEqual([`/ideas/${records[0].id}/entries/editable`, 'PATCH', { content: 'Use cooperative scoring.', kind: 'decision', revision: 2 }]);
    expect(timelineRows()).toHaveLength(2);
    expect(timelineRow('Use cooperative scoring.').textContent).toContain('决定');
  });

  it('keeps an entry edit after failure and permits cancelling it without saving', async () => {
    await mount('/ideas/one'); await click(button('编辑记录', timelineRows()[0]));
    await change(control<HTMLTextAreaElement>('编辑内容'), 'An edit that is not saved yet.');
    failure = 'Cannot update the entry'; await click(button('保存记录'));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Cannot update the entry');
    expect(control<HTMLTextAreaElement>('编辑内容').value).toBe('An edit that is not saved yet.');
    expect(records[0].entries[0].content).toBe('Connect game mechanics to a small research experiment.');
    await click(button('取消编辑'));
    expect(writes()).toHaveLength(1);
    expect(timelineRows()[0].textContent).toContain('Connect game mechanics to a small research experiment.');
  });

  it('edits the title and status while retaining timeline entries', async () => {
    await mount('/ideas/one'); await click(button('编辑标题与状态'));
    await change(control<HTMLInputElement>('想法标题'), 'A focused research game');
    await change(control<HTMLSelectElement>('想法状态'), 'done');
    await click(button('保存信息'));
    expect(writes()).toEqual([[`/ideas/${records[0].id}`, 'PATCH', { title: 'A focused research game', status: 'done', revision: 1 }]]);
    expect(host.querySelector('h1')?.textContent).toBe('A focused research game');
    expect(host.textContent).toContain('已成形');
    expect(timelineRows()).toHaveLength(1);
  });

  it('cancels deletion without writing and removes only a confirmed update', async () => {
    records[0].entries.push(entry('removable', 'A temporary direction.', 'note', '2026-09-27T13:00:00Z'));
    await mount('/ideas/one');
    const initial = timelineRows()[0];
    expect(Array.from(initial.querySelectorAll('button')).some(node => (node.getAttribute('aria-label') || node.textContent) === '删除记录')).toBe(false);
    await click(button('删除记录', timelineRow('A temporary direction.')));
    expect(writes()).toEqual([]);
    await click(button('取消删除'));
    expect(writes()).toEqual([]); expect(timelineRows()).toHaveLength(2);
    await click(button('删除记录', timelineRow('A temporary direction.')));
    await click(button('确认删除这条更新'));
    expect(writes()).toEqual([[`/ideas/${records[0].id}/entries/removable`, 'DELETE', { revision: 1 }]]);
    expect(timelineRows()).toHaveLength(1);
    expect(host.textContent).not.toContain('A temporary direction.');
    expect(host.textContent).toContain('Connect game mechanics to a small research experiment.');
  });

  it('keeps an unsaved update on failure and saves it once after retry', async () => {
    await mount('/ideas/one'); failure = 'Disk is unavailable';
    await append('Keep this exact draft.', 'question');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Disk is unavailable');
    expect(control<HTMLTextAreaElement>('这次的新想法').value).toBe('Keep this exact draft.');
    expect(control<HTMLSelectElement>('更新类型').value).toBe('question');
    expect(records[0].entries).toHaveLength(1);
    failure = ''; await click(button('保存更新'));
    expect(records[0].entries.filter(item => item.content === 'Keep this exact draft.')).toHaveLength(1);
    expect(control<HTMLTextAreaElement>('这次的新想法').value).toBe('');
  });

  it('refreshes a revision conflict without losing the draft or overwriting another update', async () => {
    await mount('/ideas/one');
    await change(control<HTMLTextAreaElement>('这次的新想法'), 'My local addition.');
    records[0].entries.push(entry('remote', 'A change saved in another window.', 'decision', '2026-09-27T12:30:00Z'));
    records[0].revision = 2;
    await click(button('保存更新'));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('changed in another window');
    expect(control<HTMLTextAreaElement>('这次的新想法').value).toBe('My local addition.');
    await click(button('刷新已保存内容'));
    expect(host.textContent).toContain('A change saved in another window.');
    expect(control<HTMLTextAreaElement>('这次的新想法').value).toBe('My local addition.');
    await click(button('保存更新'));
    expect(records[0].entries.map(item => item.content)).toEqual(['Connect game mechanics to a small research experiment.', 'A change saved in another window.', 'My local addition.']);
    expect(writes().map(call => call[2].revision)).toEqual([1, 2]);
  });

  it('keeps a separate unfinished update for each idea across page navigation', async () => {
    await mount('/ideas/one');
    await change(control<HTMLTextAreaElement>('这次的新想法'), 'Draft for the research game.');
    await change(control<HTMLSelectElement>('更新类型'), 'decision');
    await navigate('two');
    expect(control<HTMLTextAreaElement>('这次的新想法').value).toBe('');
    await change(control<HTMLTextAreaElement>('这次的新想法'), 'Draft for the second thought.');
    await navigate('one');
    expect(control<HTMLTextAreaElement>('这次的新想法').value).toBe('Draft for the research game.');
    expect(control<HTMLSelectElement>('更新类型').value).toBe('decision');
    await navigate('two');
    expect(control<HTMLTextAreaElement>('这次的新想法').value).toBe('Draft for the second thought.');
    expect(writes()).toEqual([]);
  });

  it('ignores a late detail response after opening a different idea', async () => {
    let resolveFirst!: (record: Idea) => void;
    mocks.request.mockImplementation((path: string, method?: string, body?: Mutation) => path === `/ideas/${records[0].id}` && !method ? new Promise(resolve => { resolveFirst = resolve; }) : serve(path, method, body));
    await mount('/ideas/one'); await navigate('two');
    expect(host.querySelector('h1')?.textContent).toBe('A second thought');
    await act(async () => { resolveFirst(structuredClone(records[0])); });
    expect(host.querySelector('h1')?.textContent).toBe('A second thought');
    expect(host.textContent).not.toContain('Connect game mechanics to a small research experiment.');
  });

  it('clears a submitted update after a late success while another page is open', async () => {
    let finish!: () => Promise<void>;
    const id = records[0].id;
    mocks.request.mockImplementation((path: string, method?: string, body?: Mutation) => method === 'POST' && path === `/ideas/${id}/entries`
      ? new Promise(resolve => { finish = async () => { resolve(await serve(path, method, body)); }; })
      : serve(path, method, body));
    await mount('/ideas/one'); await append('A submitted update.', 'progress');
    await navigate('two');
    await act(async () => { await finish(); });
    expect(host.querySelector('h1')?.textContent).toBe('A second thought');
    await navigate('one');
    expect(timelineRow('A submitted update.')).toBeDefined();
    expect(control<HTMLTextAreaElement>('这次的新想法').value).toBe('');
    expect(records[0].entries.filter(item => item.content === 'A submitted update.')).toHaveLength(1);
  });

  it('retains a submitted update after a late failure while another page is open', async () => {
    let rejectSave!: (error: Error) => void;
    const id = records[0].id;
    mocks.request.mockImplementation((path: string, method?: string, body?: Mutation) => method === 'POST' && path === `/ideas/${id}/entries`
      ? new Promise((_, reject) => { rejectSave = reject; })
      : serve(path, method, body));
    await mount('/ideas/one'); await append('Keep this if saving fails.', 'question');
    await navigate('two');
    await act(async () => { rejectSave(new Error('Save interrupted')); });
    await navigate('one');
    expect(control<HTMLTextAreaElement>('这次的新想法').value).toBe('Keep this if saving fails.');
    expect(control<HTMLSelectElement>('更新类型').value).toBe('question');
    expect(records[0].entries).toHaveLength(1);
  });

  it('does not erase a newer draft when an earlier submission finishes after navigation', async () => {
    let finish!: () => Promise<void>;
    const id = records[0].id;
    mocks.request.mockImplementation((path: string, method?: string, body?: Mutation) => method === 'POST' && path === `/ideas/${id}/entries`
      ? new Promise(resolve => { finish = async () => { resolve(await serve(path, method, body)); }; })
      : serve(path, method, body));
    await mount('/ideas/one'); await append('The first submitted update.', 'progress');
    await navigate('two'); await navigate('one');
    await change(control<HTMLTextAreaElement>('这次的新想法'), 'A newer unfinished thought.');
    await act(async () => { await finish(); });
    await navigate('two'); await navigate('one');
    expect(timelineRow('The first submitted update.')).toBeDefined();
    expect(control<HTMLTextAreaElement>('这次的新想法').value).toBe('A newer unfinished thought.');
    expect(records[0].entries).toHaveLength(2);
  });
});

describe('idea deletion and creation failures', () => {
  it('requires confirmation before moving a whole idea to trash and returns to the remaining collection', async () => {
    const id = records[0].id;
    await mount('/ideas/one'); await click(button('删除想法'));
    expect(writes()).toEqual([]);
    await click(button('取消删除'));
    expect(writes()).toEqual([]); expect(records).toHaveLength(2);
    await click(button('删除想法')); await click(button('确认删除整个想法'));
    expect(writes()).toEqual([[`/ideas/${id}`, 'DELETE', { revision: 1 }]]);
    expect(host.querySelector('[data-location]')?.textContent).toBe('/ideas');
    expect(host.textContent).not.toContain('A research game');
    expect(host.textContent).toContain('A second thought');
    expect(records).toHaveLength(1);
    expect(trash).toHaveLength(1);
    expect(trash[0].idea.entries[0].content).toBe('Connect game mechanics to a small research experiment.');
  });

  it('keeps the idea visible when deletion fails and permits a deliberate retry', async () => {
    await mount('/ideas/one'); await click(button('删除想法')); failure = 'Unable to delete';
    await click(button('确认删除整个想法'));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Unable to delete');
    expect(host.querySelector('h1')?.textContent).toBe('A research game');
    expect(records).toHaveLength(2);
    failure = ''; await click(button('确认删除整个想法'));
    expect(host.querySelector('[data-location]')?.textContent).toBe('/ideas');
    expect(records).toHaveLength(1);
  });

  it('retains a deleted idea after restore fails and restores its full timeline on retry', async () => {
    const deleted = records.shift()!;
    deleted.entries.push(entry('before-removal', 'Keep this history after restoring.', 'decision', '2026-09-27T13:00:00Z'));
    trash.push({ idea: deleted, deletedAt: '2026-09-27T12:00:00Z', expiresAt: '2026-10-27T12:00:00Z' });
    await mount(); await click(button('回收站'));
    expect(host.textContent).toContain('A research game');
    failure = 'Could not restore this idea'; await click(button('恢复想法：A research game'));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not restore this idea');
    expect(trash).toHaveLength(1); expect(records).toHaveLength(1);
    failure = ''; await click(button('恢复想法：A research game'));
    expect(writes()).toEqual([[`/ideas/${deleted.id}/restore`, 'POST'], [`/ideas/${deleted.id}/restore`, 'POST']]);
    expect(trash).toHaveLength(0); expect(records).toHaveLength(2);
    await click(button('所有灵感'));
    const restored = Array.from(host.querySelectorAll('a')).find(link => link.querySelector('h2')?.textContent === 'A research game')!;
    await click(restored);
    expect(timelineRows()).toHaveLength(2);
    expect(host.textContent).toContain('Connect game mechanics to a small research experiment.');
    expect(host.textContent).toContain('Keep this history after restoring.');
  });

  it('preserves both new-idea fields after a create error and through page navigation', async () => {
    await mount(); await click(button('新建想法'));
    await change(control<HTMLInputElement>('想法标题'), 'An unfinished seed');
    await change(control<HTMLTextAreaElement>('最初的想法'), 'I should keep this first thought.');
    failure = 'Could not save the idea'; await click(button('创建并打开'));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not save the idea');
    expect(control<HTMLInputElement>('想法标题').value).toBe('An unfinished seed');
    expect(control<HTMLTextAreaElement>('最初的想法').value).toBe('I should keep this first thought.');
    expect(records).toHaveLength(2);
    await navigate('one'); await navigate('list');
    expect(control<HTMLInputElement>('想法标题').value).toBe('An unfinished seed');
    expect(control<HTMLTextAreaElement>('最初的想法').value).toBe('I should keep this first thought.');
    failure = ''; await click(button('创建并打开'));
    expect(records.filter(record => record.title === 'An unfinished seed')).toHaveLength(1);
  });
});
