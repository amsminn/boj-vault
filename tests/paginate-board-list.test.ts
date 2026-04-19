import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext } from 'playwright';

const calledUrls: string[] = [];
let responder: (url: string) => {
  rows: { postId: number; title: string; categoryId: number; categorySlug: string; categoryName: string; problemId?: number; author: string; relativeDate: string }[];
  nextHref: string | null;
} = () => ({ rows: [], nextHref: null });

vi.mock('../src/core/utils.js', async () => {
  const actual = await vi.importActual('../src/core/utils.js');
  return {
    ...(actual as object),
    withPage: async (_ctx: unknown, url: string, fn: (page: any) => unknown) => {
      calledUrls.push(url);
      return fn({ __response: responder(url) });
    },
  };
});

vi.mock('../src/parsers/board-list.js', async () => {
  const actual = await vi.importActual<typeof import('../src/parsers/board-list.js')>(
    '../src/parsers/board-list.js',
  );
  return {
    ...actual,
    parseBoardList: async (page: any, _filterAuthor: string) => page.__response.rows ?? [],
    getBoardNextPageHref: async (page: any) => page.__response.nextHref ?? null,
  };
});

import {
  paginateBoardList,
  loadBoardListCache,
  saveBoardListCache,
} from '../src/parsers/board-paginate.js';

const noopLimiter = {
  wait: () => Promise.resolve(),
  waitPagination: () => Promise.resolve(),
  backoff: () => Promise.resolve(),
};
const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

describe('paginateBoardList', () => {
  let tempDir: string;
  let cachePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'boj-board-'));
    cachePath = join(tempDir, 'board-cache.json');
    calledUrls.length = 0;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('다음 페이지 링크를 따라 전체 페이지 순회', async () => {
    const pages: Record<string, any> = {
      'https://www.acmicpc.net/board/search/all/author/u': {
        rows: [{ postId: 10, title: 'r10', categoryId: 6, categorySlug: 'typo', categoryName: '오타/오역/요청', author: 'u', relativeDate: '1일 전' }],
        nextHref: '/board/search/all/author/u/9',
      },
      'https://www.acmicpc.net/board/search/all/author/u/9': {
        rows: [{ postId: 8, title: 'r8', categoryId: 3, categorySlug: 'question', categoryName: '질문', author: 'u', relativeDate: '2일 전' }],
        nextHref: null,
      },
    };
    responder = (url) => pages[url] ?? { rows: [], nextHref: null };

    const rows = await paginateBoardList(
      {} as BrowserContext,
      'https://www.acmicpc.net/board/search/all/author/u',
      'u',
      noopLimiter as any,
      silentLog,
    );

    expect(calledUrls).toEqual([
      'https://www.acmicpc.net/board/search/all/author/u',
      'https://www.acmicpc.net/board/search/all/author/u/9',
    ]);
    expect(rows.map((r) => r.postId)).toEqual([10, 8]);
  });

  it('resume=true + complete 캐시: 네트워크 0회', async () => {
    await saveBoardListCache(cachePath, {
      complete: true,
      nextCursor: null,
      posts: [
        { postId: 100, title: 'cached', categoryId: 6, categorySlug: 'typo', categoryName: '오타/오역/요청', author: 'u', relativeDate: '' },
      ],
    });

    const rows = await paginateBoardList(
      {} as BrowserContext,
      'https://www.acmicpc.net/board/search/all/author/u',
      'u',
      noopLimiter as any,
      silentLog,
      { cachePath, resume: true },
    );

    expect(calledUrls).toEqual([]);
    expect(rows.map((r) => r.postId)).toEqual([100]);
  });

  it('resume=true + incomplete 캐시: nextCursor부터 이어서', async () => {
    await saveBoardListCache(cachePath, {
      complete: false,
      nextCursor: '/board/search/all/author/u/50',
      posts: [
        { postId: 60, title: 'old', categoryId: 6, categorySlug: 'typo', categoryName: '오타/오역/요청', author: 'u', relativeDate: '' },
      ],
    });

    responder = () => ({
      rows: [{ postId: 50, title: 'new', categoryId: 6, categorySlug: 'typo', categoryName: '오타/오역/요청', author: 'u', relativeDate: '' }],
      nextHref: null,
    });

    const rows = await paginateBoardList(
      {} as BrowserContext,
      'https://www.acmicpc.net/board/search/all/author/u',
      'u',
      noopLimiter as any,
      silentLog,
      { cachePath, resume: true },
    );

    expect(calledUrls).toEqual(['https://www.acmicpc.net/board/search/all/author/u/50']);
    expect(rows.map((r) => r.postId)).toEqual([60, 50]);

    const finalCache = JSON.parse(await readFile(cachePath, 'utf-8'));
    expect(finalCache.complete).toBe(true);
    expect(finalCache.nextCursor).toBeNull();
  });

  it('손상된 캐시: resume=true여도 처음부터', async () => {
    await writeFile(cachePath, '{"complete":f', 'utf-8');
    responder = () => ({ rows: [], nextHref: null });

    await paginateBoardList(
      {} as BrowserContext,
      'https://www.acmicpc.net/board/search/all/author/u',
      'u',
      noopLimiter as any,
      silentLog,
      { cachePath, resume: true },
    );

    expect(calledUrls).toEqual(['https://www.acmicpc.net/board/search/all/author/u']);
  });
});
