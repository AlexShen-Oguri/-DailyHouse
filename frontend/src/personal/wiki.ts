import type { Note } from './api';
function normalize(path: string) {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/').replace(/\.md$/i, '') + '.md';
}
/** Match a relative or vault path first; never choose an arbitrary duplicate. */
export function resolveWikiLink(currentPath: string, target: string, notes: Note[]): Note | undefined {
  const clean = target.split('#')[0].trim();
  if (!clean) return notes.find(n => n.path === currentPath);
  const folder = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/') + 1) : '';
  const relative = normalize(folder + clean);
  const absolute = normalize(clean);
  const local = clean.startsWith('/') ? undefined : notes.find(n => n.path === relative);
  if (local) return local;
  if (clean.startsWith('./') || clean.startsWith('../')) return undefined;
  const root = notes.find(n => n.path === absolute);
  if (root) return root;
  if (clean.includes('/')) return undefined;
  const matches = notes.filter(n => n.path.split('/').pop() === absolute);
  return matches.length === 1 ? matches[0] : undefined;
}
