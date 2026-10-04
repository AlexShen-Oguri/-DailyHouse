// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IdeaPromptBuilder from './IdeaPromptBuilder';
import { PreferencesProvider, usePreferences } from './Preferences';
import { buildIdeaPrompt, prepareIdeaPrompt } from './idea-prompt';
import type { Idea } from './ideas-model';

const source: Idea = {
  id: 'fixture-idea', title: 'A focused garden notebook', status: 'growing', revision: 1,
  createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-03T10:00:00Z',
  entries: [
    { id: 'later', kind: 'decision', content: 'SELECTED LATER: offline first.', createdAt: '2026-10-03T10:00:00Z', updatedAt: '2026-10-03T10:00:00Z' },
    { id: 'excluded', kind: 'note', content: 'UNSELECTED PRIVATE DETAIL', createdAt: '2026-10-02T10:00:00Z', updatedAt: '2026-10-02T10:00:00Z' },
    { id: 'first', kind: 'initial', content: 'SELECTED FIRST: help a single gardener.', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z' },
  ],
};

describe('scoped idea exploration prompt', () => {
  it('includes complete selected entries in chronological order and no other private fields', () => {
    const long = 'Full selected context. '.repeat(100);
    const idea = { ...structuredClone(source), privatePath: '/synthetic/private', conversations: ['EXCLUDED CHAT'] };
    idea.entries[2].content = long;
    const original = structuredClone(idea);
    const prepared = prepareIdeaPrompt(idea, ['later', 'first'], '  Build a personal notebook.  ', 'zh');
    expect(prepared.error).toBeUndefined();
    expect(JSON.parse(prepared.json!)).toEqual({ title: idea.title, initialIdea: 'Build a personal notebook.', timeline: [
      { type: '最初的想法', createdAt: source.entries[2].createdAt, content: long },
      { type: '决定', createdAt: source.entries[0].createdAt, content: source.entries[0].content },
    ] });
    const prompt = buildIdeaPrompt(prepared.json!, 'zh');
    for (const excluded of ['UNSELECTED PRIVATE DETAIL', 'EXCLUDED CHAT', '/synthetic/private', 'fixture-idea', 'updatedAt', 'revision']) expect(prompt).not.toContain(excluded);
    expect(idea).toEqual(original);
  });
  it('requires initial direction and real selections, rejecting deleted entries and oversized context without truncation', () => {
    expect(prepareIdeaPrompt(source, ['first'], ' ', 'zh').error).toContain('初始想法');
    expect(prepareIdeaPrompt(source, [], 'A notebook', 'zh').error).toContain('至少选择');
    expect(prepareIdeaPrompt(source, ['missing'], 'A notebook', 'zh').error).toContain('已删除');
    expect(prepareIdeaPrompt(source, Array.from({ length: 51 }, (_, i) => `entry-${i}`), 'A notebook', 'en').error).toContain('50');
    const long = structuredClone(source); long.entries[2].content = '字'.repeat(60001);
    const result = prepareIdeaPrompt(long, ['first'], 'A notebook', 'zh');
    expect(result.error).toContain('不会被截断'); expect(result.json).toBeUndefined();
  });
  it.each(['zh', 'en'] as const)('orders confirmation, skill interview, current-source research, and specialization in %s', language => {
    const prompt = buildIdeaPrompt('{}', language);
    const stages = language === 'zh' ? ['第一阶段', '第二阶段', '第三阶段', '第四阶段'] : ['Stage 1', 'Stage 2', 'Stage 3', 'Stage 4'];
    expect(stages.map(stage => prompt.indexOf(stage))).toEqual([...stages.map(stage => prompt.indexOf(stage))].sort((a, b) => a - b));
    for (const word of ['grill-me', 'grilling', 'specialization']) expect(prompt).toContain(word);
    for (const word of language === 'zh' ? ['等待我的回答', '调研日期', '直接链接', '不编造', '不自动实施', '不构成执行'] : ['wait for my answers', 'research date', 'direct links', 'inventing', 'do not implement', 'not authorization']) expect(prompt).toContain(word);
  });
});

let host: HTMLDivElement; let root: Root;
function button(text: string) {
  const node = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text);
  if (!node) throw Error(`Missing button: ${text}`);
  return node;
}
async function click(node: HTMLElement) { await act(async () => node.click()); }
function field(label: string) {
  const node = [...host.querySelectorAll<HTMLTextAreaElement>('textarea')].find(item => item.closest('label')?.firstChild?.textContent === label);
  if (!node) throw Error(`Missing field: ${label}`);
  return node;
}
async function fill(text: string) {
  const input = field('这次的初始想法');
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function select(index: number) { await click(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[index]); }
async function mount(idea = source) { await act(async () => root.render(<IdeaPromptBuilder idea={idea}/>)); }
async function generate() { await fill('A personal garden notebook'); await select(0); await click(button('生成 Prompt')); }
function PreferenceControls() { const preferences = usePreferences(); return <><button onClick={() => preferences.setLanguage('en')}>English</button><button onClick={() => preferences.setTheme('night')}>Night</button></>; }
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); localStorage.clear();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); document.documentElement.removeAttribute('data-theme'); });
describe('timeline prompt builder', () => {
  it('needs both input and selection, generates locally, copies the preview and clears only the preview', async () => {
    const network = vi.spyOn(globalThis, 'fetch'); const original = structuredClone(source);
    await mount(); expect(host.querySelector('details')?.open).toBe(false); expect(button('生成 Prompt').disabled).toBe(true);
    await fill('A personal garden notebook'); expect(button('生成 Prompt').disabled).toBe(true);
    await select(0); expect(button('生成 Prompt').disabled).toBe(false);
    await click(button('生成 Prompt'));
    const preview = field('Prompt 预览').value; expect(preview).toContain('SELECTED FIRST'); expect(preview).not.toContain('UNSELECTED PRIVATE DETAIL'); expect(preview).not.toContain('SELECTED LATER');
    await click(button('复制 Prompt')); expect(navigator.clipboard.writeText).toHaveBeenCalledWith(preview); expect(host.textContent).toContain('已复制');
    await click(button('清除预览')); expect(host.querySelectorAll('textarea')).toHaveLength(1); expect(field('这次的初始想法').value).toBe('A personal garden notebook'); expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    await click(button('生成 Prompt')); expect(field('Prompt 预览').value).toBe(preview); expect(network).not.toHaveBeenCalled(); expect(source).toEqual(original);
  });
  it.each(['denied', 'missing'])('offers manual selection when clipboard is %s', async state => {
    if (state === 'missing') Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    else vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('denied'));
    await mount(); await generate(); await click(button('复制 Prompt'));
    const preview = field('Prompt 预览'); expect(document.activeElement).toBe(preview); expect(preview.selectionStart).toBe(0); expect(preview.selectionEnd).toBe(preview.value.length); expect(host.textContent).toContain('⌘C 或 Ctrl+C'); expect(host.textContent).not.toContain('已复制');
  });
  it('invalidates selected edits and deletion but leaves unrelated updates alone', async () => {
    await mount(); await generate();
    const unrelated = structuredClone(source); unrelated.entries[1].content = 'Unrelated changed note'; unrelated.revision++;
    await mount(unrelated); expect(button('复制 Prompt').disabled).toBe(false);
    const edited = structuredClone(unrelated); edited.entries[2].content = 'REVISED selected idea'; edited.revision++;
    await mount(edited); expect(button('复制 Prompt').disabled).toBe(true); await click(button('复制 Prompt')); expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    await click(button('重新生成 Prompt')); expect(button('复制 Prompt').disabled).toBe(false); expect(field('Prompt 预览').value).toContain('REVISED selected idea');
    const removed = { ...edited, entries: edited.entries.filter(entry => entry.id !== 'first') };
    await mount(removed); expect(button('复制 Prompt').disabled).toBe(true); expect(button('重新生成 Prompt').disabled).toBe(true);
    await click(button('移除已删除记录的选择')); await select(0); await click(button('重新生成 Prompt')); expect(field('Prompt 预览').value).not.toContain('REVISED selected idea'); expect(button('复制 Prompt').disabled).toBe(false);
  });
  it('requires regeneration after initial direction, selected scope, or title changes', async () => {
    await mount(); await generate(); await fill('A revised initial idea'); expect(button('复制 Prompt').disabled).toBe(true);
    await click(button('重新生成 Prompt')); await select(2); expect(button('复制 Prompt').disabled).toBe(true);
    await click(button('重新生成 Prompt')); expect(field('Prompt 预览').value).toContain('SELECTED LATER');
    await mount({ ...source, title: 'Renamed project' }); expect(button('复制 Prompt').disabled).toBe(true);
    await click(button('重新生成 Prompt')); expect(field('Prompt 预览').value).toContain('Renamed project');
  });
  it('preserves full long source text behind a discoverable expansion', async () => {
    const idea = structuredClone(source); const full = 'Complete source content '.repeat(60); idea.entries[2].content = full;
    await mount(idea); expect(host.querySelector('.idea-prompt-entry-text')?.textContent).toHaveLength(241);
    const disclosure = host.querySelector('.idea-prompt-full'); expect(disclosure?.textContent).toContain('查看完整内容'); expect(disclosure?.querySelector('p')?.textContent).toBe(full);
    await generate(); expect(field('Prompt 预览').value).toContain(full);
  });
  it('supports English and night preferences and invalidates the previous language preview', async () => {
    await act(async () => root.render(<PreferencesProvider><PreferenceControls/><IdeaPromptBuilder idea={source}/></PreferencesProvider>));
    await generate(); await click(button('English')); expect(button('Copy prompt').disabled).toBe(true);
    await click(button('Regenerate prompt')); expect(field('Prompt preview').value).toContain('Stage 1: Settle'); expect(field('Prompt preview').value).toContain('The first thought');
    await click(button('Night')); expect(document.documentElement.dataset.theme).toBe('night'); expect(button('Copy prompt').disabled).toBe(false);
  });
});
