import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { parseProblemList } from '../src/parsers/problem.js';
import { hasNextPage } from '../src/parsers/submission.js';

// package.json has "type": "module", so __dirname isn't available;
// resolve fixtures via import.meta.url instead.
const FIXTURES = fileURLToPath(new URL('./fixtures/problem-list/', import.meta.url));

async function loadFixture(browser: Browser, filename: string) {
  const html = await readFile(join(FIXTURES, filename), 'utf-8');
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  return { page, context };
}

describe('problem list parsers — real BOJ HTML', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser.close();
  });

  it('첫 페이지 fixture: parseProblemList가 문제 링크를 수집', async () => {
    const { page, context } = await loadFixture(browser, 'authored-page1.html');
    try {
      const problems = await parseProblemList(page);
      expect(problems.length).toBeGreaterThan(0);
      for (const p of problems) {
        expect(Number.isInteger(p.problemId)).toBe(true);
        expect(p.problemId).toBeGreaterThan(0);
      }
      // No duplicates
      const ids = problems.map((p) => p.problemId);
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      await context.close();
    }
  }, 30_000);

  it('첫 페이지 fixture: hasNextPage가 true', async () => {
    const { page, context } = await loadFixture(browser, 'authored-page1.html');
    try {
      expect(await hasNextPage(page)).toBe(true);
    } finally {
      await context.close();
    }
  }, 30_000);

  it('마지막 페이지 fixture: hasNextPage가 false', async () => {
    const { page, context } = await loadFixture(browser, 'authored-last.html');
    try {
      expect(await hasNextPage(page)).toBe(false);
    } finally {
      await context.close();
    }
  }, 30_000);
});
