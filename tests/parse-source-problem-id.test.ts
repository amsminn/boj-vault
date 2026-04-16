import { describe, it, expect } from 'vitest';

// parseSourceProblemId runs inside page.evaluate,
// so we test the extraction logic directly.

describe('parseSourceProblemId logic', () => {
  function extractProblemIdFromSourcePage(html: string): number {
    const match = html.match(/href="\/problem\/(\d+)"/);
    return match ? parseInt(match[1], 10) : 0;
  }

  it('extracts problem ID from source page link', () => {
    const html = '<a href="/problem/12345">12345 — Some Title</a>';
    expect(extractProblemIdFromSourcePage(html)).toBe(12345);
  });

  it('returns 0 when no problem link found', () => {
    const html = '<div>No links here</div>';
    expect(extractProblemIdFromSourcePage(html)).toBe(0);
  });

  it('handles 5-digit problem numbers', () => {
    const html = '<a href="/problem/31234">31234 — Hard Problem</a>';
    expect(extractProblemIdFromSourcePage(html)).toBe(31234);
  });

  it('does not match contest problem links', () => {
    const html = '<a href="/contest/problem/963/1">Contest Problem</a>';
    expect(extractProblemIdFromSourcePage(html)).toBe(0);
  });
});
