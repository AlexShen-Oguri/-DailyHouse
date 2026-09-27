import type { Express, NextFunction, Request, Response } from 'express';
import { ProjectResumeService } from './project-resume';

export function mountProjectResumeRoutes(app: Express, projects: ProjectResumeService) {
  const route = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve().then(() => handler(req, res)).catch(next); };
  const base = '/api/personal';
  app.get(`${base}/project-resume`, route(async (_req, res) => res.json(await projects.list())));
  app.post(`${base}/project-resume/refresh`, route(async (_req, res) => res.json(await projects.refresh())));
  app.get(`${base}/project-resume/trash`, route((_req, res) => res.json(projects.trash())));
  app.post(`${base}/project-resume/restore`, route((req, res) => res.json(projects.restore(req.body))));
  app.post(`${base}/project-resume/trash/purge`, route((req, res) => res.json(projects.purge(req.body))));
  app.get(`${base}/project-resume/:id/history`, route(async (req, res) => res.json(await projects.history(req.params.id, req.query))));
  app.delete(`${base}/project-resume/:id`, route((req, res) => { projects.remove(req.params.id); res.status(204).end(); }));
  app.get(`${base}/inspiration/:id/launch`, route((req, res) => res.json(projects.launchForIdea(req.params.id))));
  app.post(`${base}/inspiration/:id/launch`, route((req, res) => res.status(202).json(projects.launch(req.params.id, req.body))));
  app.get(`${base}/project-launches/:id`, route((req, res) => res.json(projects.operation(req.params.id))));
  app.delete(`${base}/project-launches/:id`, route((req, res) => { projects.removeOperation(req.params.id, req.body); res.status(204).end(); }));
  app.post(`${base}/project-launches/:id/retry`, route((req, res) => res.status(202).json(projects.retry(req.params.id))));
}
