import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { BrowserContext } from 'playwright';

// ---------------------------------------------------------------
// withPage mock — URL 캡처 + fakePage 전달
// ---------------------------------------------------------------
const calledUrls: string[] = [];
let mockResponder: (url: string) => {
  problems: { problemId: number; title: string }[];
  hasNext: boolean;
} = () => ({ problems: [], hasNext: false });

vi.mock('../src/core/utils.js', async () => {
  const actual = await vi.importActual('../src/core/utils.js');
  return {
    ...(actual as object),
    withPage: async (_ctx: unknown, url: string, fn: (page: unknown) => unknown) => {
      calledUrls.push(url);
      const response = mockResponder(url);
      const fakePage = { __response: response };
      return fn(fakePage);
    },
  };
});

// parseProblemList는 problem.ts 모듈에서 mock
vi.mock('../src/parsers/problem.js', async () => {
  const actual = await vi.importActual('../src/parsers/problem.js');
  return {
    ...(actual as object),
    parseProblemList: async (page: any) => page.__response.problems,
  };
});

// hasNextPage는 submission.ts 모듈에서 mock
vi.mock('../src/parsers/submission.js', async () => {
  const actual = await vi.importActual('../src/parsers/submission.js');
  return {
    ...(actual as object),
    hasNextPage: async (page: any) => page.__response.hasNext,
  };
});

import { paginateProblemList } from '../src/parsers/paginate.js';

const noopLimiter = {
  wait: () => Promise.resolve(),
  waitPagination: () => Promise.resolve(),
  backoff: () => Promise.resolve(),
};
const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

describe('paginateProblemList', () => {
  beforeEach(() => {
    calledUrls.length = 0;
  });

  it('단일 페이지: hasNext=false면 한 번만 요청', async () => {
    mockResponder = () => ({
      problems: [{ problemId: 1000, title: 'A+B' }],
      hasNext: false,
    });

    const result = await paginateProblemList(
      {} as BrowserContext,
      'https://www.acmicpc.net/problem/author/u/19',
      noopLimiter as any,
      silentLog,
    );

    expect(calledUrls).toEqual([
      'https://www.acmicpc.net/problem/author/u/19?page=1',
    ]);
    expect(result).toEqual([{ problemId: 1000, title: 'A+B' }]);
  });

  it('여러 페이지: hasNext=true인 동안 page=N을 순차 요청', async () => {
    const pages = [
      { problems: [{ problemId: 1, title: 'p1' }], hasNext: true },
      { problems: [{ problemId: 2, title: 'p2' }], hasNext: true },
      { problems: [{ problemId: 3, title: 'p3' }], hasNext: false },
    ];
    let i = 0;
    mockResponder = () => pages[i++];

    const result = await paginateProblemList(
      {} as BrowserContext,
      'https://www.acmicpc.net/problem/author/u/1',
      noopLimiter as any,
      silentLog,
    );

    expect(calledUrls).toEqual([
      'https://www.acmicpc.net/problem/author/u/1?page=1',
      'https://www.acmicpc.net/problem/author/u/1?page=2',
      'https://www.acmicpc.net/problem/author/u/1?page=3',
    ]);
    expect(result.map((p) => p.problemId)).toEqual([1, 2, 3]);
  });

  it('중복 문제 ID는 한 번만 포함 (페이지 간 중복 제거)', async () => {
    const pages = [
      { problems: [{ problemId: 10, title: 'x' }, { problemId: 20, title: 'y' }], hasNext: true },
      { problems: [{ problemId: 20, title: 'y' }, { problemId: 30, title: 'z' }], hasNext: false },
    ];
    let i = 0;
    mockResponder = () => pages[i++];

    const result = await paginateProblemList(
      {} as BrowserContext,
      'https://www.acmicpc.net/problem/author/u/19',
      noopLimiter as any,
      silentLog,
    );

    expect(result.map((p) => p.problemId)).toEqual([10, 20, 30]);
  });

  it('빈 페이지가 나오면 hasNext와 무관하게 즉시 종료', async () => {
    mockResponder = () => ({ problems: [], hasNext: true });

    const result = await paginateProblemList(
      {} as BrowserContext,
      'https://www.acmicpc.net/problem/author/u/19',
      noopLimiter as any,
      silentLog,
    );

    expect(result).toEqual([]);
    expect(calledUrls).toEqual([
      'https://www.acmicpc.net/problem/author/u/19?page=1',
    ]);
  });

  it('baseUrl에 이미 쿼리가 있으면 &page=N 형태로 붙여야 함', async () => {
    mockResponder = () => ({ problems: [], hasNext: false });

    await paginateProblemList(
      {} as BrowserContext,
      'https://www.acmicpc.net/problemset?user=u&result=ac',
      noopLimiter as any,
      silentLog,
    );

    expect(calledUrls).toEqual([
      'https://www.acmicpc.net/problemset?user=u&result=ac&page=1',
    ]);
  });
});

// ---------------------------------------------------------------
// 캐시 동작 테스트
// ---------------------------------------------------------------
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProblemListCache, saveProblemListCache } from '../src/parsers/paginate.js';

