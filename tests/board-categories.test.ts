import { describe, it, expect } from 'vitest';
import { categorySlugFromId, categoryNameFromId } from '../src/parsers/board-categories.js';

describe('board-categories', () => {
  it.each([
    [1, 'notice'],
    [2, 'free'],
    [3, 'question'],
    [6, 'typo'],
    [9, 'ad'],
  ])('categorySlugFromId(%i) → %s', (id, slug) => {
    expect(categorySlugFromId(id)).toBe(slug);
  });

  it('unknown id → category-{id} fallback', () => {
    expect(categorySlugFromId(999)).toBe('category-999');
  });

  it('categoryNameFromId returns Korean label', () => {
    expect(categoryNameFromId(6)).toBe('오타/오역/요청');
  });

  it('unknown id → name is empty string (caller should use row text)', () => {
    expect(categoryNameFromId(999)).toBe('');
  });
});
