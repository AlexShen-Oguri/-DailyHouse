import { describe, expect, it } from 'vitest';
import { resolveWikiLink } from './wiki';
const notes = ['课程/索引.md', '课程/笔记.md', '项目/笔记.md', '归档/独一篇.md'].map(path => ({ path, title: path.split('/').pop()!, size: 1, modifiedAt: '' }));
describe('Obsidian wiki links', () => {
  it('keeps same-folder links local and honors explicit relative paths', () => {
    expect(resolveWikiLink('课程/索引.md', '笔记#小节', notes)?.path).toBe('课程/笔记.md');
    expect(resolveWikiLink('课程/索引.md', '../项目/笔记', notes)?.path).toBe('项目/笔记.md');
  });
  it('uses vault-root and unique basename matches', () => {
    expect(resolveWikiLink('课程/索引.md', '/项目/笔记.md', notes)?.path).toBe('项目/笔记.md');
    expect(resolveWikiLink('课程/索引.md', '独一篇', notes)?.path).toBe('归档/独一篇.md');
  });
  it('does not choose arbitrary duplicate or escape above vault root', () => {
    expect(resolveWikiLink('其他/索引.md', '笔记', notes)).toBeUndefined();
    expect(resolveWikiLink('课程/索引.md', '../../项目/笔记', notes)).toBeUndefined();
  });
});
