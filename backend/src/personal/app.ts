import express, { type Request, type Response, type NextFunction } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PersonalStore } from './store';
import { PersonalError } from './types';
import { englishPayload } from './locale';
import { InspirationStore } from './inspiration-store';
import { mountInspirationRoutes } from './inspiration-routes';
import { LocalPicker } from './local-picker';
import { mountReadingImportRoutes } from './reading-import-routes';
import type { ReadingClassificationService } from './reading-classification-service';
import type { ProjectResumeService } from './project-resume';
import { mountProjectResumeRoutes } from './project-resume-routes';

export function createPersonalApp(store: PersonalStore, frontendDist?: string, port = 3456, inspiration?: InspirationStore, services: { picker?: LocalPicker; classification?: ReadingClassificationService; projects?: ProjectResumeService } = {}) {
  const app = express();
  const picker = services.picker ?? new LocalPicker();
  app.disable('x-powered-by');
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5180', 'http://localhost:5180']);
  app.use('/api', (req, res, next) => {
    const english = Boolean(req.header('accept-language')) && req.acceptsLanguages('zh', 'en') === 'en';
    res.setHeader('Content-Language', english ? 'en' : 'zh-CN');
    res.vary('Accept-Language');
    if (english) {
      const sendJson = res.json;
      res.json = function (value: unknown) { return sendJson.call(this, englishPayload(value)); };
    }
    next();
  });
  app.use('/api', (req, res, next) => {
    const hostname = req.hostname;
    const origin = req.header('origin');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname) || (origin && !origins.has(origin)) || req.header('sec-fetch-site') === 'cross-site') {
      res.status(403).json({ message: '仅允许从本机工作台访问。' }); return;
    }
    res.setHeader('Cache-Control', 'no-store');
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.vary('Origin'); }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept-Language');
      res.status(204).end(); return;
    }
    const fileUpload = req.method === 'POST' && req.originalUrl.split('?')[0] === '/api/personal/reading/quick-import/upload' && req.is('application/octet-stream');
    if (['POST', 'PATCH', 'PUT'].includes(req.method) && !req.is('application/json') && !fileUpload) {
      res.status(415).json({ message: '请使用 JSON 请求。' }); return;
    }
    next();
  });
  // Up to 10,000 selected IDs can exceed the ordinary form payload limit.
  app.use('/api/personal/reading/remove', express.json({ limit: '1mb' }));
  app.use('/api/personal/reading/restore', express.json({ limit: '1mb' }));
  app.use('/api/personal/reading/suppress', express.json({ limit: '4mb' }));
  app.use('/api/personal/reading/imports', express.json({ limit: '4mb' }));
  app.use('/api/personal/reading/quick-import', express.json({ limit: '256kb' }));
  app.use('/api/personal/inspiration', express.json({ limit: '128kb' }));
  app.use('/api/personal/ideas', (req, res, next) => {
    if (req.method === 'DELETE' && !req.is('application/json')) { res.status(415).json({ message: '请使用 JSON 请求。' }); return; }
    next();
  }, express.json({ limit: '128kb' }));
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, appVersion: '0.1.0', hubVersion: 'personal-garden-v1', time: new Date().toISOString() }));
  const route = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve().then(() => handler(req, res)).catch(next);
  };
  const base = '/api/personal';
  if (services.projects) mountProjectResumeRoutes(app, services.projects);
  app.post(`${base}/local-picker`, route(async (req, res) => {
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    req.on('aborted', abort); res.on('close', abort);
    try { const result = await picker.choose(req.body, req.acceptsLanguages('zh', 'en') === 'en', controller.signal); if (!res.destroyed) res.json(result); }
    finally { req.off('aborted', abort); res.off('close', abort); }
  }));
  app.get(`${base}/state`, route(async (_req, res) => res.json(await store.state())));
  app.get(`${base}/settings`, (_req, res) => res.json(store.settings()));
  app.patch(`${base}/settings`, route((req, res) => res.json(store.updateSettings(req.body))));
  app.get(`${base}/todos`, (_req, res) => res.json(store.todos()));
  app.post(`${base}/todos`, route((req, res) => res.status(201).json(store.addTodo(req.body))));
  app.patch(`${base}/todos/:id`, route((req, res) => res.json(store.editTodo(req.params.id, req.body))));
  app.delete(`${base}/todos/:id`, route((req, res) => { store.deleteTodo(req.params.id); res.status(204).end(); }));
  app.get(`${base}/ideas`, route((_req, res) => res.json(store.ideas())));
  app.post(`${base}/ideas`, route((req, res) => res.status(201).json(store.addIdea(req.body))));
  app.get(`${base}/ideas/trash`, route((_req, res) => res.json(store.ideasTrash())));
  if (!inspiration) app.delete(`${base}/ideas/trash/:id`, route((req, res) => { store.purgeIdea(req.params.id, req.body); res.json({ deletedId: req.params.id }); }));
  app.post(`${base}/ideas/:id/restore`, route((req, res) => res.json(store.restoreIdea(req.params.id, req.body))));
  app.get(`${base}/ideas/:id`, route((req, res) => res.json(store.idea(req.params.id))));
  app.patch(`${base}/ideas/:id`, route((req, res) => res.json(store.editIdea(req.params.id, req.body))));
  app.delete(`${base}/ideas/:id`, route((req, res) => { store.deleteIdea(req.params.id, req.body); res.status(204).end(); }));
  app.post(`${base}/ideas/:id/entries`, route((req, res) => res.status(201).json(store.addIdeaEntry(req.params.id, req.body))));
  app.patch(`${base}/ideas/:id/entries/:entryId`, route((req, res) => res.json(store.editIdeaEntry(req.params.id, req.params.entryId, req.body))));
  app.delete(`${base}/ideas/:id/entries/:entryId`, route((req, res) => res.json(store.deleteIdeaEntry(req.params.id, req.params.entryId, req.body))));
  app.get(`${base}/obsidian`, route((req, res) => res.json(store.vault(typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : ''))));
  app.get(`${base}/obsidian/note`, route((req, res) => res.json(store.note(req.query.path))));
  app.get(`${base}/calendar`, route(async (_req, res) => res.json(await store.calendarState())));
  app.post(`${base}/calendar/refresh`, route(async (_req, res) => res.json(await store.calendarState(true))));
  app.get(`${base}/finance`, (_req, res) => res.json(store.finance()));
  app.get(`${base}/reading`, route((_req, res) => res.json(store.reading())));
  app.post(`${base}/reading`, route((req, res) => {
    const item = store.addReading(req.body);
    services.classification?.enqueue([item.id]);
    res.status(201).json(item);
  }));
  app.post(`${base}/reading/remove`, route((req, res) => res.json(store.removeReading(req.body))));
  app.get(`${base}/reading/trash`, route((_req, res) => res.json(store.readingTrash())));
  app.delete(`${base}/reading/trash/:id`, route((req, res) => res.json(store.purgeReading(req.params.id, req.body))));
  app.post(`${base}/reading/restore`, route((req, res) => {
    const result = store.restoreReading(req.body);
    services.classification?.enqueue(result.restoredIds);
    res.json(result);
  }));
  app.post(`${base}/reading/suppress`, route((req, res) => res.json(store.suppressReading(req.body))));
  app.get(`${base}/reading/imports`, route((_req, res) => res.json(store.readingImports())));
  app.post(`${base}/reading/imports/preview`, route((req, res) => res.json(store.previewReadingImport(req.body))));
  app.post(`${base}/reading/imports`, route((req, res) => {
    const result = store.importReading(req.body);
    services.classification?.enqueue(result.items.map(item => item.id));
    res.status(201).json(result);
  }));
  app.post(`${base}/reading/imports/:id/undo`, route((req, res) => res.json(store.undoReadingImport(req.params.id))));
  app.post(`${base}/reading/:id/cover`, route(async (req, res) => res.json(await store.readingCover(req.params.id))));
  app.post(`${base}/reading/:id/todo`, route((req, res) => {
    const result = store.addReadingTodo(req.params.id, req.body);
    res.status(result.created ? 201 : 200).json(result);
  }));
  app.patch(`${base}/reading/:id`, route((req, res) => res.json(store.editReading(req.params.id, req.body))));
  app.delete(`${base}/reading/:id`, route((req, res) => { store.deleteReading(req.params.id); res.status(204).end(); }));
  app.get(`${base}/reading/:id/pdf`, (req, res, next) => {
    try {
      const file = store.readingPdf(req.params.id);
      res.type('application/pdf');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `inline; filename="${req.params.id.replaceAll(':', '-')}.pdf"`);
      res.sendFile(file, { dotfiles: 'deny' }, error => { if (error) next(error); });
    } catch (error) { next(error); }
  });
  mountReadingImportRoutes(app, store, { classification: services.classification });
  if (inspiration) mountInspirationRoutes(app, inspiration, store);
  app.use('/api', (_req, res) => res.status(404).json({ message: '这个功能已移除或不存在。' }));
  if (frontendDist && existsSync(join(frontendDist, 'index.html'))) {
    app.use(express.static(frontendDist));
    app.get('*', (_req, res) => res.sendFile(join(frontendDist, 'index.html')));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) { _next(error); return; }
    if (error instanceof PersonalError) { res.status(error.status).json({ message: error.message }); return; }
    if (error instanceof SyntaxError) { res.status(400).json({ message: '请求内容不是有效 JSON。' }); return; }
    if (typeof error === 'object' && error && 'status' in error && error.status === 413) { res.status(413).json({ message: '请求内容过大。' }); return; }
    res.status(500).json({ message: '本机操作未完成，请重试。' });
  });
  return app;
}
