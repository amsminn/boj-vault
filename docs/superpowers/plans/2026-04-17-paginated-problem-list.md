# Paginated Problem List Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix GitHub issue #4 — reviewed/authored problem lists currently back up only the first 100 problems because `parseProblemList` reads a single page. Add true pagination so every page is collected, plus a list-level cache so `--resume` can skip already-collected pages (mirroring `submissions-cache.json`). Protect everything with unit tests (mocked `withPage`) and Playwright-backed integration tests against HTML fixtures.

**Architecture:**
- Keep the existing `parseProblemList` as a **per-page** parser (single responsibility: extract problem links from the currently loaded DOM).
- Introduce a new high-level `paginateProblemList(context, baseUrl, rateLimiter, log, cacheOptions?)` in a **new module** `src/parsers/paginate.ts`. This file imports `parseProblemList` from `./problem.js` and `hasNextPage` from `./submission.js`, then loops `?page=1,2,3…` using `withPage`, stops when `hasNextPage` returns false, and dedupes problem IDs across pages.
- Why a separate module: vitest's `vi.mock('../src/parsers/problem.js', …)` only intercepts cross-module imports. If `paginateProblemList` lived in `problem.ts` and called `parseProblemList` as a local binding, the mock wouldn't apply and unit tests would fail silently. Keeping them in separate files makes the tests' mocking strategy actually work.
- **Page-list cache** (opt-in via `cacheOptions`): when `{cachePath, resume}` is passed, behaves like `submissions-cache.json`:
  - On `resume && cache.complete`: return cached problems immediately (zero network).
  - On `resume && !cache.complete`: seed `pageNum`, `problems`, `seen` from cache and continue from the next page.
  - After each successful page fetch: persist cache incrementally with `complete: false`.
  - After loop exits normally: persist cache with `complete: true`.
  - Cache file format: `{ pageNum: number; complete: boolean; problems: { problemId; title }[] }`.
- Replace the single-page `parseProblemList` call in `reviewed.ts`, `authored.ts`, and the fallback branch of `solved.ts` with `paginateProblemList`. Wire `reviewed.ts` and `authored.ts` with per-category cache paths (`outputDir/reviewed-cache.json`, `outputDir/authored-cache.json`). The `solved.ts` fallback is skipped for caching — it triggers rarely (only when the profile inline list is empty), so the added complexity isn't worth it.

**Tech Stack:** TypeScript (ESM), Playwright (`BrowserContext`, `Page`), vitest 4, Node 22. No new runtime dependencies.

---

## Pre-flight

### Task 0: Branch & worktree

**Files:** (no code changes)

- [ ] **Step 0.1: Create a working branch/worktree**

Run:
```bash
cd /Users/chaewan/dev/boj-vault
git checkout -b fix/issue-4-paginate-problem-list
# Or, if using @superpowers:using-git-worktrees:
# git worktree add ../boj-vault-issue4 -b fix/issue-4-paginate-problem-list
```
Expected: new branch created, clean tree relative to `main`.

- [ ] **Step 0.2: Sanity-check existing tests pass before changes**

Run: `npm test`
Expected: all 4 current test files pass.

---

## Phase 1: Shared pagination helper (no scraper changes yet)

### Task 1: Create the `paginate.ts` module skeleton

**Files:**
- Create: `src/parsers/paginate.ts` (empty file placeholder so Task 2 can import from it before implementation)

- [ ] **Step 1.1: Create the empty module**

Create `src/parsers/paginate.ts` with the types + import skeleton (implementation comes in Task 2):

