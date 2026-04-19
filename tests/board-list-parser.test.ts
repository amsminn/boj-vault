import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { parseBoardList, getBoardNextPageHref } from '../src/parsers/board-list.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/board/', import.meta.url));

async function loadFixture(browser: Browser, filename: string) {
  const html = await readFile(join(FIXTURES, filename), 'utf-8');
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  return { page, context };
}

describe('parseBoardList — real BOJ HTML', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser.close();
  });

  it('amsminn 검색 결과: pinned notice를 제외하고 본인 글만 수집', async () => {
    const { page, context } = await loadFixture(browser, 'search-author.html');
    try {
      const rows = await parseBoardList(page, 'amsminn');

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.author).toBe('amsminn');
        expect(Number.isInteger(row.postId)).toBe(true);
        expect(row.postId).toBeGreaterThan(0);
        expect(Number.isInteger(row.categoryId)).toBe(true);
        expect(row.categorySlug.length).toBeGreaterThan(0);
        expect(typeof row.relativeDate).toBe('string');
      }

      // No duplicate postIds
      const ids = rows.map((r) => r.postId);
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      await context.close();
    }
  }, 30_000);

  it('typo 카테고리 행에서 연결된 problemId를 추출', async () => {
    const { page, context } = await loadFixture(browser, 'search-author.html');
    try {
      const rows = await parseBoardList(page, 'amsminn');
      const typoRows = rows.filter((r) => r.categorySlug === 'typo');
      // At capture time amsminn had multiple typo posts all linking to a problem
      expect(typoRows.length).toBeGreaterThan(0);
      for (const row of typoRows) {
        expect(row.problemId).toBeDefined();
        expect(row.problemId).toBeGreaterThan(0);
      }
    } finally {
      await context.close();
    }
  }, 30_000);

  it('getBoardNextPageHref: fixture가 단일 페이지면 null', async () => {
    const { page, context } = await loadFixture(browser, 'search-author.html');
    try {
      const next = await getBoardNextPageHref(page);
      // At capture time amsminn had 11 posts — single page, no next link.
      // If BOJ adds more posts before fixture regen, this assertion flips.
      expect(next).toBeNull();
    } finally {
      await context.close();
    }
  }, 30_000);
});
