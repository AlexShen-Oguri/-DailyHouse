import type { Express, NextFunction, Request, Response } from 'express';
import type { PrivateSyncService } from './private-sync';
import type { SharedProjectStore } from './shared-projects';
import { PersonalError } from './types';

export function mountPrivateSyncRoutes(app: Express, sync: PrivateSyncService) {
  const route = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve().then(() => handler(req, res)).catch(next); };
  const base = '/api/personal/private-sync';
  const payload = (req: Request, allowed: string[]) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(key => !allowed.includes(key))) throw new PersonalError('同步请求包含无效字段。');
    return req.body as Record<string, unknown>;
  };
  app.get(`${base}/status`, route((_req, res) => res.json(sync.status())));
  app.post(`${base}/preview`, route(async (req, res) => res.json(await sync.preview(payload(req, ['scopes']).scopes))));
  app.post(`${base}/approve`, route(async (req, res) => { const value = payload(req, ['previewId', 'confirmed']); res.json(await sync.approve(value.previewId, value.confirmed)); }));
  app.post(`${base}/run`, route(async (req, res) => { payload(req, []); res.json(await sync.run()); }));
  app.post(`${base}/pause`, route((req, res) => { payload(req, []); res.json(sync.pause()); }));
  app.post(`${base}/resume`, route((req, res) => { payload(req, []); res.json(sync.resume()); }));
  app.get(`${base}/devices`, route(async (_req, res) => res.json(await sync.devices())));
  app.post(`${base}/devices/:id/revoke`, route(async (req, res) => res.json(await sync.revoke(req.params.id, payload(req, ['confirmed']).confirmed))));
  app.post(`${base}/conflicts/:id/resolve`, route(async (req, res) => { const value = payload(req, ['choice', 'confirmed', 'body']); res.json(await sync.resolve(req.params.id, value.choice, value.confirmed, value.body)); }));
}
export function mountSharedProjectRoutes(app: Express, projects: SharedProjectStore) {
  const route = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve().then(() => handler(req, res)).catch(next); };
  const base = '/api/personal/shared-projects';
  app.get(base, route((_req, res) => res.json(projects.list())));
  app.post(base, route((req, res) => res.status(201).json(projects.create(req.body))));
  app.get(`${base}/trash`, route((_req, res) => res.json(projects.trash())));
  app.patch(`${base}/:id`, route((req, res) => res.json(projects.edit(req.params.id, req.body))));
  app.delete(`${base}/:id`, route((req, res) => { projects.remove(req.params.id, req.body); res.status(204).end(); }));
  app.post(`${base}/:id/restore`, route((req, res) => res.json(projects.restore(req.params.id, req.body))));
  app.delete(`${base}/trash/:id`, route((req, res) => { projects.purge(req.params.id, req.body); res.status(204).end(); }));
  app.post(`${base}/:id/link`, route(async (req, res) => res.json(await projects.link(req.params.id, req.body))));
  app.delete(`${base}/:id/link`, route((req, res) => res.json(projects.unlink(req.params.id, req.body))));
  app.post(`${base}/:id/handoff-preview`, route(async (req, res) => res.json(await projects.handoff(req.params.id, req.body))));
}