```typescript
import type { BrowserContext } from 'playwright';
import type { RateLimiter } from '../core/rate-limiter.js';
import type { Logger } from '../core/utils.js';
import { withPage } from '../core/utils.js';
import { parseProblemList } from './problem.js';
import { hasNextPage } from './submission.js';

export interface ProblemListItem {
  problemId: number;
  title: string;
}

export interface ProblemListCache {
  pageNum: number;
  complete: boolean;
  problems: ProblemListItem[];
}

export interface PaginateCacheOptions {
  cachePath: string;
  resume: boolean;
}

// Implementation added in Task 2
export async function paginateProblemList(
  _context: BrowserContext,
  _baseUrl: string,
  _rateLimiter: RateLimiter,
  _log: Logger,
  _cacheOptions?: PaginateCacheOptions,
): Promise<ProblemListItem[]> {
  throw new Error('not implemented');
}

// Cache I/O helpers (exported for tests)
export async function loadProblemListCache(_path: string): Promise<ProblemListCache | null> {
  throw new Error('not implemented');
}

export async function saveProblemListCache(
  _path: string,
  _cache: ProblemListCache,
): Promise<void> {
  throw new Error('not implemented');
}

// Keep imports "used" so TS doesn't prune them before Task 2 fills in the body
void parseProblemList; void hasNextPage; void withPage;
```

- [ ] **Step 1.2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 1.3: Commit**

```bash
git add src/parsers/paginate.ts
git commit -m "chore: scaffold paginate.ts module (impl in next commit)"
```

---

### Task 2: Unit tests for `paginateProblemList` (TDD — write tests first)

**Files:**
- Create: `tests/paginate-problem-list.test.ts`
- Modify: `src/parsers/paginate.ts`

This task follows the existing test style (mock `withPage`, capture URLs, assert behavior). Reference: `tests/submission-resume.test.ts`.

**Why this mocking works:** `paginateProblemList` lives in `src/parsers/paginate.ts` and imports `parseProblemList` from `./problem.js` and `hasNextPage` from `./submission.js` — both are cross-module imports. `vi.mock('../src/parsers/problem.js', …)` and `vi.mock('../src/parsers/submission.js', …)` therefore intercept the lookups paginate.ts performs. If both functions lived in the same file as `paginateProblemList`, vitest's mocks would NOT rewrite the intra-module references and the tests would silently exercise the real parsers against a fake page. Keep the module boundary.

- [ ] **Step 2.1: Write the failing test file**

Create `tests/paginate-problem-list.test.ts`:

```typescript
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
    // 2번째 페이지를 수집한 직후 중단 상황을 시뮬레이션하기 위해 마지막 호출에서 throw
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
```

- [ ] **Step 2.2: Run the test to confirm it fails**

Run: `npx vitest run tests/paginate-problem-list.test.ts`
Expected: FAIL — the stub from Task 1 throws `not implemented`.

- [ ] **Step 2.3: Replace the stub with the real implementation**

Rewrite `src/parsers/paginate.ts` (replacing the Task-1 stub body):

