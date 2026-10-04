// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import InspirationBoard from './InspirationBoard';
import InspirationExplore from './InspirationExplore';
import InspirationDetails from './InspirationDetails';
import ProjectsPage from './LegacyProjects';
import { PreferencesProvider } from './Preferences';
import type { Bubble, InspirationState, Project } from './inspiration-model';

const mocks = vi.hoisted(() => ({ request: vi.fn(), converse: vi.fn(), refresh: vi.fn(async () => {}) }));
vi.mock('./api', async original => ({ ...(await original<typeof import('./api')>()), request: mocks.request }));
vi.mock('./inspiration-model', async original => ({ ...(await original<typeof import('./inspiration-model')>()), converse: mocks.converse }));
vi.mock('./Workspace', () => ({ useWorkspace: () => ({ refresh: mocks.refresh }) }));
const now = '2026-09-28T12:00:00Z';
const bubble = (id: string, title: string): Bubble => ({ id, title, body: `Original ${title}`, tags: [], pinned: false, status: 'active', sources: [], drafts: [], revision: 1, createdAt: now, updatedAt: now });
const ai: InspirationState['ai'] = { configured: true, provider: 'ollama', model: 'qwen:fixture', message: 'Ready' };
const project = (): Project => ({ id: 'project-one', title: 'Bouquet game', goal: 'Make a tiny gift game', mvp: ['One scene'], acceptance: ['A friend finishes it'], nextStep: 'Sketch three screens', nextStepId: 'step-one', sourceBubbleId: 'flower', sourceSnapshot: { id: 'flower', title: 'Flowers', body: 'A tiny game', updatedAt: now }, status: 'active', createdAt: now, updatedAt: now, revision: 3 });
let host: HTMLDivElement; let root: Root; const onChanged = vi.fn(async () => {});
function Location() { const location = useLocation(); return <output data-location>{location.pathname}{location.search}</output>; }
async function mount(element: React.ReactNode, path = '/ideas') { await act(async () => { root.render(<MemoryRouter initialEntries={[path]}><PreferencesProvider><Location/>{element}</PreferencesProvider></MemoryRouter>); }); const localMode = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === '可选：本机模型与已存对话'); if (localMode) { await click(localMode); if (typeof element === 'object' && element && 'type' in element && element.type === InspirationExplore) mocks.request.mockClear(); } }
function button(name: string | RegExp) { const found = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(node => typeof name === 'string' ? node.textContent?.trim() === name : name.test(node.textContent ?? '')); if (!found) throw new Error(`Missing button ${String(name)}`); return found; }
function field(name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement { const found = Array.from(host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')).find(node => node.getAttribute('aria-label') === name || Array.from(node.labels ?? []).some(label => Array.from(label.childNodes).filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent).join('').trim() === name)); if (!found) throw new Error(`Missing field ${name}`); return found; }
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function change(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) { await act(async () => { const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }); }
beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); localStorage.clear(); mocks.request.mockReset(); mocks.converse.mockReset(); sessionStorage.clear(); mocks.refresh.mockClear(); onChanged.mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('bubble fusion', () => {
  it('merges an explicit selection into a new canonical idea and keeps the originals', async () => {
    const originals = [bubble('game', 'Game'), bubble('flower', 'Flowers')];
    mocks.request.mockImplementation(async (path: string, method = 'GET') => { if (path === '/inspiration' && method === 'GET') return { items: originals, ai, trashCount: 0 }; if (path === '/inspiration/trash') return { items: [] }; if (path === '/inspiration/merge') return bubble('merged', 'Flower game'); throw new Error(path); });
    await mount(<InspirationBoard visibleIds={['game', 'flower']} mode="garden" onChanged={onChanged}/>);
    expect(button('融合所选').disabled).toBe(true); await click(field('选择气泡: Game')); await click(field('选择气泡: Flowers')); await click(button('融合所选')); await change(field('给新组合起个名字'), 'Flower game'); await change(field('它们之间的联系'), 'An interactive bouquet'); await click(button('融合并打开一起想'));
    expect(mocks.request).toHaveBeenCalledWith('/inspiration/merge', 'POST', { ids: ['game', 'flower'], title: 'Flower game', body: 'An interactive bouquet' });
    expect(mocks.request.mock.calls.some(([, method]) => method === 'DELETE')).toBe(false); expect(host.querySelector('[data-location]')?.textContent).toBe('/ideas/merged'); expect(originals).toHaveLength(2);
  });
  it('clears a selection when a search changes which canonical ideas are visible', async () => {
    mocks.request.mockImplementation(async path => path === '/inspiration' ? { items: [bubble('game', 'Game'), bubble('flower', 'Flowers')], ai } : { items: [] });
    await mount(<InspirationBoard visibleIds={['game', 'flower']} mode="garden" onChanged={onChanged}/>); await click(field('选择气泡: Game')); await click(field('选择气泡: Flowers'));
    await mount(<InspirationBoard visibleIds={['game']} mode="garden" onChanged={onChanged}/>); expect((field('选择气泡: Game') as HTMLInputElement).checked).toBe(false); expect(button('融合所选').disabled).toBe(true);
  });
  it('refreshes bubble content when the canonical revision changes without changing its ID', async () => {
    let item = bubble('flower', 'Flowers'); mocks.request.mockImplementation(async path => path === '/inspiration' ? { items: [item], ai } : { items: [] });
    await mount(<InspirationBoard visibleIds={['flower']} mode="garden" refreshKey="flower:1" onChanged={onChanged}/>); expect(host.textContent).toContain('Original Flowers');
    item = { ...item, body: 'Updated in another window', revision: 2 }; await mount(<InspirationBoard visibleIds={['flower']} mode="garden" refreshKey="flower:2" onChanged={onChanged}/>); expect(host.textContent).toContain('Updated in another window'); expect(host.textContent).not.toContain('Original Flowers');
  });
});

describe('canonical idea metadata', () => {
  it('loads conversation immediately and synchronizes the parent revision after metadata edits', async () => {
    let item = bubble('flower', 'Flowers'); const canonicalChanged = vi.fn(async () => {});
    mocks.request.mockImplementation(async (path: string, method = 'GET', body?: { tags: string[] }) => { if (path.endsWith('/launch')) return { operation: null }; if (path === '/inspiration' && method === 'GET') return { items: [item], ai }; if (method === 'PATCH') { item = { ...item, tags: body!.tags, revision: item.revision + 1 }; return item; } throw new Error(path); });
    await mount(<InspirationDetails ideaId="flower" revision={1} onCanonicalChanged={canonicalChanged}/>); expect(mocks.request).toHaveBeenCalled();
    await act(async () => { const details = host.querySelector('details')!; details.open = true; details.dispatchEvent(new Event('toggle')); });
    await change(field('标签（逗号分隔）'), 'gift, game'); await click(button('保存标签'));
    expect(mocks.request).toHaveBeenCalledWith('/inspiration/flower', 'PATCH', { tags: ['gift', 'game'], revision: 1 }); expect(canonicalChanged).toHaveBeenCalledOnce();
  });
});

describe('local model exploration', () => {
  it('keeps brainstorming separate from launching projects and shows unavailable model honestly', async () => {
    await mount(<InspirationExplore bubble={bubble('flower', 'Flowers')} ai={{ ...ai, configured: false, message: 'Start the local model first' }} onChanged={onChanged}/>);
    expect(host.textContent).toContain('Start the local model first'); expect(host.querySelector('.idea-ai-presence')?.textContent).toContain('未连接'); expect(host.querySelector('.idea-ai-presence')?.classList.contains('is-ready')).toBe(false); expect(button('一起想一想').disabled).toBe(true); expect(host.textContent).not.toContain('立项'); expect(mocks.converse).not.toHaveBeenCalled();
  });
  it('starts open-ended fusion conversation with selected source snapshots, without a project', async () => {
    const item = bubble('flower', 'Flowers'); item.sources = [{ id: 'game', title: 'Game', body: 'A puzzle', updatedAt: now }, { id: 'private', title: 'Private note', body: 'Not selected', updatedAt: now }];
    mocks.converse.mockResolvedValue({ id: 'talk', sourceIds: ['game'], messages: [], model: 'local', createdAt: now, updatedAt: now });
    await mount(<InspirationExplore bubble={item} ai={ai} onChanged={onChanged}/>); await change(field('对 Qwen 说点什么'), 'Could these become a playful gift?'); await click(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]); await click(button('一起想一想'));
    expect(mocks.converse).toHaveBeenCalledWith('flower', { message: 'Could these become a playful gift?', includeSourceIds: ['game'], language: 'zh', expectedRevision: 1 }, expect.any(AbortSignal)); expect(onChanged).toHaveBeenCalledOnce(); expect(mocks.request).not.toHaveBeenCalled();
  });
  it('cancels inference without losing the question', async () => {
    let signal: AbortSignal | undefined; mocks.converse.mockImplementation((_id, _body, next: AbortSignal) => { signal = next; return new Promise((_resolve, reject) => next.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))); });
    await mount(<InspirationExplore bubble={bubble('flower', 'Flowers')} ai={ai} onChanged={onChanged}/>); await change(field('对 Qwen 说点什么'), 'Keep this thought'); await click(button('一起想一想')); await click(button('停止这次思考'));
    expect(signal?.aborted).toBe(true); expect(field('对 Qwen 说点什么').value).toBe('Keep this thought'); expect(host.textContent).toContain('这次思考已取消');
  });
  it('continues the selected conversation with its update guard and confirms turn deletion', async () => {
    const item = bubble('flower', 'Flowers'); item.conversations = [{ id: 'talk', sourceIds: [], messages: [{ id: 'q', role: 'user', content: 'What if it blooms?', createdAt: now }, { id: 'a', role: 'assistant', content: 'What should a flower remember?', createdAt: now }], model: 'local', createdAt: now, updatedAt: now }]; mocks.converse.mockResolvedValue(item.conversations[0]);
    await mount(<InspirationExplore bubble={item} ai={ai} onChanged={onChanged}/>); await change(field('对 Qwen 说点什么'), 'A memory from a friend'); await click(button('一起想一想'));
    expect(mocks.converse).toHaveBeenCalledWith('flower', expect.objectContaining({ conversationId: 'talk', expectedUpdatedAt: now }), expect.any(AbortSignal));
    await click(host.querySelector<HTMLButtonElement>('[aria-label="删除从这条消息开始的对话"]')!); expect(mocks.request).not.toHaveBeenCalled(); await click(button('确认永久删除')); expect(mocks.request).toHaveBeenCalledWith('/inspiration/flower/conversations/talk/turns/q', 'DELETE');
  });
});
describe('project lifecycle', () => {
  it('keeps task creation explicit and disables it until edited steps are saved', async () => {
    let item = project(); mocks.request.mockImplementation(async (path: string, method = 'GET', body?: Partial<Project>) => { if (path === '/projects') return { items: [item] }; if (path === '/projects/trash') return { items: [] }; if (path.endsWith('/todo')) return { todoId: 'task-one', created: false, deleted: false }; if (method === 'PATCH') { item = { ...item, ...body, revision: item.revision + 1 }; return item; } throw new Error(path); });
    await mount(<ProjectsPage/>, '/projects?project=project-one'); expect(mocks.request.mock.calls.some(([path]) => path.endsWith('/todo'))).toBe(false); await change(field('下一步'), 'Build one room'); expect(button('把下一步加入待办').disabled).toBe(true); await click(button('保存项目'));
    expect(mocks.request).toHaveBeenCalledWith('/projects/project-one', 'PATCH', expect.objectContaining({ nextStep: 'Build one room', revision: 3 })); await click(button('把下一步加入待办')); expect(host.textContent).toContain('未重复添加'); expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('requires confirmation before removing a project and restores from its own recycle bin', async () => {
    let item: Project | undefined = project(); const bin: { item: Project; deletedAt: string; expiresAt: string }[] = [];
    mocks.request.mockImplementation(async (path: string, method = 'GET') => { if (path === '/projects') return { items: item ? [item] : [] }; if (path === '/projects/trash') return { items: [...bin] }; if (method === 'DELETE') { bin.push({ item: item!, deletedAt: now, expiresAt: '2099-01-01T00:00:00Z' }); item = undefined; return {}; } if (path === '/projects/restore') { item = bin.pop()!.item; return {}; } throw new Error(path); });
    await mount(<ProjectsPage/>, '/projects?project=project-one'); await click(button('移除项目')); expect(mocks.request.mock.calls.some(([, method]) => method === 'DELETE')).toBe(false); expect(host.textContent).toContain('已有待办和本机文件都保留'); await click(button('确认移除项目')); await click(button(/^回收站/)); await click(button('恢复')); expect(mocks.request).toHaveBeenCalledWith('/projects/restore', 'POST', { ids: ['project-one'] }); expect(item?.sourceBubbleId).toBe('flower');
  });
});


describe('changed fusion sources', () => {
  it('drops an unlinked source before starting another conversation', async () => {
    const item = bubble('flower', 'Flowers'); item.sources = [{ id: 'game', title: 'Game', body: 'Playful', updatedAt: now }]; mocks.converse.mockResolvedValue({ id: 'talk', messages: [] });
    await mount(<InspirationExplore bubble={item} ai={ai} onChanged={onChanged}/>);
    await mount(<InspirationExplore bubble={{ ...item, sources: [], revision: 2 }} ai={ai} onChanged={onChanged}/>);
    await change(field('对 Qwen 说点什么'), 'What else could it be?'); await click(button('一起想一想'));
    expect(mocks.converse).toHaveBeenCalledWith('flower', expect.objectContaining({ includeSourceIds: [], expectedRevision: 2 }), expect.any(AbortSignal));
  });
});

describe('live local model status', () => {
  it('refreshes availability on focus without resetting message or tag drafts, then disables sending on probe failure', async () => {
    const item = bubble('availability', 'Fixture idea'); let fail = false;
    mocks.request.mockImplementation(async (path: string) => { if (path.endsWith('/launch')) return { operation: null }; if (path === '/inspiration') return { items: [item], ai }; if (path === '/inspiration/ai') { if (fail) throw Error('offline'); return { ...ai, configured: false, availability: 'model_missing', message: 'Model missing' }; } throw Error(path); });
    await mount(<InspirationDetails ideaId="availability" revision={1}/>); await change(field('对 Qwen 说点什么'), 'Keep my draft'); await change(field('标签（逗号分隔）'), 'unsaved');
    await act(async () => { window.dispatchEvent(new Event('focus')); }); expect(host.querySelector('.idea-ai-presence')?.textContent).toContain('未安装'); expect(field('对 Qwen 说点什么').value).toBe('Keep my draft'); expect(field('标签（逗号分隔）').value).toBe('unsaved'); expect(button('一起想一想').disabled).toBe(true);
    fail = true; await act(async () => { window.dispatchEvent(new Event('focus')); }); expect(host.querySelector('.idea-ai-presence')?.textContent).toContain('状态未知'); expect(mocks.converse).not.toHaveBeenCalled();
  });
  it('labels other configured local models by their actual name', async () => {
    await mount(<InspirationExplore bubble={bubble('other', 'Other model')} ai={{ ...ai, model: 'llama:fixture' }} onChanged={onChanged}/>); expect(host.querySelector('.idea-ai-presence')?.textContent).toContain('llama:fixture'); expect(field('对 llama:fixture 说点什么')).toBeTruthy(); expect(host.querySelector('.idea-ai-presence')?.textContent).toContain('已检测');
  });
});
