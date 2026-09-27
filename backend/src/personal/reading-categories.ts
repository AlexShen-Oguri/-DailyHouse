import { PersonalError, type ReadingCategory } from './types';

export const READING_CATEGORIES: ReadingCategory[] = ['programming_ai', 'technology', 'design', 'science', 'humanities', 'language', 'business', 'career', 'life', 'other'];

/** Legacy IDs remain readable without rewriting saved items or undo fingerprints. */
export function readingCategory(value: unknown): ReadingCategory {
  if (value === undefined) return 'other';
  if (value === 'programming' || value === 'ai') return 'programming_ai';
  if (typeof value !== 'string' || !READING_CATEGORIES.includes(value as ReadingCategory)) throw new PersonalError('请选择有效的阅读分类');
  return value as ReadingCategory;
}
