import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { BrowserContext } from 'playwright';

const calledUrls: string[] = [];
let boardListResponder: (url: string) => { rows: any[]; nextHref: string | null } = () => ({ rows: [], nextHref: null });
let postMetaResponder: (url: string) => any = () => ({ title: '', author: 'amsminn', writtenAt: '', commentCount: 0 });

vi.mock('../src/core/utils.js', async () => {
  const actual = await vi.importActual('../src/core/utils.js');
  return {
    ...(actual as object),
    withPage: async (_ctx: unknown, url: string, fn: (page: any) => unknown) => {
      calledUrls.push(url);
      if (url.includes('/board/search/')) {
        return fn({ __boardList: boardListResponder(url) });
      }
      if (url.includes('/board/view/')) {
        return fn({
          __postMeta: postMetaResponder(url),
          content: async () => `<html data-url="${url}"></html>`,
        });
      }
      return fn({});
    },
  };
});

vi.mock('../src/parsers/board-list.js', async () => {
  const actual = await vi.importActual<typeof import('../src/parsers/board-list.js')>(
    '../src/parsers/board-list.js',
  );
  return {
    ...actual,
    parseBoardList: async (page: any) => page.__boardList?.rows ?? [],
    getBoardNextPageHref: async (page: any) => page.__boardList?.nextHref ?? null,
  };
});

vi.mock('../src/parsers/board-post.js', async () => {
  const actual = await vi.importActual('../src/parsers/board-post.js');
  return {
    ...(actual as object),
    parseBoardPost: async (page: any) =>
      page.__postMeta ?? { title: '', author: '', writtenAt: '', commentCount: 0 },
  };
});

import { scrapeBoard } from '../src/scrapers/board.js';
import { ProgressTracker } from '../src/core/progress.js';
import type { BackupConfig } from '../src/types/index.js';

const noopLimiter = {
  wait: () => Promise.resolve(),
  waitPagination: () => Promise.resolve(),
  backoff: () => Promise.resolve(),
};

describe('scrapeBoard — pagination + per-post integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'boj-board-scrape-'));
    calledUrls.length = 0;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('모든 페이지를 순회하고 각 게시글을 카테고리별 디렉토리에 저장', async () => {
    const searchPages: Record<string, any> = {
      'https://www.acmicpc.net/board/search/all/author/amsminn': {
        rows: [
          { postId: 100, title: 'typo post', categoryId: 6, categorySlug: 'typo', categoryName: '오타/오역/요청', problemId: 1376, author: 'amsminn', relativeDate: '1일 전' },
          { postId: 101, title: 'question post', categoryId: 3, categorySlug: 'question', categoryName: '질문', author: 'amsminn', relativeDate: '2일 전' },
        ],
        nextHref: '/board/search/all/author/amsminn/99',
      },
      'https://www.acmicpc.net/board/search/all/author/amsminn/99': {
        rows: [
          { postId: 90, title: 'old post', categoryId: 2, categorySlug: 'free', categoryName: '자유', author: 'amsminn', relativeDate: '1년 전' },
        ],
        nextHref: null,
      },
    };
    boardListResponder = (url) => searchPages[url] ?? { rows: [], nextHref: null };
    postMetaResponder = (url) => {
      const idMatch = url.match(/\/board\/view\/(\d+)/);
      return {
        title: `post-${idMatch?.[1] ?? '?'}`,
        author: 'amsminn',
        writtenAt: '2026-04-17T18:23:45+09:00',
        commentCount: 1,
      };
    };

    const progress = new ProgressTracker(join(tempDir, 'progress.json'));
    const config: BackupConfig = {
      user: 'amsminn',
      cdpPort: 9222,
      outputDir: tempDir,
      delay: 0,
      resume: false,
    };

    await scrapeBoard({} as BrowserContext, config, noopLimiter as any, progress);

    const searchUrls = calledUrls.filter((u) => u.includes('/board/search/'));
    expect(searchUrls).toEqual([
      'https://www.acmicpc.net/board/search/all/author/amsminn',
      'https://www.acmicpc.net/board/search/all/author/amsminn/99',
    ]);

    const postUrls = calledUrls.filter((u) => u.includes('/board/view/')).sort();
    expect(postUrls).toEqual([
      'https://www.acmicpc.net/board/view/100',
      'https://www.acmicpc.net/board/view/101',
      'https://www.acmicpc.net/board/view/90',
    ]);

    // Output files land in the right subdirs
    const typoPostJson = JSON.parse(await readFile(join(tempDir, 'board', 'typo', '100', 'post.json'), 'utf-8'));
    expect(typoPostJson.postId).toBe(100);
    expect(typoPostJson.problemId).toBe(1376);

    const index = JSON.parse(await readFile(join(tempDir, 'board', 'index.json'), 'utf-8'));
    expect(index.totalCount).toBe(3);
    expect(index.byCategory.typo).toBe(1);
    expect(index.byCategory.question).toBe(1);
    expect(index.byCategory.free).toBe(1);
  });

  it('progress에 이미 저장된 postId는 건너뜀', async () => {
    boardListResponder = () => ({
      rows: [
        { postId: 200, title: 'done', categoryId: 6, categorySlug: 'typo', categoryName: '오타/오역/요청', author: 'amsminn', relativeDate: '' },
      ],
      nextHref: null,
    });

    const progress = new ProgressTracker(join(tempDir, 'progress.json'));
    progress.markCompleted('board', 200);
    await progress.save();

    await scrapeBoard(
      {} as BrowserContext,
      { user: 'amsminn', cdpPort: 9222, outputDir: tempDir, delay: 0, resume: true },
      noopLimiter as any,
      progress,
    );

    const postUrls = calledUrls.filter((u) => u.includes('/board/view/'));
    expect(postUrls).toEqual([]);
  });
});
