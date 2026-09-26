import { describe, expect, it } from 'vitest';
import { suggestLink } from './reading-model';
describe('reading link suggestions', () => {
  it('recognizes real provider domains without trusting lookalikes', () => {
    expect(suggestLink('https://github.com/example/project/tree/main')).toEqual({ type: 'github', title: 'example/project' });
    expect(suggestLink('https://www.bilibili.com/video/BV123')?.type).toBe('video');
    expect(suggestLink('https://www.coursera.org/learn/programming')?.type).toBe('course');
    expect(suggestLink('https://github.com.evil.example/a/b')).toBeNull();
  });
  it('does not suggest executable URLs or URLs containing credentials', () => {
    expect(suggestLink('javascript:alert(1)')).toBeNull();
    expect(suggestLink('https://name:password@github.com/a/b')).toBeNull();
  });
});
