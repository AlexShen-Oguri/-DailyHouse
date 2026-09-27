import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { LocalInspirationProvider, InspirationError, inspirationStrings, inspirationText, validateDirections, type BrainstormPurpose, type InspirationDirection, type InspirationProvider, type InspirationChatMessage } from './inspiration-ai';
import { PersonalError, type Idea, type IdeaSummary, type PersonalTodo } from './types';

export interface BubbleSource { id: string; title: string; body: string; updatedAt: string; sources?: BubbleSource[]; conversations?: InspirationConversation[]; drafts?: InspirationDraft[] }
export interface InspirationDraft { id: string; purpose: BrainstormPurpose; context: string; sourceIds: string[]; directions: InspirationDirection[]; model: string; createdAt: string; updatedAt: string }
export interface InspirationMessage extends InspirationChatMessage { id: string; createdAt: string }
export interface InspirationConversation { id: string; sourceIds: string[]; model: string; messages: InspirationMessage[]; createdAt: string; updatedAt: string }
export interface InspirationBubble { canonicalStatus?: Idea['status']; id: string; title: string; body: string; tags: string[]; pinned: boolean; status: 'active' | 'archived'; sources: BubbleSource[]; projectId?: string; drafts: InspirationDraft[]; conversations: InspirationConversation[]; createdAt: string; updatedAt: string; revision: number }
export interface InspirationProject { id: string; title: string; goal: string; mvp: string[]; acceptance: string[]; nextStep: string; nextStepId: string; sourceBubbleId: string; sourceSnapshot: BubbleSource; draftId?: string; status: 'active' | 'done' | 'archived'; createdAt: string; updatedAt: string; revision: number; todoId?: string; finishedAt?: string }
export interface InspirationTrash<T> { item: T; deletedAt: string; expiresAt: string }
interface BubbleMetadata { id: string; tags: string[]; pinned: boolean; sources: BubbleSource[]; projectId?: string; drafts: InspirationDraft[]; conversations: InspirationConversation[]; revision: number }
interface SavedGarden { version: 2; metadata: BubbleMetadata[]; projects: InspirationProject[]; projectTrash: InspirationTrash<InspirationProject>[]; expiredIds: string[] }
export interface CanonicalIdeaStore {
  ideas(): { items: { id: string }[] };
  idea(id: string): Idea;
  addIdeaWithId(id: string, value: unknown): Idea;
  editIdea(id: string, value: unknown): Idea;
  deleteIdea(id: string, value: unknown): void;
  ideasTrash(): { items: (IdeaSummary & { deletedAt: string; expiresAt: string })[] };
  restoreIdea(id: string, value: unknown): Idea;
  purgeIdea(id: string, value: unknown): void;
}
export interface ProjectTodoStore { addProjectTodo(key: string, title: string): { todo?: PersonalTodo; todoId: string; deleted: boolean; created?: boolean }; }
export const INSPIRATION_TRASH_MS = 30 * 24 * 60 * 60 * 1000;
function object(value: unknown, allowed: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InspirationError('请求必须是一个对象', 'The request must be an object.');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new InspirationError('请求包含不支持的字段', 'The request contains unsupported fields.');
  return body;
}
function bool(value: unknown) { if (typeof value !== 'boolean') throw new InspirationError('开关值无效', 'Invalid boolean value.'); return value; }
function tags(value: unknown) { return [...new Set(inspirationStrings(value, '标签', 8, 32))]; }
function ids(value: unknown, min = 1, max = 100) { const result = [...new Set(inspirationStrings(value, 'ID', max, 100))]; if (result.length < min) throw new InspirationError(`请选择至少 ${min} 项`, `Select at least ${min} items.`); return result; }
function snapshot(bubble: InspirationBubble): BubbleSource { return { id: bubble.id, title: bubble.title, body: bubble.body, updatedAt: bubble.updatedAt, ...(bubble.sources.length ? { sources: structuredClone(bubble.sources) } : {}), ...(bubble.conversations.length ? { conversations: structuredClone(bubble.conversations) } : {}), ...(bubble.drafts.length ? { drafts: structuredClone(bubble.drafts) } : {}) }; }
function timestamp() { return new Date().toISOString(); }
function excerpt(text: string, limit: number) { return text.length <= limit ? text : `${text.slice(0, Math.floor(limit / 2) - 10)}\n[…]\n${text.slice(-Math.ceil(limit / 2) + 10)}`; }
function validateConversations(value: unknown): InspirationConversation[] {
  if (value === undefined) return [];
  const invalid = () => { throw new Error('Inspiration conversation data is invalid; restore a backup before starting.'); };
  if (!Array.isArray(value) || value.length > 30) return invalid();
  const seen = new Set<string>();
  for (const c of value) {
    if (!c || typeof c.id !== 'string' || !c.id || seen.has(c.id) || typeof c.model !== 'string' || !Array.isArray(c.sourceIds) || c.sourceIds.length > 8 || c.sourceIds.some((id: unknown) => typeof id !== 'string') || !Number.isFinite(Date.parse(c.createdAt)) || !Number.isFinite(Date.parse(c.updatedAt)) || !Array.isArray(c.messages) || c.messages.length % 2 !== 0 || c.messages.length > 100) return invalid();
    seen.add(c.id); const messageIds = new Set<string>();
    for (const [i, m] of c.messages.entries()) { if (!m || typeof m.id !== 'string' || !m.id || messageIds.has(m.id) || m.role !== (i % 2 ? 'assistant' : 'user') || typeof m.content !== 'string' || !m.content.trim() || m.content.length > (m.role === 'user' ? 3000 : 12000) || !Number.isFinite(Date.parse(m.createdAt))) return invalid(); messageIds.add(m.id); }
  }
  return structuredClone(value as InspirationConversation[]);
}

