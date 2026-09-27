import express, { type Request, type Response, type NextFunction } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PersonalStore } from './store';
import { PersonalError } from './types';
import { englishPayload } from './locale';

export function createPersonalApp(store: PersonalStore, frontendDist?: string, port = 3456) {
  const app = express();
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
    if (['POST', 'PATCH', 'PUT'].includes(req.method) && !req.is('application/json')) {
      res.status(415).json({ message: '请使用 JSON 请求。' }); return;
    }
    next();
  });
  // Up to 10,000 selected IDs can exceed the ordinary form payload limit.
  app.use('/api/personal/reading/remove', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, appVersion: '0.1.0', hubVersion: 'personal-garden-v1', time: new Date().toISOString() }));
  const route = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve().then(() => handler(req, res)).catch(next);
  };
  const base = '/api/personal';
  app.get(`${base}/state`, route(async (_req, res) => res.json(await store.state())));
  app.get(`${base}/settings`, (_req, res) => res.json(store.settings()));
  app.patch(`${base}/settings`, route((req, res) => res.json(store.updateSettings(req.body))));
  app.get(`${base}/todos`, (_req, res) => res.json(store.todos()));
  app.post(`${base}/todos`, route((req, res) => res.status(201).json(store.addTodo(req.body))));
  app.patch(`${base}/todos/:id`, route((req, res) => res.json(store.editTodo(req.params.id, req.body))));
  app.delete(`${base}/todos/:id`, route((req, res) => { store.deleteTodo(req.params.id); res.status(204).end(); }));
  app.get(`${base}/obsidian`, route((req, res) => res.json(store.vault(typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : ''))));
  app.get(`${base}/obsidian/note`, route((req, res) => res.json(store.note(req.query.path))));
  app.get(`${base}/calendar`, route(async (_req, res) => res.json(await store.calendarState())));
  app.post(`${base}/calendar/refresh`, route(async (_req, res) => res.json(await store.calendarState(true))));
  app.get(`${base}/finance`, (_req, res) => res.json(store.finance()));
  app.get(`${base}/reading`, route((_req, res) => res.json(store.reading())));
  app.post(`${base}/reading`, route((req, res) => res.status(201).json(store.addReading(req.body))));
  app.post(`${base}/reading/remove`, route((req, res) => res.json(store.removeReading(req.body))));
  app.post(`${base}/reading/:id/cover`, route(async (req, res) => res.json(await store.readingCover(req.params.id))));
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