describe('paginateProblemList — cache', () => {
  let tempDir: string;
  let cachePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'boj-paginate-'));
    cachePath = join(tempDir, 'test-cache.json');
    calledUrls.length = 0;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('resume=true + complete 캐시: 네트워크 요청 없이 즉시 반환', async () => {
    await saveProblemListCache(cachePath, {
      pageNum: 3,
      complete: true,
      problems: [
        { problemId: 100, title: 'a' },
        { problemId: 200, title: 'b' },
      ],
    });

    const result = await paginateProblemList(
      {} as BrowserContext,
      'https://www.acmicpc.net/problem/author/u/19',
      noopLimiter as any,
      silentLog,
      { cachePath, resume: true },
    );

    expect(calledUrls).toEqual([]);
    expect(result.map((p) => p.problemId)).toEqual([100, 200]);
  });

  it('resume=true + incomplete 캐시: 다음 페이지부터 이어서 수집', async () => {
    await saveProblemListCache(cachePath, {
      pageNum: 2,
      complete: false,
      problems: [
        { problemId: 1, title: 'p1' },
        { problemId: 2, title: 'p2' },
      ],
    });

    mockResponder = () => ({
      problems: [{ problemId: 3, title: 'p3' }],
      hasNext: false,
    });

    const result = await paginateProblemList(
      {} as BrowserContext,
      'https://www.acmicpc.net/problem/author/u/19',
      noopLimiter as any,
      silentLog,
      { cachePath, resume: true },
    );

    // page=3부터 시작
    expect(calledUrls).toEqual([
      'https://www.acmicpc.net/problem/author/u/19?page=3',
    ]);
    expect(result.map((p) => p.problemId)).toEqual([1, 2, 3]);

    // 루프 정상 종료 후 complete=true로 저장되었는지 확인
    const finalCache = JSON.parse(await readFile(cachePath, 'utf-8'));
    expect(finalCache.complete).toBe(true);
    expect(finalCache.pageNum).toBe(3);
    expect(finalCache.problems.map((p: any) => p.problemId)).toEqual([1, 2, 3]);
  });

  it('resume=false: 캐시가 있어도 무시하고 page=1부터 시작', async () => {
    await saveProblemListCache(cachePath, {
      pageNum: 10,
      complete: true,
      problems: [{ problemId: 999, title: 'stale' }],
    });

    mockResponder = () => ({
      problems: [{ problemId: 1, title: 'p1' }],
      hasNext: false,
    });

    const result = await paginateProblemList(
      {} as BrowserContext,
      'https://www.acmicpc.net/problem/author/u/19',
      noopLimiter as any,
      silentLog,
      { cachePath, resume: false },
    );

    expect(calledUrls).toEqual([
      'https://www.acmicpc.net/problem/author/u/19?page=1',
    ]);
    expect(result.map((p) => p.problemId)).toEqual([1]);
    // 오래된 캐시가 새 결과로 덮어써졌는지 확인
    const finalCache = JSON.parse(await readFile(cachePath, 'utf-8'));
    expect(finalCache.problems.map((p: any) => p.problemId)).toEqual([1]);
  });

  it('각 페이지 수집 후 incremental 저장 (complete=false)', async () => {
    const pages = [
      { problems: [{ problemId: 1, title: 'p1' }], hasNext: true },
      { problems: [{ problemId: 2, title: 'p2' }], hasNext: true },
      { problems: [{ problemId: 3, title: 'p3' }], hasNext: false },
    ];
    let i = 0;
    mockResponder = () => {
      const p = pages[i++];
      if (!p) throw new Error('unexpected extra page');
      return p;
    };

    // 정상 완주: 3페이지 모두 수집
    await paginateProblemList(
      {} as BrowserContext,
      'https://www.acmicpc.net/problem/author/u/19',
      noopLimiter as any,
      silentLog,
      { cachePath, resume: false },
    );

    const finalCache = JSON.parse(await readFile(cachePath, 'utf-8'));
    expect(finalCache.complete).toBe(true);
    expect(finalCache.pageNum).toBe(3);
    expect(finalCache.problems).toHaveLength(3);
  });

  it('손상된 캐시: resume=true여도 page=1부터 재시작', async () => {
    await writeFile(cachePath, '{"pageNum":2,"compl'); // 잘린 JSON

    mockResponder = () => ({
      problems: [{ problemId: 1, title: 'p1' }],
      hasNext: false,
    });

    await paginateProblemList(
      {} as BrowserContext,
      'https://www.acmicpc.net/problem/author/u/19',
      noopLimiter as any,
      silentLog,
      { cachePath, resume: true },
    );

    expect(calledUrls).toEqual([
      'https://www.acmicpc.net/problem/author/u/19?page=1',
    ]);
  });

  it('loadProblemListCache: 파일 없으면 null 반환', async () => {
    const result = await loadProblemListCache(join(tempDir, 'missing.json'));
    expect(result).toBeNull();
  });
});
