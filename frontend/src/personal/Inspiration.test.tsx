// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import InspirationBoard from './InspirationBoard';
import InspirationExplore from './InspirationExplore';
import InspirationDetails from './InspirationDetails';
import ProjectsPage from './Projects';
import { PreferencesProvider } from './Preferences';
import type { Bubble, Direction, InspirationDraft, InspirationState, Project } from './inspiration-model';

const mocks = vi.hoisted(() => ({ request: vi.fn(), brainstorm: vi.fn(), refresh: vi.fn(async () => {}) }));
vi.mock('./api', async original => ({ ...(await original<typeof import('./api')>()), request: mocks.request }));
vi.mock('./inspiration-model', async original => ({ ...(await original<typeof import('./inspiration-model')>()), brainstorm: mocks.brainstorm }));
vi.mock('./Workspace', () => ({ useWorkspace: () => ({ refresh: mocks.refresh }) }));
const now = '2026-09-28T12:00:00Z';
const bubble = (id: string, title: string): Bubble => ({ id, title, body: `Original ${title}`, tags: [], pinned: false, status: 'active', sources: [], drafts: [], revision: 1, createdAt: now, updatedAt: now });
const direction = (title: string): Direction => ({ title, goal: `${title} goal`, mvp: ['One scene'], assumptions: ['One weekend'], risks: ['Needs a usability test'], acceptance: ['A friend can finish it'], firstStep: 'Sketch three screens' });
const draft = (): InspirationDraft => ({ id: 'draft-one', purpose: 'directions', context: '', sourceIds: [], directions: ['Flower puzzle', 'A blooming letter', 'Bouquet workshop'].map(direction), model: 'local-model', createdAt: now, updatedAt: now });
const ai: InspirationState['ai'] = { configured: true, provider: 'ollama', model: 'local-model', message: 'Ready' };
const project = (): Project => ({ id: 'project-one', title: 'Bouquet game', goal: 'Make a tiny gift game', mvp: ['One scene'], acceptance: ['A friend finishes it'], nextStep: 'Sketch three screens', nextStepId: 'step-one', sourceBubbleId: 'flower', sourceSnapshot: { id: 'flower', title: 'Flowers', body: 'A tiny game', updatedAt: now }, status: 'active', createdAt: now, updatedAt: now, revision: 3 });
let host: HTMLDivElement; let root: Root; const onChanged = vi.fn(async () => {});
function Location() { const location = useLocation(); return <output data-location>{location.pathname}{location.search}</output>; }
async function mount(element: React.ReactNode, path = '/ideas') { await act(async () => { root.render(<MemoryRouter initialEntries={[path]}><PreferencesProvider><Location/>{element}</PreferencesProvider></MemoryRouter>); }); }
function button(name: string | RegExp) { const found = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(node => typeof name === 'string' ? node.textContent?.trim() === name : name.test(node.textContent ?? '')); if (!found) throw new Error(`Missing button ${String(name)}`); return found; }
function field(name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement { const found = Array.from(host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')).find(node => node.getAttribute('aria-label') === name || Array.from(node.labels ?? []).some(label => Array.from(label.childNodes).filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent).join('').trim() === name)); if (!found) throw new Error(`Missing field ${name}`); return found; }
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function change(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) { await act(async () => { const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }); }
beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); localStorage.clear(); mocks.request.mockReset(); mocks.brainstorm.mockReset(); mocks.refresh.mockClear(); onChanged.mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('bubble fusion', () => {
  it('merges an explicit selection into a new canonical idea and keeps the originals', async () => {
    const originals = [bubble('game', 'Game'), bubble('flower', 'Flowers')];
    mocks.request.mockImplementation(async (path: string, method = 'GET') => { if (path === '/inspiration' && method === 'GET') return { items: originals, ai, trashCount: 0 }; if (path === '/inspiration/trash') return { items: [] }; if (path === '/inspiration/merge') return bubble('merged', 'Flower game'); throw new Error(path); });
    await mount(<InspirationBoard visibleIds={['game', 'flower']} mode="garden" onChanged={onChanged}/>);
    expect(button('融合所选').disabled).toBe(true); await click(field('选择气泡: Game')); await click(field('选择气泡: Flowers')); await click(button('融合所选')); await change(field('给新组合起个名字'), 'Flower game'); await change(field('它们之间的联系'), 'An interactive bouquet'); await click(button('保存新组合'));
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
  it('loads only when opened and synchronizes the parent revision after metadata edits', async () => {
    let item = bubble('flower', 'Flowers'); const canonicalChanged = vi.fn(async () => {});
    mocks.request.mockImplementation(async (path: string, method = 'GET', body?: { tags: string[] }) => { if (path === '/inspiration' && method === 'GET') return { items: [item], ai }; if (method === 'PATCH') { item = { ...item, tags: body!.tags, revision: item.revision + 1 }; return item; } throw new Error(path); });
    await mount(<InspirationDetails ideaId="flower" revision={1} onCanonicalChanged={canonicalChanged}/>); expect(mocks.request).not.toHaveBeenCalled();
    await act(async () => { const details = host.querySelector('details')!; details.open = true; details.dispatchEvent(new Event('toggle')); });
    await change(field('标签（逗号分隔）'), 'gift, game'); await click(button('保存标签'));
    expect(mocks.request).toHaveBeenCalledWith('/inspiration/flower', 'PATCH', { tags: ['gift', 'game'], revision: 1 }); expect(canonicalChanged).toHaveBeenCalledOnce();
  });
});

describe('local model exploration', () => {
  it('shows the unavailable model honestly while still allowing manual project planning', async () => {
    await mount(<InspirationExplore bubble={bubble('flower', 'Flowers')} ai={{ ...ai, configured: false, message: 'Start the local model first' }} onChanged={onChanged}/>); expect(host.textContent).toContain('Start the local model first'); expect(button('发送并生成方向').disabled).toBe(true); expect(button('我已有方向，直接立项').disabled).toBe(false); expect(mocks.brainstorm).not.toHaveBeenCalled();
  });
  it('sends only the reviewed excerpt and explicitly selected sources, then saves a draft without creating a project', async () => {
    const item = bubble('flower', 'Flowers'); item.sources = [{ id: 'game', title: 'Game', body: 'A puzzle', updatedAt: now }, { id: 'private', title: 'Private note', body: 'Not selected', updatedAt: now }]; mocks.brainstorm.mockResolvedValue(draft());
    await mount(<InspirationExplore bubble={item} ai={ai} onChanged={onChanged}/>); await change(field('本次发送的灵感摘录'), 'Only a flower gift'); await change(field('补充约束（选填）'), 'One weekend'); const source = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!; await click(source); await click(button('发送并生成方向'));
    expect(mocks.brainstorm).toHaveBeenCalledWith('flower', { purpose: 'directions', context: 'One weekend', ideaExcerpt: 'Only a flower gift', includeSourceIds: ['game'], language: 'zh', expectedRevision: 1 }, expect.any(AbortSignal)); expect(onChanged).toHaveBeenCalledOnce(); expect(mocks.request).not.toHaveBeenCalled();
  });
  it('cancels inference and preserves the inputs for a retry', async () => {
    let inferenceSignal: AbortSignal | undefined; mocks.brainstorm.mockImplementation((_id, _body, signal: AbortSignal) => { inferenceSignal = signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))); });
    await mount(<InspirationExplore bubble={bubble('flower', 'Flowers')} ai={ai} onChanged={onChanged}/>); await change(field('补充约束（选填）'), 'Keep this constraint'); await click(button('发送并生成方向')); expect(button('正在思考…').disabled).toBe(true); await click(button('取消生成')); expect(inferenceSignal?.aborted).toBe(true); expect(field('补充约束（选填）').value).toBe('Keep this constraint'); expect(host.textContent).toContain('已取消本次发散'); expect(button('发送并生成方向').disabled).toBe(false);
  });
  it('blocks an oversized source selection before sending it to the local model', async () => {
    const item = bubble('flower', 'Flowers'); item.sources = [{ id: 'long', title: 'Long source', body: 'x'.repeat(5000), updatedAt: now }]; await mount(<InspirationExplore bubble={item} ai={ai} onChanged={onChanged}/>); await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!); expect(button('发送并生成方向').disabled).toBe(true); expect(host.textContent).toContain('超过模型上下文上限'); expect(mocks.brainstorm).not.toHaveBeenCalled();
  });
  it('requires project confirmation and sends only the chosen direction', async () => {
    const item = bubble('flower', 'Flowers'); item.drafts = [draft()]; mocks.request.mockResolvedValue({ project: project(), created: true }); await mount(<InspirationExplore bubble={item} ai={ai} onChanged={onChanged}/>);
    await click(button('用这个方向立项')); expect(mocks.request).not.toHaveBeenCalled(); expect(field('项目标题').value).toBe('Flower puzzle'); await change(field('项目标题'), 'My flower puzzle'); await click(button('确认立项'));
    expect(mocks.request).toHaveBeenCalledWith('/inspiration/flower/project', 'POST', { title: 'My flower puzzle', goal: 'Flower puzzle goal', mvp: ['One scene'], acceptance: ['A friend can finish it'], nextStep: 'Sketch three screens', draftId: 'draft-one' }); expect(mocks.request.mock.calls.some(([path]) => path.endsWith('/todo'))).toBe(false);
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