export class InspirationStore {
  private data: SavedGarden = { version: 2, metadata: [], projects: [], projectTrash: [], expiredIds: [] };
  private inFlight = new Set<string>();
  constructor(private readonly dataFile: string, private readonly ideas: CanonicalIdeaStore, private readonly provider: InspirationProvider = new LocalInspirationProvider()) {
    if (!existsSync(dataFile)) return;
    const data = JSON.parse(readFileSync(dataFile, 'utf8')) as SavedGarden;
    if (data.version !== 2 || !['metadata', 'projects', 'projectTrash', 'expiredIds'].every(key => Array.isArray(data[key as keyof SavedGarden]))) throw new Error('Inspiration garden data is invalid; restore a backup before starting.');
    const all = [...data.metadata, ...data.projects, ...data.projectTrash.map(t => t.item)];
    if (all.some(item => !item || typeof item.id !== 'string' || !item.id || !Number.isInteger(item.revision)) || new Set(all.map(item => item.id)).size !== all.length) throw new Error('Inspiration garden records are invalid; restore a backup before starting.');
    this.data = { ...data, metadata: data.metadata.map(m => ({ ...m, conversations: validateConversations(m.conversations) })) };
  }
  private persist(next: SavedGarden) {
    const expired = next.projectTrash.filter(t => Date.parse(t.expiresAt) <= Date.now()).map(t => t.item.id);
    const retainedIdeas = new Set([...this.ideas.ideas().items.map(i => i.id), ...this.ideas.ideasTrash().items.map(i => i.id)]);
    // Keep newly reserved metadata until its canonical idea is created. Expired
    // or orphaned metadata is discarded on the next explicit garden write.
    next = { ...next, metadata: next.metadata.filter(m => retainedIdeas.has(m.id) || !this.data.metadata.some(old => old.id === m.id)), projectTrash: next.projectTrash.filter(t => Date.parse(t.expiresAt) > Date.now()), expiredIds: [...new Set([...next.expiredIds, ...expired])].slice(-10000) };
    mkdirSync(dirname(this.dataFile), { recursive: true });
    writeFileSync(`${this.dataFile}.tmp`, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(`${this.dataFile}.tmp`, this.dataFile);
    this.data = next;
  }
  private meta(id: string): BubbleMetadata { return this.data.metadata.find(m => m.id === id) ?? { id, tags: [], pinned: false, sources: [], drafts: [], conversations: [], revision: 1 }; }
  private expiredProject(id: string) { return this.data.expiredIds.includes(id) || this.data.projectTrash.some(t => t.item.id === id && Date.parse(t.expiresAt) <= Date.now()); }
  private present(idea: Idea): InspirationBubble { const metadata = structuredClone(this.meta(idea.id)); if (metadata.projectId && this.expiredProject(metadata.projectId)) delete metadata.projectId; return { ...metadata, title: idea.title, body: idea.entries.map(e => e.content).join('\n\n'), status: idea.status === 'growing' ? 'active' : 'archived', canonicalStatus: idea.status, createdAt: idea.createdAt, updatedAt: idea.updatedAt, revision: idea.revision }; }
  private bubble(id: string) { return this.present(this.ideas.idea(id)); }
  private metadataWith(item: BubbleMetadata) { return [...this.data.metadata.filter(m => m.id !== item.id), item]; }
  private project(id: string) { const item = this.data.projects.find(b => b.id === id); if (!item) throw new InspirationError('项目不存在或已移入回收站', 'The project does not exist or is in the recycle bin.', 404); return item; }
  private updateBubble(item: InspirationBubble) { const { id, tags, pinned, sources, projectId, drafts, conversations } = item; const metadata = { id, tags, pinned, sources, ...(projectId ? { projectId } : {}), drafts, conversations, revision: this.meta(id).revision + 1 }; this.persist({ ...this.data, metadata: this.metadataWith(metadata) }); return this.bubble(id); }
  private updateProject(item: InspirationProject) { this.persist({ ...this.data, projects: this.data.projects.map(b => b.id === item.id ? item : b) }); return structuredClone(item); }
  async bubbles() { return { items: this.ideas.ideas().items.map(item => this.bubble(item.id)), trashCount: this.trash('bubble').items.length, ai: await this.provider.status() }; }
  projects() { return { items: structuredClone(this.data.projects), trashCount: this.trash('project').items.length }; }
  add(value: unknown) {
    const body = object(value, ['title', 'body', 'tags', 'pinned']);
    if (this.ideas.ideas().items.length + this.ideas.ideasTrash().items.length >= 5000) throw new InspirationError('灵感已达 5000 条上限', 'The garden has reached its 5,000 idea limit.');
    const now = timestamp();
    const item: InspirationBubble = { id: randomUUID(), title: inspirationText(body.title, '标题', 120), body: inspirationText(body.body, '灵感内容', 8000, true), tags: body.tags === undefined ? [] : tags(body.tags), pinned: body.pinned === undefined ? false : bool(body.pinned), status: 'active', sources: [], drafts: [], conversations: [], createdAt: now, updatedAt: now, revision: 1 };
    const { id, tags: itemTags, pinned, sources, drafts, conversations, revision } = item;
    this.persist({ ...this.data, metadata: this.metadataWith({ id, tags: itemTags, pinned, sources, drafts, conversations, revision }) });
    return this.present(this.ideas.addIdeaWithId(id, { title: item.title, content: item.body || item.title }));
  }
  edit(id: string, value: unknown) {
    const body = object(value, ['title', 'tags', 'pinned', 'status', 'sourceIds', 'revision']);
    const current = this.bubble(id); const item = { ...current, updatedAt: timestamp(), revision: current.revision + 1 };
    if ('title' in body) item.title = inspirationText(body.title, '标题', 120);
    if ('tags' in body) item.tags = tags(body.tags);
    if ('pinned' in body) item.pinned = bool(body.pinned);
    if ('status' in body) { if (!['active', 'archived'].includes(String(body.status))) throw new InspirationError('灵感状态无效', 'Invalid idea status.'); item.status = body.status as InspirationBubble['status']; }
    if ('sourceIds' in body) { const retained = ids(body.sourceIds, 0, 8); if (retained.some(sourceId => !current.sources.some(s => s.id === sourceId))) throw new InspirationError('只能移除已有来源，不能替换融合来源', 'You can remove existing sources, but cannot replace merge sources.'); item.sources = current.sources.filter(s => retained.includes(s.id)); }
    this.ideas.editIdea(id, { title: item.title, status: 'status' in body ? (item.status === 'active' ? 'growing' : 'parked') : current.canonicalStatus, revision: body.revision });
    return this.updateBubble(item);
  }
  merge(value: unknown) {
    const body = object(value, ['ids', 'title', 'body', 'tags']);
    const selected = ids(body.ids, 2, 8).map(id => this.bubble(id));
    if (selected.some(b => b.status !== 'active')) throw new InspirationError('请先恢复已归档的灵感再融合', 'Reopen archived ideas before merging.');
    if (selected.reduce((n, b) => n + b.body.length, 0) > 64000) throw new InspirationError('所选来源时间线过长，请先把要融合的内容整理为简短想法', 'The selected source timelines are too long. Capture a concise idea for each source before merging.');
    if (JSON.stringify(selected.map(snapshot)).length > 256000) throw new InspirationError('所选融合来源包含的历史过多，请先整理为简短想法再融合。', 'These fusion sources contain too much history. Capture concise ideas before merging them.');
    // Create a fresh node; only existing nodes can be sources, so cycles cannot form.
    if (this.ideas.ideas().items.length + this.ideas.ideasTrash().items.length >= 5000) throw new InspirationError('灵感已达 5000 条上限', 'The garden has reached its 5,000 idea limit.');
    const now = timestamp();
    const merged: InspirationBubble = { id: randomUUID(), title: inspirationText(body.title, '标题', 120), body: inspirationText(body.body, '灵感内容', 8000, true), tags: body.tags === undefined ? [] : tags(body.tags), pinned: false, status: 'active', sources: selected.map(snapshot), drafts: [], conversations: [], createdAt: now, updatedAt: now, revision: 1 };
    const { id, tags: itemTags, pinned, sources, drafts, conversations, revision } = merged;
    this.persist({ ...this.data, metadata: this.metadataWith({ id, tags: itemTags, pinned, sources, drafts, conversations, revision }) });
    return this.present(this.ideas.addIdeaWithId(id, { title: merged.title, content: merged.body || merged.title }));
  }
  trash(kind: 'bubble'): { items: InspirationTrash<InspirationBubble>[] };
  trash(kind: 'project'): { items: InspirationTrash<InspirationProject>[] };
  trash(kind: 'bubble' | 'project'): { items: InspirationTrash<InspirationBubble | InspirationProject>[] } { return { items: kind === 'bubble' ? this.ideas.ideasTrash().items.map(idea => ({ deletedAt: idea.deletedAt, expiresAt: idea.expiresAt, item: { ...this.meta(idea.id), ...idea, body: idea.preview, canonicalStatus: idea.status, status: idea.status === 'growing' ? 'active' : 'archived' } })) : structuredClone(this.data.projectTrash.filter(t => Date.parse(t.expiresAt) > Date.now())) }; }
  remove(id: string, kind: 'bubble' | 'project', revision?: unknown) {
    const deletedAt = timestamp(), expiresAt = new Date(Date.now() + INSPIRATION_TRASH_MS).toISOString();
    if (kind === 'bubble') { this.ideas.deleteIdea(id, { revision }); }
    else { const item = this.project(id); this.persist({ ...this.data, projects: this.data.projects.filter(b => b.id !== id), projectTrash: [{ item, deletedAt, expiresAt }, ...this.data.projectTrash] }); }
  }
  restore(value: unknown, kind: 'bubble' | 'project') {
    const selected = ids(object(value, ['ids']).ids);
    if (kind === 'bubble') { const available = new Set(this.ideas.ideasTrash().items.map(i => i.id)); if (selected.some(id => !available.has(id))) throw new InspirationError('回收站中找不到所选记录或已到期', 'A selected idea is missing or its restore period expired.', 410); for (const id of selected) this.ideas.restoreIdea(id, {}); return { restoredIds: selected }; }
    const trash = this.data.projectTrash;
    for (const id of selected) {
      const entry = trash.find(t => t.item.id === id);
      if (this.data.expiredIds.includes(id) || (entry && Date.parse(entry.expiresAt) <= Date.now())) throw new InspirationError('记录已超过 30 天恢复期限', 'The 30-day restore period has expired.', 410);
      if (!entry) throw new InspirationError('回收站中找不到所选记录', 'A selected record was not found in the recycle bin.', 404);
    }
    {
      const restored = this.data.projectTrash.filter(t => selected.includes(t.item.id)).map(t => t.item);
      const links = new Map<string, string>();
      for (const item of restored) {
        const source = this.meta(item.sourceBubbleId);
        const existing = links.get(item.sourceBubbleId) ?? source?.projectId;
        if (existing && existing !== item.id) throw new InspirationError('原灵感已关联另一个项目，无法恢复重复关联', 'The source idea is linked to another project; restore would create a conflicting link.', 409);
        links.set(item.sourceBubbleId, item.id);
      }
      const relink = (b: BubbleMetadata) => links.has(b.id) ? { ...b, projectId: links.get(b.id), revision: b.revision + 1, updatedAt: timestamp() } : b;
      this.persist({ ...this.data, projects: [...restored, ...this.data.projects], projectTrash: this.data.projectTrash.filter(t => !selected.includes(t.item.id)), metadata: this.data.metadata.map(relink) });
    }
    return { restoredIds: selected };
  }
  purge(id: string, kind: 'bubble' | 'project', value: unknown) {
    if (kind === 'bubble') {
      const body = object(value, ['deletedAt']);
      if (typeof body.deletedAt !== 'string' || !Number.isFinite(Date.parse(body.deletedAt))) throw new InspirationError('请提供回收站中的删除时间。', 'Provide the recycle-bin deletion timestamp.');
      try { this.ideas.purgeIdea(id, body); }
      catch (error) {
        // The canonical write can succeed before the separate metadata write
        // fails. A retry may finish only this orphaned metadata cleanup; it
        // must never remove metadata for an active or still-recoverable idea.
        const orphan = error instanceof PersonalError && error.status === 404
          && this.data.metadata.some(m => m.id === id)
          && !this.ideas.ideas().items.some(idea => idea.id === id)
          && !this.ideas.ideasTrash().items.some(idea => idea.id === id);
        if (!orphan) throw error;
      }
      this.persist({ ...this.data, metadata: this.data.metadata.filter(m => m.id !== id) });
      return;
    }
    const body = object(value, ['deletedAt']);
    if (typeof body.deletedAt !== 'string' || !Number.isFinite(Date.parse(body.deletedAt))) throw new InspirationError('请提供回收站中的删除时间。', 'Provide the recycle-bin deletion timestamp.');
    const removed = this.data.projectTrash.find(t => t.item.id === id);
    if (!removed) throw new InspirationError('回收站中找不到所选项目', 'The selected project is not in the recycle bin.', 404);
    if (removed.deletedAt !== body.deletedAt) throw new InspirationError('这条回收记录已更新，请刷新后重试。', 'This recycle-bin record changed. Refresh and retry.', 409);
    // Purging is confined to website records. Source ideas, Codex projects,
    // working directories, repositories and unrelated tasks are never touched.
    this.persist({ ...this.data, projectTrash: this.data.projectTrash.filter(t => t.item.id !== id), expiredIds: [...new Set([...this.data.expiredIds, id])], metadata: this.data.metadata.map(m => { if (m.projectId !== id) return m; const next = { ...m, revision: m.revision + 1 }; delete next.projectId; return next; }) });
  }
  async converse(id: string, value: unknown, signal?: AbortSignal) {
    const body = object(value, ['message', 'conversationId', 'includeSourceIds', 'language', 'expectedRevision', 'expectedUpdatedAt']);
    const original = this.bubble(id), metadataRevision = this.meta(id).revision;
    if (body.expectedRevision !== undefined && body.expectedRevision !== original.revision) throw new InspirationError('灵感已更新，请刷新后接着聊。', 'The idea changed. Refresh before continuing.', 409);
    if (original.status !== 'active') throw new InspirationError('请先重新打开这个灵感再接着聊。', 'Reopen this idea before continuing.');
    if (this.inFlight.has(id)) throw new InspirationError('这个灵感正在思考中，请稍等。', 'This idea is already thinking. Please wait.', 409);
    if (this.inFlight.size >= 1) throw new InspirationError('本机模型正在思考另一个灵感，请稍等。', 'The local model is thinking about another idea. Please wait.', 429);
    const message = inspirationText(body.message, '本次消息', 3000);
    const conversationId = body.conversationId === undefined ? undefined : inspirationText(body.conversationId, '对话 ID', 100);
    const old = conversationId ? original.conversations.find(c => c.id === conversationId) : undefined;
    if (conversationId && !old) throw new InspirationError('这段对话已被删除，请重新开始。', 'This conversation was removed. Start a new one.', 404);
    if (old && body.expectedUpdatedAt !== undefined && body.expectedUpdatedAt !== old.updatedAt) throw new InspirationError('这段对话已更新，请刷新后继续。', 'This conversation changed. Refresh before continuing.', 409);
    if (!old && original.conversations.length >= 30) throw new InspirationError('每个灵感最多保留 30 段对话，请先删除不需要的对话。', 'An idea can keep up to 30 conversations. Delete an unused one first.');
    if (old && old.messages.length >= 100) throw new InspirationError('这段对话已聊满 50 轮，可以在同一灵感中另开一段。', 'This conversation has reached 50 turns. Start another conversation in this idea.');
    if (body.language !== undefined && !['zh', 'en'].includes(String(body.language))) throw new InspirationError('语言设置无效', 'Invalid language.');
    const sourceIds = old?.sourceIds ?? (body.includeSourceIds === undefined ? original.sources.map(s => s.id) : ids(body.includeSourceIds, 0, 8));
    if (sourceIds.some(sourceId => !original.sources.some(s => s.id === sourceId))) throw new InspirationError('对话中的融合来源已移除，请另开一段对话。', 'A source used by this conversation was removed. Start a new conversation.');
    if (old && body.includeSourceIds !== undefined && JSON.stringify(ids(body.includeSourceIds, 0, 8).sort()) !== JSON.stringify([...old.sourceIds].sort())) throw new InspirationError('已有对话的来源不能替换，可以另开一段。', 'An existing conversation keeps its sources. Start a new one to change them.');
    if (!this.provider.converse) throw new InspirationError('本机对话服务尚未就绪。', 'The local conversation service is not ready.', 503);
    const selected = original.sources.filter(s => sourceIds.includes(s.id));
    const sources = selected.map(source => ({ title: source.title, body: excerpt(source.body + (source.conversations?.[0]?.messages.length ? '\nEarlier exploration:\n' + source.conversations[0].messages.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n') : ''), Math.floor(1400 / Math.max(1, selected.length))) }));
    const context = { title: original.title, body: excerpt(original.body, selected.length ? 900 : 2200), sources };
    let remaining = Math.max(0, 6200 - JSON.stringify(context).length - message.length);
    const history: InspirationChatMessage[] = [];
    for (let i = (old?.messages.length ?? 0) - 2; i >= 0 && remaining > 200; i -= 2) {
      const pair = old!.messages.slice(i, i + 2).map(m => ({ role: m.role, content: excerpt(m.content, Math.min(1000, Math.floor((remaining - 80) / 2))) }));
      remaining -= JSON.stringify(pair).length; history.unshift(...pair);
    }
    this.inFlight.add(id);
    try {
      const response = await this.provider.converse({ ...context, messages: [...history, { role: 'user', content: message }], language: body.language === 'en' ? 'en' : 'zh' }, signal);
      if (signal?.aborted) throw new InspirationError('已停止这次思考，对话没有改动。', 'Thinking stopped. Your conversation is unchanged.', 499);
      const current = this.bubble(id);
      if (current.revision !== original.revision || this.meta(id).revision !== metadataRevision) throw new InspirationError('灵感或对话在思考期间有修改，这次回复没有保存，请刷新后重试。', 'The idea or conversation changed while thinking. This reply was not saved. Refresh and retry.', 409);
      const content = inspirationText(response.content, 'AI 回复', 12000);
      const now = new Date(Math.max(Date.now(), old ? Date.parse(old.updatedAt) + 1 : 0)).toISOString();
      const conversation: InspirationConversation = { id: old?.id ?? randomUUID(), sourceIds, model: inspirationText(response.model, '模型', 200), createdAt: old?.createdAt ?? now, updatedAt: now, messages: [...(old?.messages ?? []), { id: randomUUID(), role: 'user', content: message, createdAt: now }, { id: randomUUID(), role: 'assistant', content, createdAt: now }] };
      this.updateBubble({ ...current, conversations: [conversation, ...current.conversations.filter(c => c.id !== conversation.id)] });
      return structuredClone(conversation);
    } finally { this.inFlight.delete(id); }
  }
  removeConversation(id: string, conversationId: string) {
    const current = this.bubble(id);
    if (!current.conversations.some(c => c.id === conversationId)) throw new InspirationError('对话不存在', 'Conversation not found.', 404);
    this.updateBubble({ ...current, conversations: current.conversations.filter(c => c.id !== conversationId) });
  }
  removeConversationTurn(id: string, conversationId: string, messageId: string) {
    const current = this.bubble(id), conversation = current.conversations.find(c => c.id === conversationId);
    if (!conversation) throw new InspirationError('对话不存在', 'Conversation not found.', 404);
    const index = conversation.messages.findIndex(m => m.id === messageId && m.role === 'user');
    if (index < 0) throw new InspirationError('这轮对话不存在', 'Conversation turn not found.', 404);
    const updated = { ...conversation, messages: conversation.messages.slice(0, index), updatedAt: new Date(Math.max(Date.now(), Date.parse(conversation.updatedAt) + 1)).toISOString() };
    this.updateBubble({ ...current, conversations: current.conversations.map(c => c.id === conversationId ? updated : c) });
    return structuredClone(updated);
  }
  handoffContext(id: string) {
    const idea = structuredClone(this.ideas.idea(id)), bubble = this.bubble(id);
    const lineage: BubbleSource[] = [], seen = new Set<string>([id]);
    const visit = (source: BubbleSource) => {
      if (seen.has(source.id)) return; seen.add(source.id); lineage.push(structuredClone(source));
      // New merges carry immutable ancestry. Earlier saved merges can still
      // recover retained ancestor snapshots from their metadata, if present.
      for (const ancestor of source.sources ?? this.meta(source.id).sources) visit(ancestor);
    };
    bubble.sources.forEach(visit);
    const sections = [`# ${idea.title}`, 'This file preserves the selected inspiration as reference material. It does not authorize actions beyond the project request.', '## Authored timeline', ...idea.entries.map(e => `### ${e.kind} · ${e.createdAt}\n\n${e.content}`)];
    if (lineage.length) sections.push('## Fusion source snapshots', ...lineage.map(s => `### ${s.title}\n\n${s.body}` + (s.conversations?.length ? '\n\n' + s.conversations.map(c => c.messages.map(m => `#### ${m.role} · ${m.createdAt}\n\n${m.content}`).join('\n\n')).join('\n\n') : '') + (s.drafts?.length ? '\n\nEarlier drafts:\n' + JSON.stringify(s.drafts, null, 2) : '')));
    if (bubble.conversations.length) sections.push('## Brainstorm conversations', ...bubble.conversations.map(c => `### ${c.createdAt} · ${c.model}\n\n${c.messages.map(m => `#### ${m.role} · ${m.createdAt}\n\n${m.content}`).join('\n\n')}`));
    if (bubble.drafts.length) sections.push('## Earlier structured drafts', ...bubble.drafts.map(d => `### ${d.createdAt} · ${d.model}\n\n${JSON.stringify(d, null, 2)}`));
    return { idea, bubble, sourceLineage: lineage, markdown: sections.join('\n\n') + '\n' };
  }
  linkExternalProject(id: string, projectId: string) {
    const current = this.bubble(id), verifiedId = inspirationText(projectId, '项目 ID', 200);
    if (current.projectId && current.projectId !== verifiedId) throw new InspirationError('这个灵感已关联另一个项目。', 'This idea is already linked to another project.', 409);
    return this.updateBubble({ ...current, projectId: verifiedId });
  }
  async brainstorm(id: string, value: unknown, signal?: AbortSignal) {
    const body = object(value, ['purpose', 'context', 'includeSourceIds', 'language', 'expectedRevision', 'ideaExcerpt']);
    const original = this.bubble(id), originalMetadataRevision = this.meta(id).revision;
    if (body.expectedRevision !== undefined && body.expectedRevision !== original.revision) throw new InspirationError('灵感已在其他页面修改，请刷新发送预览后重试', 'The idea changed on another page. Refresh the context preview and retry.', 409);
    if (original.status !== 'active') throw new InspirationError('请先恢复已归档的灵感', 'Reopen the archived idea first.');
    if (this.inFlight.has(id)) throw new InspirationError('这个灵感已有一次发散正在进行', 'This idea already has a brainstorm in progress.', 409);
    if (this.inFlight.size >= 1) throw new InspirationError('请等待当前发散完成后再试', 'Wait for the current brainstorm to finish.', 429);
    if (original.drafts.length >= 20) throw new InspirationError('每个灵感最多保留 20 份草稿，请先移除不需要的草稿', 'An idea can keep up to 20 drafts. Remove an unused draft first.');
    const purpose = body.purpose as BrainstormPurpose;
    if (!['directions', 'mvp', 'feasibility'].includes(purpose)) throw new InspirationError('发散目的无效', 'Invalid brainstorm purpose.');
    const context = inspirationText(body.context, '补充说明', 3000, true);
    const ideaExcerpt = body.ideaExcerpt === undefined ? original.body : inspirationText(body.ideaExcerpt, '本次灵感摘录', 3500);
    const sourceIds = body.includeSourceIds === undefined ? [] : ids(body.includeSourceIds, 0, 8);
    if (sourceIds.some(sourceId => !original.sources.some(s => s.id === sourceId))) throw new InspirationError('选择了不属于此灵感的来源', 'A selected source does not belong to this idea.');
    if (body.language !== undefined && !['zh', 'en'].includes(String(body.language))) throw new InspirationError('语言设置无效', 'Invalid language.');
    this.inFlight.add(id);
    try {
      const response = await this.provider.brainstorm({ title: original.title, body: ideaExcerpt, sources: original.sources.filter(s => sourceIds.includes(s.id)).map(({ title, body }) => ({ title, body })), purpose, context, language: body.language === 'en' ? 'en' : 'zh' }, signal);
      if (signal?.aborted) throw new InspirationError('本次发散已取消', 'Brainstorm cancelled.', 499);
      const current = this.bubble(id);
      if (current.revision !== original.revision || this.meta(id).revision !== originalMetadataRevision) throw new InspirationError('灵感在发散期间有修改，本次草稿未保存；请用最新内容重试', 'The idea changed during brainstorming. The draft was not saved; retry using the latest content.', 409);
      const now = timestamp();
      const draft: InspirationDraft = { id: randomUUID(), purpose, context, sourceIds, directions: validateDirections(response.directions), model: response.model, createdAt: now, updatedAt: now };
      this.updateBubble({ ...current, drafts: [draft, ...current.drafts], updatedAt: now, revision: current.revision + 1 });
      return structuredClone(draft);
    } finally { this.inFlight.delete(id); }
  }
  editDraft(id: string, draftId: string, value: unknown) {
    const body = object(value, ['directions', 'expectedUpdatedAt']); const current = this.bubble(id); const old = current.drafts.find(d => d.id === draftId);
    if (!old) throw new InspirationError('草稿不存在', 'Draft not found.', 404);
    if (body.expectedUpdatedAt !== old.updatedAt) throw new InspirationError('草稿已更新，请刷新后再编辑', 'The draft changed. Refresh before editing.', 409);
    const draft = { ...old, directions: validateDirections(body.directions), updatedAt: new Date(Math.max(Date.now(), Date.parse(old.updatedAt) + 1)).toISOString() };
    this.updateBubble({ ...current, drafts: current.drafts.map(d => d.id === draftId ? draft : d), updatedAt: timestamp(), revision: current.revision + 1 });
    return structuredClone(draft);
  }
  removeDraft(id: string, draftId: string) { const current = this.bubble(id); if (!current.drafts.some(d => d.id === draftId)) throw new InspirationError('草稿不存在', 'Draft not found.', 404); this.updateBubble({ ...current, drafts: current.drafts.filter(d => d.id !== draftId), updatedAt: timestamp(), revision: current.revision + 1 }); }
  convert(id: string, value: unknown) {
    const body = object(value, ['title', 'goal', 'mvp', 'acceptance', 'nextStep', 'draftId']);
    const current = this.bubble(id);
    if (current.projectId) { const project = this.data.projects.find(p => p.id === current.projectId); if (project) return { project: structuredClone(project), created: false }; throw new InspirationError('关联项目已移入回收站，请恢复项目；重复确认不会新建项目', 'The linked project is in the recycle bin. Restore it; repeated confirmation will not create another project.', 409); }
    if (current.status !== 'active') throw new InspirationError('请先恢复已归档的灵感再立项', 'Reopen the archived idea before creating a project.');
    if (this.data.projects.length + this.data.projectTrash.length >= 2000) throw new InspirationError('项目已达 2000 条上限', 'The project library has reached its 2,000 record limit.');
    const draftId = body.draftId === undefined ? undefined : inspirationText(body.draftId, '草稿 ID', 100);
    if (draftId && !current.drafts.some(d => d.id === draftId)) throw new InspirationError('所选草稿不存在', 'The selected draft does not exist.', 404);
    const now = timestamp();
    const project: InspirationProject = { id: randomUUID(), title: inspirationText(body.title, '标题', 120), goal: inspirationText(body.goal, '目标', 2000), mvp: inspirationStrings(body.mvp, 'MVP'), acceptance: inspirationStrings(body.acceptance, '验收标准'), nextStep: inspirationText(body.nextStep, '下一步', 200), nextStepId: randomUUID(), sourceBubbleId: id, sourceSnapshot: snapshot(current), ...(draftId ? { draftId } : {}), status: 'active', createdAt: now, updatedAt: now, revision: 1 };
    this.persist({ ...this.data, projects: [project, ...this.data.projects], metadata: this.metadataWith({ ...this.meta(id), projectId: project.id, revision: this.meta(id).revision + 1 }) });
    return { project: structuredClone(project), created: true };
  }
  editProject(id: string, value: unknown) {
    const body = object(value, ['title', 'goal', 'mvp', 'acceptance', 'nextStep', 'status', 'revision']); const current = this.project(id); const item = { ...current, updatedAt: timestamp(), revision: current.revision + 1 };
    if (body.revision !== current.revision) throw new InspirationError('项目已更新，请刷新后再编辑', 'The project changed. Refresh before editing.', 409);
    if ('title' in body) item.title = inspirationText(body.title, '标题', 120);
    if ('goal' in body) item.goal = inspirationText(body.goal, '目标', 2000);
    if ('mvp' in body) item.mvp = inspirationStrings(body.mvp, 'MVP');
    if ('acceptance' in body) item.acceptance = inspirationStrings(body.acceptance, '验收标准');
    if ('nextStep' in body) { item.nextStep = inspirationText(body.nextStep, '下一步', 200); if (item.nextStep !== current.nextStep) { item.nextStepId = randomUUID(); delete item.todoId; } }
    if ('status' in body) { if (!['active', 'done', 'archived'].includes(String(body.status))) throw new InspirationError('项目状态无效', 'Invalid project status.'); item.status = body.status as InspirationProject['status']; if (item.status === 'done' && !item.finishedAt) item.finishedAt = timestamp(); if (item.status === 'active') delete item.finishedAt; }
    return this.updateProject(item);
  }
  undoConversion(id: string) {
    const current = this.bubble(id);
    if (!current.projectId) return { undone: false };
    const project = this.project(current.projectId);
    if (project.revision !== 1 || project.todoId) throw new InspirationError('项目已有后续编辑或待办，无法撤销立项；可以在项目库中归档或移除', 'The project has later edits or a task. Keep it, or archive/remove it in the project library.', 409);
    const bubble = { ...this.meta(id), revision: this.meta(id).revision + 1 }; delete bubble.projectId;
    const deletedAt = timestamp();
    this.persist({ ...this.data, metadata: this.metadataWith(bubble), projects: this.data.projects.filter(p => p.id !== project.id), projectTrash: [{ item: project, deletedAt, expiresAt: new Date(Date.now() + INSPIRATION_TRASH_MS).toISOString() }, ...this.data.projectTrash] });
    return { undone: true, projectId: project.id };
  }
  addTodo(id: string, todos: ProjectTodoStore) {
    const project = this.project(id);
    if (project.status !== 'active') throw new InspirationError('请先重新开启项目再加入待办', 'Reopen the project before adding its next step.');
    // Reserve the intent before writing to the separate todo file. The todo
    // store's durable key keeps retries safe even if either process write fails.
    if (!project.todoId) this.updateProject({ ...project, revision: project.revision + 1, updatedAt: timestamp() });
    const result = todos.addProjectTodo(`inspiration:${project.id}:${project.nextStepId}`, project.nextStep);
    const current = this.project(id);
    if (current.todoId !== result.todoId) this.updateProject({ ...current, todoId: result.todoId, revision: current.revision + 1, updatedAt: timestamp() });
    return { ...result, created: result.created ?? (!project.todoId && !result.deleted) };
  }
}
