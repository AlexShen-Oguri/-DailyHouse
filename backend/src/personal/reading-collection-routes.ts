import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { READING_EXTENSION_ID, type ReadingCollectionService } from './reading-collection';

const route = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve().then(() => handler(req, res)).catch(next);
};

/** Mounted before ordinary API protection; the narrowly scoped router ends all
 * requests here, so extension permission never extends to personal APIs. */
export function mountReadingBridge(app: Express, service: ReadingCollectionService) {
  const router = express.Router();
  const origin = `chrome-extension://${READING_EXTENSION_ID}`;
  router.use((req, res, next) => {
    const requestOrigin = req.header('origin');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname) || requestOrigin !== origin) {
      res.status(403).json({ message: '这个浏览器来源不能访问采集桥接。' }); return;
    }
    res.setHeader('Cache-Control', 'no-store');
    if (requestOrigin) { res.setHeader('Access-Control-Allow-Origin', origin); res.vary('Origin'); }
    if (req.method === 'OPTIONS') {
      if (requestOrigin !== origin) { res.status(403).end(); return; }
      res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-DailyHouse-Extension');
      res.status(204).end(); return;
    }
    if (req.header('x-dailyhouse-extension') !== READING_EXTENSION_ID) { res.status(403).json({ message: '请使用小院历史读取扩展。' }); return; }
    if (req.method !== 'POST') { res.status(405).json({ message: '采集桥接只接受 POST 请求。' }); return; }
    if (!req.is('application/json')) { res.status(415).json({ message: '请使用 JSON 请求。' }); return; }
    next();
  });
  router.use(express.json({ limit: '4mb' }));
  router.post('/poll', route((req, res) => res.json(service.poll(req.body))));
  router.post('/:id/claim', route((req, res) => res.json(service.claim(req.params.id, req.body))));
  router.post('/:id/progress', route((req, res) => res.json(service.progress(req.params.id, req.body))));
  router.post('/:id/submit', route((req, res) => res.json(service.submit(req.params.id, req.body))));
  router.post('/:id/fail', route((req, res) => res.json(service.fail(req.params.id, req.body))));
  router.use((_req, res) => res.status(404).json({ message: '采集桥接入口不存在。' }));
  app.use('/api/reading-bridge', router);
}

export function mountReadingCollectionRoutes(app: Express, service: ReadingCollectionService) {
  const base = '/api/personal/reading/collection';
  app.get(base, route((_req, res) => res.json(service.state())));
  app.get(`${base}/setup`, route((_req, res) => res.json({ extensionPath: service.extensionPath })));
  app.post(base, route((req, res) => res.json(service.start(req.body))));
  app.post(`${base}/:id/cancel`, route((req, res) => res.json(service.cancel(req.params.id, req.body))));
  app.delete(`${base}/:id`, route((req, res) => {
    if (!req.is('application/json')) { res.status(415).json({ message: '请使用 JSON 请求。' }); return; }
    res.json(service.clear(req.params.id, req.body));
  }));
}