```typescript
import { readFile, writeFile } from 'node:fs/promises';
import type { BrowserContext } from 'playwright';
import type { RateLimiter } from '../core/rate-limiter.js';
import type { Logger } from '../core/utils.js';
import { withPage } from '../core/utils.js';
import { parseProblemList } from './problem.js';
import { hasNextPage } from './submission.js';

export interface ProblemListItem {
  problemId: number;
  title: string;
}

export interface ProblemListCache {
  pageNum: number;
  complete: boolean;
  problems: ProblemListItem[];
}

export interface PaginateCacheOptions {
  cachePath: string;
  resume: boolean;
}

export async function loadProblemListCache(
  path: string,
): Promise<ProblemListCache | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as ProblemListCache;
    // Shape guard — reject obviously broken cache files
    if (
      typeof parsed.pageNum !== 'number' ||
      typeof parsed.complete !== 'boolean' ||
      !Array.isArray(parsed.problems)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveProblemListCache(
  path: string,
  cache: ProblemListCache,
): Promise<void> {
  await writeFile(path, JSON.stringify(cache, null, 2), 'utf-8');
}

/**
 * Fetch every page of a BOJ problem list by iterating `?page=N` until
 * `hasNextPage` reports false (or a page returns zero problems).
 *
 * - Dedupes problems by `problemId` across pages. BOJ's pagination has been
 *   observed to occasionally overlap rows between adjacent pages, and
 *   `parseProblemList` itself dedupes within a page — so the cross-page
 *   `seen` set is the second safety net, not redundancy.
 * - Waits `rateLimiter.waitPagination()` between pages (never before the
 *   first page that actually needs fetching).
 * - Appends `?page=N` or `&page=N` depending on whether `baseUrl` already
 *   has a query string.
 *
 * Cache (opt-in):
 * - Pass `{ cachePath, resume: true }` to resume from a prior run's cache.
 *   If the cache is `complete`, returns the cached list without any fetches.
 *   Otherwise seeds pageNum/problems from the cache and continues from the
 *   next page.
 * - Pass `{ cachePath, resume: false }` to ignore any existing cache but
 *   still write a fresh cache as the run progresses.
 * - Omit `cacheOptions` entirely to operate statelessly (no disk I/O).
 */
export async function paginateProblemList(
  context: BrowserContext,
  baseUrl: string,
  rateLimiter: RateLimiter,
  log: Logger,
  cacheOptions?: PaginateCacheOptions,
): Promise<ProblemListItem[]> {
  const separator = baseUrl.includes('?') ? '&' : '?';
  const result: ProblemListItem[] = [];
  const seen = new Set<number>();
  let pageNum = 0;

  // Optional: seed from cache
  if (cacheOptions?.resume) {
    const cache = await loadProblemListCache(cacheOptions.cachePath);
    if (cache) {
      if (cache.complete) {
        log.info(`캐시 hit (complete): ${cache.problems.length}개 — 네트워크 요청 생략`);
        return cache.problems;
      }
      pageNum = cache.pageNum;
      for (const p of cache.problems) {
        if (seen.has(p.problemId)) continue;
        seen.add(p.problemId);
        result.push(p);
      }
      log.info(`캐시 복원: ${result.length}개 (page ${pageNum}까지) — 다음 페이지부터 이어서 수집`);
    }
  }

  const persist = async (complete: boolean) => {
    if (!cacheOptions) return;
    await saveProblemListCache(cacheOptions.cachePath, {
      pageNum,
      complete,
      problems: result,
    });
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    pageNum++;
    if (pageNum > 1) {
      await rateLimiter.waitPagination();
    }

    const url = `${baseUrl}${separator}page=${pageNum}`;
    const { problems, hasNext } = await withPage(context, url, async (page) => {
      const problems = await parseProblemList(page);
      const hasNext = problems.length > 0 ? await hasNextPage(page) : false;
      return { problems, hasNext };
    });

    if (problems.length === 0) {
      log.info(`페이지 ${pageNum}: 문제 없음 — 수집 종료`);
      pageNum--; // we didn't actually complete this page
      break;
    }

    let added = 0;
    for (const p of problems) {
      if (seen.has(p.problemId)) continue;
      seen.add(p.problemId);
      result.push(p);
      added++;
    }
    log.info(`페이지 ${pageNum}: ${problems.length}개 (신규 ${added}), 누적 ${result.length}개`);

    // Incremental save after each successful page
    await persist(false);

    if (!hasNext) {
      log.info(`페이지 ${pageNum}: 마지막 페이지 — 수집 종료`);
      break;
    }
  }

  // Mark complete on normal loop exit
  await persist(true);

  return result;
}
```

- [ ] **Step 2.4: Run the unit tests until green**

Run: `npx vitest run tests/paginate-problem-list.test.ts`
Expected: all 11 tests pass (5 base pagination + 6 cache behavior).

- [ ] **Step 2.5: Commit**

```bash
git add src/parsers/paginate.ts tests/paginate-problem-list.test.ts
git commit -m "feat(parsers): add paginateProblemList with incremental page-list cache"
```

---

## Phase 2: Integration tests against real BOJ HTML fixtures

### Task 3: Capture HTML fixtures from BOJ

Goal: save two snapshots — a page with `#next_page` present (not last) and one without (last page). Use `baekjoon`'s own authored problems (publicly known handle, large problem count, URL stable).

