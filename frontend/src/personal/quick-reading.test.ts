import { describe, expect, it } from 'vitest';
import { linkEntries, parseLinkFile, readCsv } from './quick-reading-model';

describe('manual import file parsing', () => {
  it('accepts a list of links without confusing host lookalikes with Bilibili', () => {
    expect(linkEntries('https://www.bilibili.com/video/BVtest\n\nhttps://github.com/a/b')).toEqual([{ url: 'https://www.bilibili.com/video/BVtest', type: 'video', title: '' }, { url: 'https://github.com/a/b', type: 'github', title: 'a/b' }]);
    expect(linkEntries('https://github.com.example/a/b')).toEqual([{ url: 'https://github.com.example/a/b' }]);
  });
  it('parses Windows and macOS link files, rejecting executable links', () => {
    expect(parseLinkFile('My repo.url', '[InternetShortcut]\r\nURL=https://github.com/a/b\r\n')[0]).toMatchObject({ title: 'My repo', type: 'github' });
    expect(parseLinkFile('Garden.webloc', '<plist><dict><key>URL</key><string>https://example.com/?a=1&amp;b=2</string></dict></plist>')[0].url).toBe('https://example.com/?a=1&b=2');
    expect(() => parseLinkFile('bad.url', '[InternetShortcut]\nURL=javascript:alert(1)')).toThrow();
  });
  it('handles quoted CSV notes and BOM JSON without treating unknown classification fields as manual choices', () => {
    const csv = 'url,title,notes,category\r\nhttps://example.com,"A, B","line one\nline ""two""",design';
    expect(parseLinkFile('list.csv', csv)[0]).toMatchObject({ title: 'A, B', notes: 'line one\nline "two"', category: 'design' });
    expect(parseLinkFile('list.json', '\uFEFF{"items":[{"url":"https://example.com","category":"invented"}]}')[0].category).toBeUndefined();
    expect(() => readCsv('url\n"unfinished')).toThrow();
  });
  it('rejects rows without a URL and batches beyond the displayed limit', () => {
    expect(() => parseLinkFile('list.json', '{"items":[{"title":"missing URL"}]}')).toThrow();
    expect(() => parseLinkFile('list.json', JSON.stringify(Array.from({ length: 31 }, () => ({ url: 'https://example.com' }))))).toThrow();
  });
});
