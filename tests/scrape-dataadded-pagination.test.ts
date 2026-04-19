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
      return fn({
        __response: responder(url),
        content: async () => '<html></html>',
        screenshot: async () => Buffer.alloc(0),
      });
    },
  };
});

vi.mock('../src/parsers/problem.js', async () => {
  const actual = await vi.importActual('../src/parsers/problem.js');
  return {
    ...(actual as object),
    parseProblemList: async (page: any) => page.__response.problems ?? [],
    parseProblemPage: async (page: any) =>
      page.__response.problem ?? {
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

import { scrapeDataAdded } from '../src/scrapers/dataadded.js';
import { ProgressTracker } from '../src/core/progress.js';
import type { BackupConfig } from '../src/types/index.js';

const noopLimiter = {
  wait: () => Promise.resolve(),
  waitPagination: () => Promise.resolve(),
  backoff: () => Promise.resolve(),
};

describe('scrapeDataAdded — pagination integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'boj-dataadded-'));
    calledUrls.length = 0;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('author_type=6 URL로 여러 페이지 방문', async () => {
    const pages: Record<string, any> = {
      'https://www.acmicpc.net/problemset?sort=no_asc&author=u&author_type=6&page=1': {
        problems: [{ problemId: 1, title: 'p1' }],
        hasNext: true,
      },
      'https://www.acmicpc.net/problemset?sort=no_asc&author=u&author_type=6&page=2': {
        problems: [{ problemId: 2, title: 'p2' }],
        hasNext: false,
      },
    };
    responder = (url) => {
      if (/\/problem\/\d+$/.test(url)) {
        return {
          problem: {
            problemId: 0,
            title: '',
            timeLimit: '',
            memoryLimit: '',
            fetchedAt: '',
          },
        };
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

    await scrapeDataAdded({} as BrowserContext, config, noopLimiter as any, progress);

    const listUrls = calledUrls.filter((u) => u.includes('/problemset'));
    expect(listUrls).toEqual([
      'https://www.acmicpc.net/problemset?sort=no_asc&author=u&author_type=6&page=1',
      'https://www.acmicpc.net/problemset?sort=no_asc&author=u&author_type=6&page=2',
    ]);
  });

  it('resume=true + complete 캐시: 리스트 페이지 요청 없이 per-problem 처리만', async () => {
    const { saveProblemListCache } = await import('../src/parsers/paginate.js');
    await saveProblemListCache(join(tempDir, 'dataadded-cache.json'), {
      pageNum: 1,
      complete: true,
      problems: [{ problemId: 777, title: 'cached' }],
    });

    responder = (url) => {
      if (/\/problem\/\d+$/.test(url)) {
        return {
          problem: { problemId: 0, title: '', timeLimit: '', memoryLimit: '', fetchedAt: '' },
        };
      }
      return { problems: [], hasNext: false };
    };

    const progress = new ProgressTracker(join(tempDir, 'progress.json'));
    await scrapeDataAdded(
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

    const listUrls = calledUrls.filter((u) => u.includes('/problemset'));
    expect(listUrls).toEqual([]);
    const problemUrls = calledUrls.filter((u) => /\/problem\/\d+$/.test(u));
    expect(problemUrls).toEqual(['https://www.acmicpc.net/problem/777']);
  });
});