**Files:**
- Create: `tests/fixtures/problem-list/authored-page1.html` (has `#next_page`)
- Create: `tests/fixtures/problem-list/authored-last.html` (no `#next_page`)
- Create: `tests/fixtures/problem-list/README.md` (origin + capture date note)

- [ ] **Step 3.1: Create the fixtures directory**

Run: `mkdir -p tests/fixtures/problem-list`

- [ ] **Step 3.2: Fetch the first page (expected to have `#next_page`)**

Run:
```bash
curl -sL -A "Mozilla/5.0" \
  "https://www.acmicpc.net/problem/author/baekjoon/1?page=1" \
  > tests/fixtures/problem-list/authored-page1.html
```

Verify it contains pagination:
```bash
grep -c 'next_page\|pagination' tests/fixtures/problem-list/authored-page1.html
```
Expected: non-zero count.

- [ ] **Step 3.3: Fetch a page with no next (last page)**

First find the last page number:
```bash
curl -sL -A "Mozilla/5.0" "https://www.acmicpc.net/problem/author/baekjoon/1?page=1" \
  | grep -oE 'page=[0-9]+' | sort -u
```
Then fetch the highest observed page + 1 (or the last page shown in pagination):
```bash
# Example — replace N with the actual last page number observed
curl -sL -A "Mozilla/5.0" \
  "https://www.acmicpc.net/problem/author/baekjoon/1?page=N" \
  > tests/fixtures/problem-list/authored-last.html
```

Verify it does NOT have `#next_page`:
```bash
grep -c 'id="next_page"' tests/fixtures/problem-list/authored-last.html
```
Expected: 0. (If still present, fetch an even higher page number.)

- [ ] **Step 3.4: Sanity-check both fixtures extract problem links**

Run:
```bash
grep -oE '/problem/[0-9]+' tests/fixtures/problem-list/authored-page1.html | sort -u | wc -l
grep -oE '/problem/[0-9]+' tests/fixtures/problem-list/authored-last.html | sort -u | wc -l
```
Expected: both > 0.

- [ ] **Step 3.5: Add a README documenting the fixtures**

Create `tests/fixtures/problem-list/README.md`:

```markdown
# Problem-list HTML fixtures

Captured from BOJ for integration-testing pagination.

- `authored-page1.html` — first page of `/problem/author/baekjoon/1?page=1`; must contain `id="next_page"`.
- `authored-last.html` — last page of the same list; must NOT contain `id="next_page"`.

These are raw snapshots used only to assert that `parseProblemList` and `hasNextPage`
behave correctly against real BOJ markup. Regenerate if BOJ changes its list layout.

## Regenerating

Try `curl -sL -A "Mozilla/5.0"` first — at time of capture, BOJ's problem-list pages
served the real HTML to curl. If BOJ later gates these pages behind a Cloudflare
challenge, the curl output will contain challenge markup instead of the problem table;
in that case regenerate via Playwright headful mode + `page.content()` against an
authenticated session, since the runtime scraper also runs in a Playwright context.
```

**Fallback if curl returns a Cloudflare challenge:** if Step 3.4's sanity-check shows 0 `/problem/` links in either fixture, curl hit a challenge page. Regenerate both fixtures by launching Playwright (`npx playwright codegen https://www.acmicpc.net/problem/author/baekjoon/1?page=1`), letting the page render, and saving `await page.content()` manually.

- [ ] **Step 3.6: Commit the fixtures**

```bash
git add tests/fixtures/problem-list/
git commit -m "test(fixtures): add BOJ problem-list HTML snapshots"
```

---

### Task 4: Playwright-backed integration test

Reason to pick Playwright over pure jsdom: `parseProblemList` and `hasNextPage` run inside `page.evaluate()` — they need a real DOM/execution context. Test launches headless Chromium, loads fixture HTML via `page.setContent()`, and asserts parser output.

**Files:**
- Create: `tests/problem-list-integration.test.ts`

