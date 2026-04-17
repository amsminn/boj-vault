import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { BrowserContext } from 'playwright';

const calledUrls: string[] = [];
let responder: (url: string) => any = () => ({ problems: [], hasNext: false });

vi.mock('../src/core/utils.js', async () => {
  const actual = await vi.importActual('../src/core/utils.js');
  return {
    ...(actual as object),
    withPage: async (_ctx: unknown, url: string, fn: (page: any) => unknown) => {
      calledUrls.push(url);
      const page = {
        __response: responder(url),
        content: async () => '<html></html>',
        screenshot: async () => {},
      };
      return fn(page);
    },
  };
});

vi.mock('../src/parsers/problem.js', async () => {
  const actual = await vi.importActual('../src/parsers/problem.js');
  return {
    ...(actual as object),
    parseProblemList: async (page: any) => page.__response.problems ?? [],
    parseProblemPage: async (page: any) => page.__response.problem ?? {
      problemId: 0,
      title: 'stub',
      timeLimit: '',
      memoryLimit: '',
      fetchedAt: '2026-01-01',
    },
  };
});

vi.mock('../src/parsers/submission.js', async () => {
  const actual = await vi.importActual('../src/parsers/submission.js');
  return {
    ...(actual as object),
    hasNextPage: async (page: any) => page.__response.hasNext ?? false,
  };
});

import { scrapeReviewed } from '../src/scrapers/reviewed.js';
import { ProgressTracker } from '../src/core/progress.js';
import type { BackupConfig } from '../src/types/index.js';

const noopLimiter = {
  wait: () => Promise.resolve(),
  waitPagination: () => Promise.resolve(),
  backoff: () => Promise.resolve(),
};

describe('scrapeReviewed — pagination integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'boj-reviewed-'));
    calledUrls.length = 0;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('3개 페이지를 모두 방문하고 중복 없이 문제 수집', async () => {
    const baseUrl = 'https://www.acmicpc.net/problemset?sort=no_asc&author=u&author_type=19';
    const pages: Record<string, any> = {
      [`${baseUrl}&page=1`]: {
        problems: [{ problemId: 1, title: 'p1' }, { problemId: 2, title: 'p2' }],
        hasNext: true,
      },
      [`${baseUrl}&page=2`]: {
        problems: [{ problemId: 3, title: 'p3' }],
        hasNext: true,
      },
      [`${baseUrl}&page=3`]: {
        problems: [{ problemId: 4, title: 'p4' }],
        hasNext: false,
      },
    };
    responder = (url) => {
      if (/\/problem\/\d+$/.test(url)) {
        return { problem: { problemId: 0, title: '', timeLimit: '', memoryLimit: '', fetchedAt: '' } };
      }
      return pages[url] ?? { problems: [], hasNext: false };
    };

    const progress = new ProgressTracker(join(tempDir, 'progress.json'));
    const config: BackupConfig = {
      user: 'u',
      cdpPort: 9222,
      outputDir: tempDir,
      delay: 0,
      resume: false,
    };

    await scrapeReviewed({} as BrowserContext, config, noopLimiter as any, progress);

    const listUrls = calledUrls.filter((u) => u.includes('/problemset?'));
    expect(listUrls).toEqual([
      `${baseUrl}&page=1`,
      `${baseUrl}&page=2`,
      `${baseUrl}&page=3`,
    ]);
  });

  it('resume=true + complete 캐시: 리스트 페이지 요청 없이 per-problem 처리만 진행', async () => {
    // 미리 complete 캐시 심기 (outputDir/reviewed-cache.json)
    const { saveProblemListCache } = await import('../src/parsers/paginate.js');
    await saveProblemListCache(join(tempDir, 'reviewed-cache.json'), {
      pageNum: 2,
      complete: true,
      problems: [
        { problemId: 11, title: 'cached-1' },
        { problemId: 22, title: 'cached-2' },
      ],
    });

    responder = (url) => {
      if (/\/problem\/\d+$/.test(url)) {
        return { problem: { problemId: 0, title: '', timeLimit: '', memoryLimit: '', fetchedAt: '' } };
      }
      return { problems: [], hasNext: false };
    };

    const progress = new ProgressTracker(join(tempDir, 'progress.json'));
    await scrapeReviewed(
      {} as BrowserContext,
      {
        user: 'u',
        cdpPort: 9222,
        outputDir: tempDir,
        delay: 0,
        resume: true,
      },
      noopLimiter as any,
      progress,
    );

    // 리스트 페이지 요청이 0건이어야 함
    const listUrls = calledUrls.filter((u) => u.includes('/problemset?'));
    expect(listUrls).toEqual([]);
    // 캐시의 문제 2개에 대해서만 개별 요청
    const problemUrls = calledUrls.filter((u) => /\/problem\/\d+$/.test(u));
    expect(problemUrls.sort()).toEqual([
      'https://www.acmicpc.net/problem/11',
      'https://www.acmicpc.net/problem/22',
    ]);
  });
});
