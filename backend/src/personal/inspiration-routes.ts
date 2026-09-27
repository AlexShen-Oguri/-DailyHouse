import type { Express, Request, Response, NextFunction } from 'express';
import { InspirationError } from './inspiration-ai';
import { InspirationStore, type ProjectTodoStore } from './inspiration-store';

// Mount after the existing localhost/origin/JSON middleware, before API 404.
export function mountInspirationRoutes(app: Express, store: InspirationStore, todos: ProjectTodoStore) {
  const route = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve().then(() => handler(req, res)).catch(error => {
      if (error instanceof InspirationError) { if (!res.destroyed && !res.headersSent) res.status(error.status).json({ message: req.acceptsLanguages('zh', 'en') === 'en' ? error.english : error.message }); return; }
      next(error);
    });
  };
  const base = '/api/personal';
  app.get(`${base}/inspiration`, route(async (req, res) => {
    const state = await store.bubbles();
    if (req.acceptsLanguages('zh', 'en') === 'en') state.ai.message = state.ai.configured ? 'The local model is ready. Only your selected idea context is used.' : 'The local model is unavailable. Start Ollama and install the selected model; other idea features remain available.';
    res.json(state);
  }));
  app.post(`${base}/inspiration`, route((req, res) => res.status(201).json(store.add(req.body))));
  app.post(`${base}/inspiration/merge`, route((req, res) => res.status(201).json(store.merge(req.body))));
  app.get(`${base}/inspiration/trash`, route((_req, res) => res.json(store.trash('bubble'))));
  app.delete([`${base}/inspiration/trash/:id`, `${base}/ideas/trash/:id`], route((req, res) => { store.purge(req.params.id, 'bubble', req.body); res.status(204).end(); }));
  app.post(`${base}/inspiration/restore`, route((req, res) => res.json(store.restore(req.body, 'bubble'))));
  app.patch(`${base}/inspiration/:id`, route((req, res) => res.json(store.edit(req.params.id, req.body))));
  app.delete(`${base}/inspiration/:id`, route((req, res) => { store.remove(req.params.id, 'bubble', req.body?.revision); res.status(204).end(); }));
  app.post(`${base}/inspiration/:id/conversations`, route(async (req, res) => {
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    req.on('aborted', abort); res.on('close', abort);
    try { const conversation = await store.converse(req.params.id, req.body, controller.signal); if (!res.destroyed) res.status(201).json(conversation); }
    finally { req.off('aborted', abort); res.off('close', abort); }
  }));
  app.delete(`${base}/inspiration/:id/conversations/:conversationId`, route((req, res) => { store.removeConversation(req.params.id, req.params.conversationId); res.status(204).end(); }));
  app.delete(`${base}/inspiration/:id/conversations/:conversationId/turns/:messageId`, route((req, res) => res.json(store.removeConversationTurn(req.params.id, req.params.conversationId, req.params.messageId))));
  app.post(`${base}/inspiration/:id/brainstorm`, route(async (req, res) => {
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    req.on('aborted', abort); res.on('close', abort);
    try { const draft = await store.brainstorm(req.params.id, req.body, controller.signal); if (!res.destroyed) res.status(201).json(draft); }
    finally { req.off('aborted', abort); res.off('close', abort); }
  }));
  app.patch(`${base}/inspiration/:id/drafts/:draftId`, route((req, res) => res.json(store.editDraft(req.params.id, req.params.draftId, req.body))));
  app.delete(`${base}/inspiration/:id/drafts/:draftId`, route((req, res) => { store.removeDraft(req.params.id, req.params.draftId); res.status(204).end(); }));
  app.post(`${base}/inspiration/:id/project`, route((req, res) => { const result = store.convert(req.params.id, req.body); res.status(result.created ? 201 : 200).json(result); }));
  app.post(`${base}/inspiration/:id/project/undo`, route((req, res) => res.json(store.undoConversion(req.params.id))));
  app.get(`${base}/projects`, route((_req, res) => res.json(store.projects())));
  app.get(`${base}/projects/trash`, route((_req, res) => res.json(store.trash('project'))));
  app.delete(`${base}/projects/trash/:id`, route((req, res) => { store.purge(req.params.id, 'project', req.body); res.status(204).end(); }));
  app.post(`${base}/projects/restore`, route((req, res) => res.json(store.restore(req.body, 'project'))));
  app.patch(`${base}/projects/:id`, route((req, res) => res.json(store.editProject(req.params.id, req.body))));
  app.delete(`${base}/projects/:id`, route((req, res) => { store.remove(req.params.id, 'project'); res.status(204).end(); }));
  app.post(`${base}/projects/:id/todo`, route((req, res) => res.json(store.addTodo(req.params.id, todos))));
}
