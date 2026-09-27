import { createHash, randomUUID } from 'node:crypto';
import { constants, copyFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PersonalError, type ReadingAttachment, type ReadingType } from './types';

export const READING_FILE_LIMIT = 50 * 1024 * 1024;
const TEXT_LIMIT = 2 * 1024 * 1024;
const STAGING_MS = 24 * 60 * 60 * 1000;
const extensions = { pdf: 'application/pdf', epub: 'application/epub+zip', md: 'text/plain; charset=utf-8', txt: 'text/plain; charset=utf-8' } as const;
type Extension = keyof typeof extensions;
interface Upload { uploadId: string; title: string; type: ReadingType; name: string; size: number; excerpt?: string; attachment: ReadingAttachment; createdAt: number }

function safeName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\\/:<>"|?*\u0000-\u001f\u007f]/.test(value) || /[. ]$/.test(value) || /^\./.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) throw new PersonalError('文件名无效，请选择名称正常的 PDF、EPUB、MD 或 TXT 文件');
  return value.trim().normalize('NFC');
}
function extension(name: string): Extension {
  const ext = name.split('.').pop()?.toLowerCase();
  if (!ext || !Object.hasOwn(extensions, ext)) throw new PersonalError('仅支持 PDF、EPUB、MD 或 TXT 文件');
  return ext as Extension;
}
function uploadId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new PersonalError('上传记录不存在或已过期', 404);
  return value;
}
export function validateAttachment(value: unknown): asserts value is ReadingAttachment {
  if (!value || typeof value !== 'object') throw new PersonalError('附件记录无效');
  const a = value as ReadingAttachment;
  if (!/^[a-f0-9]{64}\.(pdf|epub|md|txt)$/.test(a.id) || a.id.split('.').pop() !== a.extension || !Number.isSafeInteger(a.size) || a.size <= 0 || a.size > READING_FILE_LIMIT || a.mime !== extensions[a.extension] || a.name !== safeName(a.name) || extension(a.name) !== a.extension || (a.excerpt !== undefined && (typeof a.excerpt !== 'string' || a.excerpt.length > 4000))) throw new PersonalError('附件记录无效');
}

