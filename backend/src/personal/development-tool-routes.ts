import type { Express, NextFunction, Request, Response } from 'express';
import { discussionPreview, type DiscussionIdeaReader, type DevelopmentToolsService } from './development-tools';
import { PersonalError } from './types';

// Mount behind the existing loopback, host, origin and bounded JSON middleware.
export function mountDevelopmentToolRoutes(app: Express, tools: DevelopmentToolsService, ideas: DiscussionIdeaReader) {
  const route = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve().then(() => handler(req, res)).catch(next); };
  const base = '/api/personal/development-tools';
  app.get(base, route(async (_req, res) => res.set('Cache-Control', 'no-store').json(await tools.status())));
  app.post(`${base}/refresh`, route(async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) throw new PersonalError('请求包含不支持的字段');
    res.set('Cache-Control', 'no-store').json(await tools.status({ refresh: true }));
  }));
  app.post(`${base}/discussion-preview`, route((req, res) => res.set('Cache-Control', 'no-store').json(discussionPreview(ideas, req.body, req.acceptsLanguages('zh', 'en') === 'en' ? 'en' : 'zh'))));
}
