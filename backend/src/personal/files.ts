import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, realpathSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { PersonalError, type DesktopFile } from './types';

const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor', 'AppData', '$RECYCLE.BIN', 'System Volume Information']);
const MAX_NOTE_BYTES = 1024 * 1024;

export function safeLocalPath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 2048 || value.includes('\0')) throw new PersonalError(`${label}路径无效`);
  const path = value.trim();
  if (!path) return '';
  if (!isAbsolute(path) || path.startsWith('\\\\') || path.startsWith('//')) throw new PersonalError(`请使用本机的${label}绝对路径`);
  return resolve(path);
}

export function withinRoot(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

export function verifyVault(path: string): string {
  if (!path) throw new PersonalError('尚未连接 Obsidian 仓库');
  try {
    if (lstatSync(path).isSymbolicLink() || !statSync(path).isDirectory()) throw new Error();
    const config = join(path, '.obsidian');
    if (lstatSync(config).isSymbolicLink() || !statSync(config).isDirectory()) throw new Error();
    return realpathSync(path);
  } catch {
    throw new PersonalError('请选择包含 .obsidian 文件夹的本机仓库根目录');
  }
}

function walkMetadata(root: string, maxDepth: number, maxFiles: number, markdownOnly: boolean): { files: DesktopFile[]; truncated: boolean } {
  const files: DesktopFile[] = [];
  const started = Date.now();
  let truncated = false;
  let inspected = 0;
  function walk(directory: string, depth: number) {
    if (Date.now() - started > 2500 || inspected > 20000 || files.length >= maxFiles) { truncated = true; return; }
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (Date.now() - started > 2500 || inspected++ > 20000 || files.length >= maxFiles) { truncated = true; break; }
      if (entry.name.startsWith('.') || entry.isSymbolicLink() || SKIP_DIRECTORIES.has(entry.name)) continue;
      const absolute = join(directory, entry.name);
      try {
        if (lstatSync(absolute).isSymbolicLink() || !withinRoot(root, realpathSync(absolute))) continue;
        if (entry.isDirectory()) { if (depth < maxDepth) walk(absolute, depth + 1); continue; }
        if (!entry.isFile()) continue;
        const extension = extname(entry.name).toLowerCase();
        if (markdownOnly && extension !== '.md') continue;
        if (!markdownOnly && ['.lnk', '.url', '.ini', '.exe', '.dll', '.ico', '.key', '.pem', '.pfx', '.p12'].includes(extension)) continue;
        if (/^(credentials|id_rsa|id_ed25519|desktop\.ini|thumbs\.db)$/i.test(entry.name)) continue;
        const info = statSync(absolute);
        const relativePath = relative(root, absolute).split(sep).join('/');
        files.push({ id: createHash('sha256').update(relativePath).digest('hex').slice(0, 20), name: entry.name, relativePath, extension, size: info.size, modifiedAt: info.mtime.toISOString() });
      } catch { /* A file disappearing during a read does not abort the whole list. */ }
    }
  }
  walk(root, 0);
  return { files: files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)), truncated };
}

export function scanDesktopMetadata(desktopPath: string) {
  try {
    if (!statSync(desktopPath).isDirectory()) throw new Error();
    const { files, truncated } = walkMetadata(realpathSync(desktopPath), 2, 500, false);
    return { status: 'ready' as const, files, scannedAt: new Date().toISOString(), message: truncated ? '已读取前 500 项或达到扫描时间限制；只读取文件名称、大小和修改时间。' : '仅查看桌面及两层子目录的文件信息，不读取正文、不移动文件。' };
  } catch {
    return { status: 'error' as const, files: [] as DesktopFile[], scannedAt: null, message: '无法读取桌面目录，请检查本机目录权限。' };
  }
}

export function listVaultNotes(vaultPath: string, query = '') {
  if (!vaultPath) return { status: 'unconfigured' as const, name: '', notes: [], lastReadAt: null, message: '填写本机 Obsidian 仓库路径后，即可只读浏览 Markdown 笔记。' };
  try {
    const root = verifyVault(vaultPath);
    const { files, truncated } = walkMetadata(root, 12, 5000, true);
    const needle = query.trim().toLocaleLowerCase();
    const notes = files.filter(file => !needle || file.relativePath.toLocaleLowerCase().includes(needle)).map(file => ({ path: file.relativePath, title: basename(file.name, extname(file.name)), modifiedAt: file.modifiedAt, size: file.size }));
    return { status: 'ready' as const, name: basename(root), notes, lastReadAt: new Date().toISOString(), message: truncated ? '仓库较大，已显示当前扫描范围内的笔记。按文件名或路径搜索。' : '按文件名或路径搜索；笔记保留在你的 Obsidian 仓库中。' };
  } catch (error) {
    return { status: 'error' as const, name: basename(vaultPath), notes: [], lastReadAt: null, message: error instanceof PersonalError ? error.message : '仓库暂时无法读取。' };
  }
}

export function readVaultNote(vaultPath: string, requestedPath: unknown) {
  const root = verifyVault(vaultPath);
  if (typeof requestedPath !== 'string' || !requestedPath || requestedPath.length > 2048 || requestedPath.includes('\0') || isAbsolute(requestedPath) || requestedPath.includes(':')) throw new PersonalError('笔记路径无效');
  const parts = requestedPath.replaceAll('\\', '/').split('/');
  if (parts.some(part => !part || part.startsWith('.') || SKIP_DIRECTORIES.has(part)) || extname(requestedPath).toLowerCase() !== '.md') throw new PersonalError('只允许读取仓库内的 Markdown 笔记');
  let absolute = root;
  try {
    for (const part of parts) {
      absolute = join(absolute, part);
      if (lstatSync(absolute).isSymbolicLink()) throw new PersonalError('不读取符号链接中的笔记');
    }
    if (!withinRoot(root, realpathSync(absolute))) throw new PersonalError('笔记必须位于已连接的仓库内');
    const info = statSync(absolute);
    if (!info.isFile() || info.size > MAX_NOTE_BYTES) throw new PersonalError('只预览不超过 1 MB 的 Markdown 笔记');
    return { path: parts.join('/'), title: basename(absolute, extname(absolute)), content: readFileSync(absolute, 'utf8') };
  } catch (error) {
    if (error instanceof PersonalError) throw error;
    throw new PersonalError('笔记不存在或暂时无法读取', 404);
  }
}

export function verifyCalendarFile(path: string): void {
  if (!path) return;
  try {
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isFile() || extname(path).toLowerCase() !== '.ics' || info.size > 2 * 1024 * 1024) throw new Error();
  } catch {
    throw new PersonalError('请选择可读取、大小不超过 2 MB 的本机 .ics 日历文件');
  }
}
