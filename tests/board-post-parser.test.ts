import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { parseBoardPost } from '../src/parsers/board-post.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/board/', import.meta.url));

describe('parseBoardPost — real BOJ HTML', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser.close();
  });

  it('post.html fixture: 제목/작성자/작성일/댓글 수 추출', async () => {
    const html = await readFile(join(FIXTURES, 'post.html'), 'utf-8');
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const meta = await parseBoardPost(page);

      expect(meta.title.length).toBeGreaterThan(0);
      expect(meta.author).toBe('amsminn');
      // ISO timestamp — at minimum starts with a 4-digit year
      expect(meta.writtenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(meta.commentCount).toBeGreaterThanOrEqual(0);
    } finally {
      await context.close();
    }
  }, 30_000);

  it('post.html fixture: exact values', async () => {
    const html = await readFile(join(FIXTURES, 'post.html'), 'utf-8');
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const meta = await parseBoardPost(page);

      expect(meta.title).toBe('데이터를 추가해주세요');
      expect(meta.author).toBe('amsminn');
      expect(meta.writtenAt).toBe('2025-08-01T19:30:05+09:00');
      expect(meta.commentCount).toBe(0);
    } finally {
      await context.close();
    }
  }, 30_000);
});
