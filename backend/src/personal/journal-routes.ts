import type { Express, Request, Response, NextFunction } from 'express';
import { JournalStore } from './journal';

export function mountJournalRoutes(app: Express, journal: JournalStore) {
  const base = '/api/personal/journal';
  const route = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve().then(() => handler(req, res)).catch(next);
  };
  app.get(base, route((req, res) => res.json(journal.list(req.query.q ?? '', req.query.month ?? ''))));
  app.get(`${base}/trash`, route((_req, res) => res.json(journal.trash())));
  app.post(base, route((req, res) => res.status(201).json(journal.create(req.body))));
  app.post(`${base}/publish`, route((req, res) => res.json(journal.publish(req.body))));
  app.get(`${base}/:date`, route((req, res) => res.json(journal.get(req.params.date))));
  app.patch(`${base}/:date`, route((req, res) => res.json(journal.edit(req.params.date, req.body))));
  app.delete(`${base}/:date`, route((req, res) => { journal.remove(req.params.date, req.body); res.status(204).end(); }));
  app.post(`${base}/:date/restore`, route((req, res) => res.json(journal.restore(req.params.date, req.body))));
}