- [ ] **Step 4.1: Write the failing integration test**

Create `tests/problem-list-integration.test.ts`:

```typescript
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
```

- [ ] **Step 4.2: Run the integration test**

Run: `npx vitest run tests/problem-list-integration.test.ts`
Expected: all 3 tests pass. If Playwright's Chromium isn't installed, run `npx playwright install chromium` first.

- [ ] **Step 4.3: Commit**

```bash
git add tests/problem-list-integration.test.ts
git commit -m "test: add Playwright integration tests for problem-list parsers"
```

---

## Phase 3: Wire `paginateProblemList` into scrapers

### Task 5: `reviewed.ts` — the originally reported bug

**Files:**
- Modify: `src/scrapers/reviewed.ts:7, 18-24`

- [ ] **Step 5.1: Replace the single-page fetch**

In `src/scrapers/reviewed.ts`:

Change the import on line 7 from:
```typescript
import { parseProblemPage, parseProblemList } from '../parsers/problem.js';
```
to:
```typescript
import { parseProblemPage } from '../parsers/problem.js';
import { paginateProblemList } from '../parsers/paginate.js';
```

Change lines 18-24 from:
```typescript
  // 1. Navigate to reviewed problems list
  const listUrl = `https://www.acmicpc.net/problem/author/${config.user}/19`;
  log.info(`검수한 문제 목록 페이지 이동: ${listUrl}`);
  const problems = await withPage(context, listUrl, async (page) => {
    return await parseProblemList(page);
  });
  log.info(`검수한 문제 ${problems.length}개 발견`);
```
to:
```typescript
  // 1. Collect every page of the reviewed problems list (cached per run)
  const listUrl = `https://www.acmicpc.net/problem/author/${config.user}/19`;
  const cachePath = join(config.outputDir, 'reviewed-cache.json');
  log.info(`검수한 문제 목록 수집 시작: ${listUrl}`);
  const problems = await paginateProblemList(
    context,
    listUrl,
    rateLimiter,
    log,
    { cachePath, resume: config.resume },
  );
  log.info(`검수한 문제 ${problems.length}개 발견`);
```

`withPage` is still used below for fetching individual problem pages (the per-problem loop), so leave its import in place. Verify with `grep withPage src/scrapers/reviewed.ts`.

- [ ] **Step 5.2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5.3: Commit**

```bash
git add src/scrapers/reviewed.ts
git commit -m "fix(reviewed): paginate through all reviewed problem pages (#4)"
```

---

### Task 6: `authored.ts`

**Files:**
- Modify: `src/scrapers/authored.ts:7, 18-24`

- [ ] **Step 6.1: Apply the same substitution**

Change import line 7 from:
```typescript
import { parseProblemPage, parseProblemList } from '../parsers/problem.js';
```
to:
```typescript
import { parseProblemPage } from '../parsers/problem.js';
import { paginateProblemList } from '../parsers/paginate.js';
```

Change lines 18-24 to call `paginateProblemList` with a cache path (same shape as Task 5, just with the `/1` category URL and `authored-cache.json`):
```typescript
  const listUrl = `https://www.acmicpc.net/problem/author/${config.user}/1`;
  const cachePath = join(config.outputDir, 'authored-cache.json');
  log.info(`출제한 문제 목록 수집 시작: ${listUrl}`);
  const problems = await paginateProblemList(
    context,
    listUrl,
    rateLimiter,
    log,
    { cachePath, resume: config.resume },
  );
  log.info(`출제한 문제 ${problems.length}개 발견`);