export class ReadingAttachments {
  private inFlight = 0;
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  private directory(): void {
    mkdirSync(this.root, { recursive: true });
    if (lstatSync(this.root).isSymbolicLink()) throw new PersonalError('附件目录不可使用符号链接');
  }
  private file(id: string): string {
    const path = join(this.root, id);
    if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())) throw new PersonalError('附件文件不可读取', 409);
    return path;
  }
  async stage(nameValue: unknown, input: Readable): Promise<Upload> {
    const name = safeName(nameValue); const ext = extension(name);
    if (this.inFlight >= 2) throw new PersonalError('正在处理其他文件，请稍后重试', 429);
    this.directory(); this.cleanup(new Set(), true); this.inFlight++;
    const id = randomUUID(); const pending = this.file(`${id}.upload`);
    let size = 0; const hash = createHash('sha256');
    const limit = ext === 'md' || ext === 'txt' ? TEXT_LIMIT : READING_FILE_LIMIT;
    try {
      const meter = new Transform({ transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        if (size > limit) { done(new PersonalError(ext === 'md' || ext === 'txt' ? '文本文件不能超过 2 MiB' : '文件不能超过 50 MiB', 413)); return; }
        hash.update(chunk); done(null, chunk);
      } });
      await pipeline(input, meter, createWriteStream(pending, { flags: 'wx', mode: 0o600 }));
      if (!size) throw new PersonalError('文件为空，无法导入');
      const bytes = readFileSync(pending); let excerpt: string | undefined;
      if (ext === 'pdf') {
        if (!bytes.subarray(0, 8).toString('ascii').startsWith('%PDF-') || !bytes.subarray(Math.max(0, size - 2048)).includes(Buffer.from('%%EOF'))) throw new PersonalError('PDF 内容不完整或与文件后缀不符');
      } else if (ext === 'epub') {
        // EPUB requires the first uncompressed ZIP member to be its mimetype.
        if (size < 58 || bytes.readUInt32LE(0) !== 0x04034b50 || bytes.readUInt16LE(8) !== 0 || bytes.readUInt16LE(26) !== 8 || bytes.readUInt16LE(28) !== 0 || bytes.subarray(30, 38).toString('ascii') !== 'mimetype' || bytes.subarray(38, 58).toString('ascii') !== 'application/epub+zip' || !bytes.subarray(Math.max(0, size - 65557)).includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))) throw new PersonalError('EPUB 内容不完整或与文件后缀不符');
      } else {
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new PersonalError('文本文件需要使用 UTF-8 编码'); }
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new PersonalError('文件包含二进制内容，无法作为文本导入');
        excerpt = text.slice(0, 4000);
      }
      const attachment: ReadingAttachment = { id: `${hash.digest('hex')}.${ext}`, name, size, mime: extensions[ext], extension: ext, ...(excerpt ? { excerpt } : {}) };
      const result: Upload = { uploadId: id, title: name.replace(/\.[^.]+$/, '').slice(0, 300), type: ext === 'pdf' || ext === 'epub' ? 'book' : 'article', name, size, ...(excerpt ? { excerpt } : {}), attachment, createdAt: Date.now() };
      writeFileSync(this.file(`${id}.json`), JSON.stringify(result), { flag: 'wx', mode: 0o600 });
      return result;
    } catch (error) { rmSync(pending, { force: true }); throw error; }
    finally { this.inFlight--; }
  }
  get(id: string): Upload {
    uploadId(id);
    try {
      const metadata: Upload = JSON.parse(readFileSync(this.file(`${id}.json`), 'utf8'));
      if (metadata.uploadId !== id || !Number.isFinite(metadata.createdAt) || metadata.createdAt + STAGING_MS < Date.now()) throw new Error();
      validateAttachment(metadata.attachment);
      const pending = this.file(`${id}.upload`);
      if (!existsSync(pending) || lstatSync(pending).size !== metadata.attachment.size) throw new Error();
      return metadata;
    } catch { throw new PersonalError('上传记录不存在或已过期，请重新选择文件', 410); }
  }
  commit(id: string): ReadingAttachment {
    const upload = this.get(id); this.directory();
    const target = this.file(upload.attachment.id);
    if (!existsSync(target)) copyFileSync(this.file(`${id}.upload`), target, constants.COPYFILE_EXCL);
    return upload.attachment;
  }
  removeUpload(id: string): void {
    uploadId(id); this.directory();
    rmSync(this.file(`${id}.upload`), { force: true });
    rmSync(this.file(`${id}.json`), { force: true });
  }
  path(attachment: ReadingAttachment): string {
    validateAttachment(attachment);
    const path = this.file(attachment.id);
    if (!existsSync(path)) throw new PersonalError('附件文件不存在，请重新导入', 404);
    return path;
  }
  purgeManagedCopy(attachment: ReadingAttachment, commit: () => void): boolean {
    validateAttachment(attachment);
    this.directory();
    const path = this.file(attachment.id);
    if (!existsSync(path)) { commit(); return false; }
    const quarantine = this.file(`${attachment.id}.${randomUUID()}.purge`);
    // A failed metadata save must not leave a recoverable item without bytes.
    try { renameSync(path, quarantine); }
    catch { throw new PersonalError('本机附件正在使用，关闭文件后重试永久删除', 409); }
    try { commit(); } catch (error) { renameSync(quarantine, path); throw error; }
    try { rmSync(quarantine); return false; } catch { return true; }
  }
  recoverPurges(retained: Set<string>): void {
    if (!existsSync(this.root) || lstatSync(this.root).isSymbolicLink()) return;
    for (const name of readdirSync(this.root)) {
      const match = name.match(/^([a-f0-9]{64}\.(?:pdf|epub|md|txt))\.[a-f0-9-]{36}\.purge$/);
      if (!match) continue;
      const quarantined = this.file(name), original = this.file(match[1]);
      // After a crash, persisted references decide whether the quarantine
      // belongs to an interrupted deletion or a committed permanent removal.
      if (retained.has(match[1]) && !existsSync(original)) renameSync(quarantined, original);
      else rmSync(quarantined, { force: true });
    }
  }
  cleanup(retained: Set<string>, stagingOnly = false): void {
    if (!existsSync(this.root) || lstatSync(this.root).isSymbolicLink()) return;
    for (const name of readdirSync(this.root)) {
      if (stagingOnly && !/^[a-f0-9-]{36}\.(json|upload)$/.test(name)) continue;
      if (!/^[a-f0-9]{64}\.(pdf|epub|md|txt)(?:\.[a-f0-9-]{36}\.purge)?$/.test(name) && !/^[a-f0-9-]{36}\.(json|upload)$/.test(name)) continue;
      const path = join(this.root, name); const info = lstatSync(path);
      if (info.isSymbolicLink() || !info.isFile() || retained.has(name)) continue;
      if (Date.now() - info.mtimeMs > STAGING_MS) rmSync(path, { force: true });
    }
  }
}
