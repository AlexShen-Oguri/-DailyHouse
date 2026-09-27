import type { Express, Request, Response, NextFunction } from 'express';
import { basename, dirname } from 'node:path';
import type { PersonalStore } from './store';
import { READING_FILE_LIMIT } from './reading-attachments';
import { PersonalError } from './types';

interface ClassificationQueue { enqueue(ids?: string[]): void; retry(id: string): unknown }

// The host mounts this behind its localhost/origin guard. Only the exact upload
// route is exempt from JSON: its bytes stream directly into a managed copy.
export function mountReadingImportRoutes(app: Express, store: PersonalStore, options: { classification?: ClassificationQueue } = {}) {
  const route = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve().then(() => handler(req, res)).catch(next);
  };
  const base = '/api/personal/reading';
  app.post(`${base}/quick-import/upload`, route(async (req, res) => {
    if (!req.is('application/octet-stream')) throw new PersonalError('请选择文件上传', 415);
    const length = req.header('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > READING_FILE_LIMIT)) throw new PersonalError('文件不能超过 50 MiB', 413);
    const { attachment: _attachment, createdAt: _createdAt, ...result } = await store.readingAttachments.stage(req.query.filename, req);
    if (!res.destroyed) res.status(201).json(result);
  }));
  app.delete(`${base}/quick-import/uploads/:id`, route((req, res) => { store.readingAttachments.removeUpload(req.params.id); res.status(204).end(); }));
  app.post(`${base}/quick-import/preview`, route((req, res) => res.json(store.previewQuickReadingImport(req.body))));
  app.post(`${base}/quick-import/apply`, route((req, res) => {
    const result = store.importQuickReading(req.body);
    options.classification?.enqueue(result.items.map(item => item.id));
    res.status(201).json(result);
  }));
  app.post(`${base}/:id/classify`, route((req, res) => {
    if (!options.classification) throw new PersonalError('本机分类服务尚未启动，请稍后重试', 503);
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) throw new PersonalError('分类重试不接受其他参数');
    options.classification.retry(req.params.id);
    res.status(202).json(store.reading().items.find(item => item.id === req.params.id));
  }));
  app.get(`${base}/:id/attachment`, (req, res, next) => {
    try {
      const { attachment, path } = store.readingAttachment(req.params.id);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const download = req.query.download === '1' || attachment.extension === 'epub';
      const plainText = !download && (attachment.extension === 'md' || attachment.extension === 'txt');
      // Plain UTF-8 text is never parsed as HTML (including Markdown). Keep a
      // deny-all policy without sandbox's opaque-origin navigation restriction.
      // Documents/downloads remain sandboxed, with only file saving allowed.
      const policy = "default-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
      res.setHeader('Content-Security-Policy', `${plainText ? '' : 'sandbox allow-downloads; '}${policy}`);
      res.setHeader('Referrer-Policy', 'no-referrer');
      // Restrict sendFile to the validated attachment directory. Passing its
      // entire absolute path makes Express reject harmless hidden parents such
      // as an isolated .runtime fixture or a user's .local data directory.
      const fileOptions = { root: dirname(path), dotfiles: 'deny' as const };
      if (download) {
        res.download(basename(path), attachment.name, { ...fileOptions, headers: { 'Content-Type': attachment.mime } }, error => { if (error) next(error); });
      } else {
        res.type(attachment.mime);
        res.setHeader('Content-Disposition', `inline; filename="reading.${attachment.extension}"; filename*=UTF-8''${encodeURIComponent(attachment.name)}`);
        res.sendFile(basename(path), fileOptions, error => { if (error) next(error); });
      }
    } catch (error) { next(error); }
  });
}