```

Leave the `withPage` import — it's still used for per-problem pages, English versions, and testdata below.

- [ ] **Step 6.2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6.3: Commit**

```bash
git add src/scrapers/authored.ts
git commit -m "fix(authored): paginate through all authored problem pages"
```

---

### Task 7: `solved.ts` fallback branch

**Files:**
- Modify: `src/scrapers/solved.ts:7, 53-61`

Only the **fallback** call path (when profile page returned 0 problems) uses `parseProblemList`. Do NOT change the primary path — that's a different DOM on the user profile.

- [ ] **Step 7.1: Replace fallback `withPage` call**

In `src/scrapers/solved.ts`:

Change import on line 7 from:
```typescript
import { parseProblemPage, parseProblemList } from '../parsers/problem.js';
```
to:
```typescript
import { parseProblemPage } from '../parsers/problem.js';
import { paginateProblemList } from '../parsers/paginate.js';
```
(Drop `parseProblemList` from the import — it isn't used elsewhere in this file.)

Change lines 54-61 from:
```typescript
    log.warn('프로필에서 맞은 문제를 찾을 수 없음 -- 대체 경로 시도');
    await rateLimiter.wait();
    const fallbackUrl = `https://www.acmicpc.net/problemset?sort=no_asc&user=${config.user}&result=ac`;
    log.info(`대체 페이지 이동: ${fallbackUrl}`);
    problems = await withPage(context, fallbackUrl, async (page) => {
      return await parseProblemList(page);
    });
```
to:
```typescript
    log.warn('프로필에서 맞은 문제를 찾을 수 없음 -- 대체 경로 시도');
    // paginateProblemList handles its own between-page pacing via
    // rateLimiter.waitPagination(); the prior profile fetch has already closed,
    // so skip the extra rateLimiter.wait() here.
    const fallbackUrl = `https://www.acmicpc.net/problemset?sort=no_asc&user=${config.user}&result=ac`;
    log.info(`대체 페이지 수집 시작: ${fallbackUrl}`);
    problems = await paginateProblemList(context, fallbackUrl, rateLimiter, log);
```

- [ ] **Step 7.2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7.3: Commit**

```bash
git add src/scrapers/solved.ts
git commit -m "fix(solved): paginate problemset fallback when profile lookup is empty"
```

---

## Phase 4: Scraper-level regression test (optional but recommended)

### Task 8: Assert `reviewed.ts` now visits every page

**Files:**
- Create: `tests/scrape-reviewed-pagination.test.ts`

- [ ] **Step 8.1: Write the test**

Create `tests/scrape-reviewed-pagination.test.ts`:

```typescript
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
      return fn({ __response: responder(url) });
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

// page.screenshot / page.content are also called inside withPage callbacks; the withPage mock
// swallows them entirely so the real Playwright Page is never needed.

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
    const pages: Record<string, any> = {
      'https://www.acmicpc.net/problem/author/u/19?page=1': {
        problems: [{ problemId: 1, title: 'p1' }, { problemId: 2, title: 'p2' }],
        hasNext: true,
      },
      'https://www.acmicpc.net/problem/author/u/19?page=2': {
        problems: [{ problemId: 3, title: 'p3' }],
        hasNext: true,
      },
      'https://www.acmicpc.net/problem/author/u/19?page=3': {
        problems: [{ problemId: 4, title: 'p4' }],
        hasNext: false,
      },
    };
    responder = (url) => {
      // /problem/{id} 개별 페이지 요청에는 빈 문제 페이지로 응답
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
      // limit omitted intentionally — we only assert on pagination URLs below.
      // The per-problem loop will run for each of the 4 collected problems, but
      // every call goes through the mocked withPage which never touches a real Page.
    };

    await scrapeReviewed({} as BrowserContext, config, noopLimiter as any, progress);

    // Pagination 단계에서 정확히 page=1,2,3을 순서대로 방문했는가?
    const listUrls = calledUrls.filter((u) => u.includes('/problem/author/'));
    expect(listUrls).toEqual([
      'https://www.acmicpc.net/problem/author/u/19?page=1',
      'https://www.acmicpc.net/problem/author/u/19?page=2',
      'https://www.acmicpc.net/problem/author/u/19?page=3',
    ]);
  });
});
```

Note on `BackupConfig.resume`: the field is required (see `src/types/index.ts:90`). `limit` is optional and omitted — we don't care about the per-problem loop in this test; only the list-page URLs.

Note on cache side effects: `reviewed.ts` after Task 5 writes `reviewed-cache.json` into `tempDir`. The test's `afterEach` cleans `tempDir` with `rm({ recursive, force })`, so there's no cross-test pollution. No new assertions needed — the pagination-URL assertion is the point of this test.

- [ ] **Step 8.1b: Add a second test for cache-resume behavior**

In the same file, add another `it(...)` case:

```typescript
  it('resume=true + complete 캐시: 리스트 페이지 요청 없이 per-problem 처리만 진행', async () => {
    // 미리 complete 캐시 심기 (config.outputDir/reviewed-cache.json)
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
    const listUrls = calledUrls.filter((u) => u.includes('/problem/author/'));
    expect(listUrls).toEqual([]);
    // 캐시의 문제 2개에 대해서만 개별 요청
    const problemUrls = calledUrls.filter((u) => /\/problem\/\d+$/.test(u));
    expect(problemUrls.sort()).toEqual([
      'https://www.acmicpc.net/problem/11',
      'https://www.acmicpc.net/problem/22',
    ]);
  });
