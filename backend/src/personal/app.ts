import express, { type Request, type Response, type NextFunction } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PersonalStore } from './store';
import { PersonalError } from './types';

export function createPersonalApp(store: PersonalStore, frontendDist?: string, port = 3456) {
  const app = express();
  app.disable('x-powered-by');
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5180', 'http://localhost:5180']);
  app.use('/api', (req, res, next) => {
    const hostname = req.hostname;
    const origin = req.header('origin');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname) || (origin && !origins.has(origin)) || req.header('sec-fetch-site') === 'cross-site') {
      res.status(403).json({ message: '仅允许从本机工作台访问。' }); return;
    }
    res.setHeader('Cache-Control', 'no-store');
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.status(204).end(); return;
    }
    if (['POST', 'PATCH', 'PUT'].includes(req.method) && !req.is('application/json')) {
      res.status(415).json({ message: '请使用 JSON 请求。' }); return;
    }
    next();
  });
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
  app.get(`${base}/desktop`, (_req, res) => res.json(store.desktopState()));
  app.post(`${base}/desktop/scan`, route((_req, res) => res.json(store.scanDesktop())));
  app.get(`${base}/obsidian`, route((req, res) => res.json(store.vault(typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : ''))));
  app.get(`${base}/obsidian/note`, route((req, res) => res.json(store.note(req.query.path))));
  app.get(`${base}/calendar`, route(async (_req, res) => res.json(await store.calendarState())));
  app.post(`${base}/calendar/refresh`, route(async (_req, res) => res.json(await store.calendarState(true))));
  app.get(`${base}/finance`, (_req, res) => res.json(store.finance()));
  app.use('/api', (_req, res) => res.status(404).json({ message: '这个功能已移除或不存在。' }));
  if (frontendDist && existsSync(join(frontendDist, 'index.html'))) {
    app.use(express.static(frontendDist));
    app.get('*', (_req, res) => res.sendFile(join(frontendDist, 'index.html')));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof PersonalError) { res.status(error.status).json({ message: error.message }); return; }
    if (error instanceof SyntaxError) { res.status(400).json({ message: '请求内容不是有效 JSON。' }); return; }
    if (typeof error === 'object' && error && 'status' in error && error.status === 413) { res.status(413).json({ message: '请求内容过大。' }); return; }
    res.status(500).json({ message: '本机操作未完成，请重试。' });
  });
  return app;
}