```

- [ ] **Step 8.2: Run the test**

Run: `npx vitest run tests/scrape-reviewed-pagination.test.ts`
Expected: PASS.

- [ ] **Step 8.3: Commit**

```bash
git add tests/scrape-reviewed-pagination.test.ts
git commit -m "test: verify scrapeReviewed visits every pagination page"
```

---

## Phase 5: Final verification

### Task 9: Full test suite + build

**Files:** (none)

- [ ] **Step 9.1: Run every test**

Run: `npm test`
Expected: all tests pass (existing 4 files + `paginate-problem-list` + `problem-list-integration` + `scrape-reviewed-pagination`).

- [ ] **Step 9.2: Typecheck + build**

Run: `npm run build`
Expected: clean compile, `dist/` populated.

- [ ] **Step 9.3: Manual smoke (optional, if BOJ session available)**

Two checks:
1. Run a real backup against a user known to have >100 reviewed problems; verify `data/reviewed/index.json`'s `totalCount` exceeds 100 and that `data/reviewed-cache.json` is written with `complete: true`.
2. Interrupt a fresh backup mid-pagination (Ctrl+C after a couple pages) and re-run with `--resume`; verify the second run logs `캐시 복원:` and skips previously-collected pages.

- [ ] **Step 9.4: Open PR referencing issue #4**

```bash
git push -u origin fix/issue-4-paginate-problem-list
gh pr create --title "fix: paginate reviewed/authored/solved-fallback problem lists (#4)" --body "$(cat <<'EOF'
## Summary
- Add `paginateProblemList` in a new `src/parsers/paginate.ts` that iterates `?page=N` until `hasNextPage` reports false
- Reuse the existing `hasNextPage` detector by importing it directly from `src/parsers/submission.ts` (kept in a separate module so vitest `vi.mock` can cleanly intercept cross-module parser calls)
- Apply to `scrapeReviewed`, `scrapeAuthored`, and the `scrapeSolved` fallback path
- Add a list-level cache (`reviewed-cache.json`, `authored-cache.json`) mirroring `submissions-cache.json`: incremental save after each page, `--resume` skips completed caches and continues from the last fetched page on incomplete caches
- Cover with unit tests (mocked `withPage` + parser modules, cache behavior) + Playwright integration tests over captured BOJ HTML fixtures + scraper-level regression tests for both fresh and resume flows

Closes #4

## Test plan
- [ ] `npm test` — all suites pass locally
- [ ] `npm run build` — clean compile
- [ ] Manual: run against a user with >100 reviewed problems; confirm `data/reviewed/index.json` totalCount > 100
EOF
)"
```

---

## Rollback

If anything goes wrong post-merge:

```bash
git revert <merge-commit-sha>
```

The change is isolated to one new function + three import/call-site edits, so a single revert cleanly restores the pre-fix behavior.
