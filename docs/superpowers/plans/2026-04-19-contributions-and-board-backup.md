# Contributions & Board Backup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new backup categories to `boj-vault` — `corrected` (오타 수정 기여, `author_type=3`), `dataadded` (데이터 추가 기여, `author_type=6`), and `board` (BOJ 게시판 본인이 쓴 글). Reuse the existing `paginateProblemList` helper for the two contribution categories; build a small new cursor-based pagination + post-parser pipeline for the board.

**Architecture:**
- `corrected.ts` / `dataadded.ts` are near-clones of `reviewed.ts`, each pointing at a different `author_type` and cache file. The existing `paginateProblemList` already handles full-list iteration, cache, and `--resume`, so no new pagination logic is needed here.
- `board.ts` is a new scraper. Its list-level pagination is **cursor-based** (follow `다음 페이지` href), not `?page=N`, so it needs its own helper `paginateBoardList` with a separate cache file (`board-cache.json`). Per-post output is a single `post.html` (BOJ renders comments inline on `/board/view/{id}` so `page.content()` already captures them) plus a `post.json` metadata file. Posts are grouped under `output/board/{category_slug}/{post_id}/` using the numeric category ID from the row's `/board/list/{N}` link as source of truth (not the visible Korean label).
- Wire all three phases into `runBackup` after `solved`, with matching `--only` values and `--resume` support via `ProgressTracker`.

**Tech Stack:** TypeScript (ESM), Playwright 1.x (`BrowserContext`, `Page`), vitest 4, Node ≥18. No new runtime dependencies.

**Spec reference:** `docs/superpowers/specs/2026-04-19-contributions-and-board-backup-design.md`

---

## File Structure

**Created:**
- `src/scrapers/corrected.ts` — orchestrates `author_type=3` backup
- `src/scrapers/dataadded.ts` — orchestrates `author_type=6` backup
- `src/scrapers/board.ts` — orchestrates board-post backup
- `src/parsers/board-categories.ts` — BOJ category ID↔slug mapping
- `src/parsers/board-list.ts` — parses `/board/search/...` rows + cursor-based pagination helper + cache I/O
- `src/parsers/board-post.ts` — parses `/board/view/{id}` metadata
- `tests/board-categories.test.ts` — pure mapping unit tests
- `tests/scrape-corrected-pagination.test.ts` — end-to-end pagination assertion for `corrected`
- `tests/scrape-dataadded-pagination.test.ts` — same, `dataadded`
- `tests/board-list-parser.test.ts` — row→`BoardListRow` unit tests (mocked `page.evaluate`)
- `tests/scrape-board-pagination.test.ts` — scraper-level test: cursor traversal, notice filtering, cache resume
- `tests/board-post-parser.test.ts` — `/board/view/{id}` metadata parser
- `tests/fixtures/board/search-author.html` — real HTML snapshot of `/board/search/all/author/amsminn`
- `tests/fixtures/board/post.html` — real HTML snapshot of `/board/view/161839` (a "데이터를 추가해주세요" post)

**Modified:**
- `src/types/index.ts` — add `BoardPost`, `BoardListRow`, `BoardIndex`, extend `BackupMetadata.stats` + `BackupConfig.only`
- `src/core/progress.ts` — extend `ProgressData` + category switch
- `src/cli/index.ts` — extend `--only` choices
- `src/index.ts` — wire three phases into `runBackup`, extend `stats`
- `src/writers/index-builder.ts` — extend `BackupMetadata.stats` shape
- `README.md` — 사용법, 백업 대상, 출력 구조, Changelog

---

## Pre-flight

### Task 0: Branch & sanity-check

**Files:** (no code changes)

- [ ] **Step 0.1: Create working branch**

```bash
cd /Users/chaewan/dev/boj-vault
git checkout -b feat/contributions-and-board-backup
```

Expected: new branch created from `main`, clean tree.

Note: `src/index.ts`, `src/scrapers/authored.ts`, `src/scrapers/reviewed.ts`, `src/scrapers/solved.ts` had uncommitted modifications at the start of this planning session — verify these are either committed or stashed before starting Task 1. Run `git status`; if modifications remain, stash them (`git stash push -m pre-contributions-work`) and restore after the feature branch is merged or abandoned.

- [ ] **Step 0.2: Verify existing tests pass**

Run: `npm test`
Expected: all current test files pass. If any fail on `main`, stop and fix before proceeding — this plan's new tests should not paper over a pre-existing regression.

- [ ] **Step 0.3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

---

## Phase 1: Types, progress, CLI plumbing

### Task 1: Extend types for new categories

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1.1: Add board-related types and extend existing types**

Open `src/types/index.ts` and append after the existing `ReviewedProblem` interface:

```typescript
// Board posts
export interface BoardListRow {
  postId: number;
  title: string;
  categoryId: number;      // numeric category ID from /board/list/{N} link
  categorySlug: string;    // 'typo' | 'question' | 'free' | ...
  categoryName: string;    // visible Korean label, e.g. '오타/오역/요청'
  problemId?: number;      // present when the row's category cell includes a problem link
  author: string;          // BOJ handle of the row author (used to filter out pinned notices)
  relativeDate: string;    // "2일 전" / "8달 전" — raw text from the list page
}

export interface BoardPost {
  postId: number;
  title: string;
  categoryId: number;
  categorySlug: string;
  categoryName: string;
  problemId?: number;
  author: string;
  writtenAt: string;       // exact ISO timestamp parsed from /board/view/{id}
  commentCount: number;
  fetchedAt: string;
}

export interface BoardIndex {
  totalCount: number;
  byCategory: Record<string, number>;
  posts: (Pick<BoardPost, 'postId' | 'title' | 'categorySlug' | 'categoryName' | 'problemId' | 'author' | 'writtenAt' | 'commentCount'> & { path: string })[];
  lastUpdated: string;
}
```

Modify the existing `BackupMetadata.stats` shape (lines ~75-80) from:

```typescript
  stats: {
    submissions: number;
    solvedProblems: number;
    authoredProblems: number;
    reviewedProblems: number;
  };
```

to:

```typescript
  stats: {
    submissions: number;
    solvedProblems: number;
    authoredProblems: number;
    reviewedProblems: number;
    correctedProblems: number;
    dataAddedProblems: number;
    boardPosts: number;
  };
```

Modify the existing `BackupConfig.only` comment (line ~89) from:

```typescript
  only?: string;   // 'submissions' | 'authored' | 'reviewed' | 'solved' | 'profile'
```

to:

```typescript
  only?: string;   // 'submissions' | 'authored' | 'reviewed' | 'solved' | 'profile' | 'corrected' | 'dataadded' | 'board'
```

- [ ] **Step 1.2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors surface in `src/writers/index-builder.ts` and `src/index.ts` because the stats shape changed. These will be fixed in subsequent tasks — acknowledge and proceed.

- [ ] **Step 1.3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add BoardPost/BoardIndex + extend stats for contributions+board"
```

---

### Task 2: Extend `ProgressTracker` categories

**Files:**
- Modify: `src/core/progress.ts`

- [ ] **Step 2.1: Add new Sets to `ProgressData` and JSON shape**

In `src/core/progress.ts`, extend `ProgressData` (line 4-10) to add three new Set fields:

```typescript
export interface ProgressData {
  completedSubmissions: Set<number>;
  completedProblems: Set<number>;
  completedAuthored: Set<number>;
  completedReviewed: Set<number>;
  completedCorrected: Set<number>;
  completedDataAdded: Set<number>;
  completedBoard: Set<number>;
  phase?: string;
}
```

Extend `ProgressJSON` (line 12-18):

```typescript
interface ProgressJSON {
  completedSubmissions: number[];
  completedProblems: number[];
  completedAuthored: number[];
  completedReviewed: number[];
  completedCorrected: number[];
  completedDataAdded: number[];
  completedBoard: number[];
  phase?: string;
}
```

Update the constructor initialization (line 26-31):

```typescript
    this.data = {
      completedSubmissions: new Set(),
      completedProblems: new Set(),
      completedAuthored: new Set(),
      completedReviewed: new Set(),
      completedCorrected: new Set(),
      completedDataAdded: new Set(),
      completedBoard: new Set(),
    };
```

Update `save()` JSON construction (line 60-66) to include the three new arrays:

```typescript
    const json: ProgressJSON = {
      completedSubmissions: [...this.data.completedSubmissions],
      completedProblems: [...this.data.completedProblems],
      completedAuthored: [...this.data.completedAuthored],
      completedReviewed: [...this.data.completedReviewed],
      completedCorrected: [...this.data.completedCorrected],
      completedDataAdded: [...this.data.completedDataAdded],
      completedBoard: [...this.data.completedBoard],
      phase: this.data.phase,
    };
```

Update `load()` deserialization (line 85-91) with fallbacks so old progress files without the new fields don't crash:

```typescript
    this.data = {
      completedSubmissions: new Set(json.completedSubmissions ?? []),
      completedProblems: new Set(json.completedProblems ?? []),
      completedAuthored: new Set(json.completedAuthored ?? []),
      completedReviewed: new Set(json.completedReviewed ?? []),
      completedCorrected: new Set(json.completedCorrected ?? []),
      completedDataAdded: new Set(json.completedDataAdded ?? []),
      completedBoard: new Set(json.completedBoard ?? []),
      phase: json.phase,
    };
```

Update `getSet()` switch (line 95-107) to add three new cases:

```typescript
  private getSet(category: string): Set<number> {
    switch (category) {
      case 'submissions':
        return this.data.completedSubmissions;
      case 'problems':
        return this.data.completedProblems;
      case 'authored':
        return this.data.completedAuthored;
      case 'reviewed':
        return this.data.completedReviewed;
      case 'corrected':
        return this.data.completedCorrected;
      case 'dataadded':
        return this.data.completedDataAdded;
      case 'board':
        return this.data.completedBoard;
      default:
        throw new Error(`Unknown progress category: ${category}`);
    }
  }
```

- [ ] **Step 2.2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from this file. (The pre-existing errors in `src/writers/index-builder.ts` and `src/index.ts` from Task 1 are still present — expected.)

- [ ] **Step 2.3: Commit**

```bash
git add src/core/progress.ts
git commit -m "feat(progress): track corrected/dataadded/board completion"
```

---

### Task 3: Extend `metadata` builder + CLI `--only` choices

**Files:**
- Modify: `src/writers/index-builder.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 3.1: Extend `buildMetadata` — no code change needed, but verify**

Open `src/writers/index-builder.ts`. The `buildMetadata` function uses `BackupMetadata['stats']` as its parameter type, so extending the type in Task 1 automatically extends this signature — nothing to change here. Just verify by reading lines 43-53: the function body only passes `stats` through, no inline shape.

No file edit for this step.

- [ ] **Step 3.2: Extend CLI `--only` choices**

In `src/cli/index.ts`, modify the `.choices(...)` call on line 26 from:

```typescript
      .choices(['submissions', 'authored', 'reviewed', 'solved', 'profile']),
```

to:

```typescript
      .choices(['submissions', 'authored', 'reviewed', 'solved', 'profile', 'corrected', 'dataadded', 'board']),
```

- [ ] **Step 3.3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors still in `src/index.ts` (stats shape) from Task 1 — to be fixed in Task 11. No new errors.

- [ ] **Step 3.4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat(cli): add --only choices for corrected/dataadded/board"
```

---

## Phase 2: Contribution scrapers (corrected, dataadded)

### Task 4: `scrapeCorrected` — TDD test first

**Files:**
- Create: `tests/scrape-corrected-pagination.test.ts`
- Create: `src/scrapers/corrected.ts`

**Reference pattern:** `tests/scrape-reviewed-pagination.test.ts` (already exists in the repo and exercises the same shape).

- [ ] **Step 4.1: Write the failing test**

Create `tests/scrape-corrected-pagination.test.ts`:

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

import { scrapeCorrected } from '../src/scrapers/corrected.js';
import { ProgressTracker } from '../src/core/progress.js';
import type { BackupConfig } from '../src/types/index.js';

const noopLimiter = {
  wait: () => Promise.resolve(),
  waitPagination: () => Promise.resolve(),
  backoff: () => Promise.resolve(),
};

describe('scrapeCorrected — pagination integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'boj-corrected-'));
    calledUrls.length = 0;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('author_type=3 URL로 여러 페이지 방문', async () => {
    const pages: Record<string, any> = {
      'https://www.acmicpc.net/problemset?sort=no_asc&author=u&author_type=3&page=1': {
        problems: [{ problemId: 1, title: 'p1' }],
        hasNext: true,
      },
      'https://www.acmicpc.net/problemset?sort=no_asc&author=u&author_type=3&page=2': {
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

    await scrapeCorrected({} as BrowserContext, config, noopLimiter as any, progress);

    const listUrls = calledUrls.filter((u) => u.includes('/problemset'));
    expect(listUrls).toEqual([
      'https://www.acmicpc.net/problemset?sort=no_asc&author=u&author_type=3&page=1',
      'https://www.acmicpc.net/problemset?sort=no_asc&author=u&author_type=3&page=2',
    ]);
  });

  it('resume=true + complete 캐시: 리스트 페이지 요청 없이 per-problem 처리만', async () => {
    const { saveProblemListCache } = await import('../src/parsers/paginate.js');
    await saveProblemListCache(join(tempDir, 'corrected-cache.json'), {
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
    await scrapeCorrected(
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
```

- [ ] **Step 4.2: Run the test — expect failure**

Run: `npx vitest run tests/scrape-corrected-pagination.test.ts`
Expected: FAIL — `scrapeCorrected` module does not exist yet.

- [ ] **Step 4.3: Implement `scrapeCorrected`**

Create `src/scrapers/corrected.ts`:

```typescript
import { join } from 'node:path';
import type { BrowserContext } from 'playwright';
import type { BackupConfig } from '../types/index.js';
import { RateLimiter } from '../core/rate-limiter.js';
import { ProgressTracker } from '../core/progress.js';
import { createLogger, withPage, ensureDir } from '../core/utils.js';
import { parseProblemPage } from '../parsers/problem.js';
import { paginateProblemList } from '../parsers/paginate.js';
import { writeJson, writeHtml } from '../writers/json-writer.js';

export async function scrapeCorrected(
  context: BrowserContext,
  config: BackupConfig,
  rateLimiter: RateLimiter,
  progress: ProgressTracker,
): Promise<number> {
  const log = createLogger('corrected');

  // 1. Collect every page of the corrected problems list.
  // Note: /problem/author/{user}/3 only returns page 1; the true paginated
  // endpoint is /problemset with author_type=3.
  const listUrl = `https://www.acmicpc.net/problemset?sort=no_asc&author=${config.user}&author_type=3`;
  const cachePath = join(config.outputDir, 'corrected-cache.json');
  log.info(`오타 수정 기여 문제 목록 수집 시작: ${listUrl}`);
  const problems = await paginateProblemList(
    context,
    listUrl,
    rateLimiter,
    log,
    { cachePath, resume: config.resume },
  );
  log.info(`오타 수정 기여 문제 ${problems.length}개 발견`);

  // Apply limit
  const limited = config.limit ? problems.slice(0, config.limit) : problems;

  // 2. Save the index
  const indexPath = join(config.outputDir, 'corrected', 'index.json');
  await writeJson(indexPath, {
    totalCount: problems.length,
    problems,
    lastUpdated: new Date().toISOString(),
  });
  log.info(`인덱스 저장: ${indexPath}`);

  // 3. Process each problem
  for (const { problemId, title } of limited) {
    if (progress.isCompleted('corrected', problemId)) {
      log.info(`건너뜀 (이미 완료): #${problemId} ${title}`);
      continue;
    }

    try {
      log.info(`처리 중: #${problemId} ${title}`);

      await rateLimiter.wait();
      const problemDir = join(config.outputDir, 'corrected', String(problemId));
      await ensureDir(problemDir);
      const { problemData, pageHtml } = await withPage(
        context,
        `https://www.acmicpc.net/problem/${problemId}`,
        async (page) => {
          const problemData = await parseProblemPage(page);
          const pageHtml = await page.content();
          await page.screenshot({ path: join(problemDir, 'problem.png'), fullPage: true });
          return { problemData, pageHtml };
        },
      );

      await writeJson(join(problemDir, 'problem.json'), problemData);
      await writeHtml(join(problemDir, 'problem.html'), pageHtml);

      progress.markCompleted('corrected', problemId);
      await progress.save();
      log.info(`완료: #${problemId} ${title}`);
    } catch (err) {
      log.error(
        `문제 처리 실패 (#${problemId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  log.info('오타 수정 기여 문제 백업 완료');
  return problems.length;
}
```

- [ ] **Step 4.4: Run the test until green**

Run: `npx vitest run tests/scrape-corrected-pagination.test.ts`
Expected: both tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add tests/scrape-corrected-pagination.test.ts src/scrapers/corrected.ts
git commit -m "feat(corrected): scrape typo-correction contributions (author_type=3)"
```

---

### Task 5: `scrapeDataAdded` — TDD test first

**Files:**
- Create: `tests/scrape-dataadded-pagination.test.ts`
- Create: `src/scrapers/dataadded.ts`

- [ ] **Step 5.1: Write the failing test**

Create `tests/scrape-dataadded-pagination.test.ts` — identical to Task 4.1 except:
- Import `scrapeDataAdded` instead of `scrapeCorrected`
- URLs use `author_type=6`
- Cache filename is `dataadded-cache.json`
- Describe block string is `'scrapeDataAdded — pagination integration'`

(Use the same mock setup. The test file is a direct copy with these three string substitutions. Keep the duplication — DRY-ing these scraper tests together is out of scope per spec non-goals.)

- [ ] **Step 5.2: Run the test — expect failure**

Run: `npx vitest run tests/scrape-dataadded-pagination.test.ts`
Expected: FAIL — `scrapeDataAdded` module does not exist.

- [ ] **Step 5.3: Implement `scrapeDataAdded`**

Create `src/scrapers/dataadded.ts` — identical to `src/scrapers/corrected.ts` except:
- Export `scrapeDataAdded` instead of `scrapeCorrected`
- Logger prefix is `'dataadded'`
- URL uses `author_type=6`
- Cache filename is `dataadded-cache.json`
- Output subdir is `'dataadded'`
- Log messages say `'데이터 추가 기여'` instead of `'오타 수정 기여'`
- `progress.isCompleted('dataadded', ...)` and `progress.markCompleted('dataadded', ...)`

- [ ] **Step 5.4: Run the test until green**

Run: `npx vitest run tests/scrape-dataadded-pagination.test.ts`
Expected: both tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add tests/scrape-dataadded-pagination.test.ts src/scrapers/dataadded.ts
git commit -m "feat(dataadded): scrape data-addition contributions (author_type=6)"
```

---

## Phase 3: Board — category mapping

### Task 6: Board category ID↔slug mapping

**Files:**
- Create: `src/parsers/board-categories.ts`
- Create: `tests/board-categories.test.ts`

Background: BOJ's category menu links are observed as `/board/list/1` (공지), `/board/list/2` (자유), `/board/list/3` (질문), `/board/list/6` (오타/오역/요청), `/board/list/9` (홍보). Other IDs (업데이트, solved.ac, 게시판 공지) must be determined from the live site; the implementation below falls back to `category-{id}` for unknown IDs with a console warning.

- [ ] **Step 6.1: Write the failing test**

Create `tests/board-categories.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { categorySlugFromId, categoryNameFromId } from '../src/parsers/board-categories.js';

describe('board-categories', () => {
  it.each([
    [1, 'notice'],
    [2, 'free'],
    [3, 'question'],
    [6, 'typo'],
    [9, 'ad'],
  ])('categorySlugFromId(%i) → %s', (id, slug) => {
    expect(categorySlugFromId(id)).toBe(slug);
  });

  it('unknown id → category-{id} fallback', () => {
    expect(categorySlugFromId(999)).toBe('category-999');
  });

  it('categoryNameFromId returns Korean label', () => {
    expect(categoryNameFromId(6)).toBe('오타/오역/요청');
  });

  it('unknown id → name is empty string (caller should use row text)', () => {
    expect(categoryNameFromId(999)).toBe('');
  });
});
```

- [ ] **Step 6.2: Run the test — expect failure**

Run: `npx vitest run tests/board-categories.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 6.3: Implement the mapping**

Create `src/parsers/board-categories.ts`:

```typescript
// Mapping from BOJ's internal category IDs (the N in /board/list/{N})
// to URL slugs and visible Korean labels.
//
// Derived from the BOJ board sidebar:
//   - 공지       → /board/list/notice    (ID 1)
//   - 자유       → /board/list/free      (ID 2)
//   - 질문       → /board/list/question  (ID 3)
//   - 오타/오역/요청 → /board/list/typo      (ID 6)
//   - 홍보       → /board/list/ad        (ID 9)
//
// Unknown IDs fall back to `category-{id}` with an empty display name; the
// caller is expected to surface the row's visible category text in that case.

interface CategoryMeta {
  slug: string;
  name: string;
}

const CATEGORIES: Record<number, CategoryMeta> = {
  1: { slug: 'notice', name: '공지' },
  2: { slug: 'free', name: '자유' },
  3: { slug: 'question', name: '질문' },
  6: { slug: 'typo', name: '오타/오역/요청' },
  9: { slug: 'ad', name: '홍보' },
};

export function categorySlugFromId(id: number): string {
  const meta = CATEGORIES[id];
  if (meta) return meta.slug;
  // eslint-disable-next-line no-console
  console.warn(`[board-categories] unknown category id: ${id} — falling back to category-${id}`);
  return `category-${id}`;
}

export function categoryNameFromId(id: number): string {
  return CATEGORIES[id]?.name ?? '';
}
```

- [ ] **Step 6.4: Run the test until green**

Run: `npx vitest run tests/board-categories.test.ts`
Expected: all tests pass. The "unknown id" test will also emit a console warning — that's intentional and does not fail the test.

- [ ] **Step 6.5: Commit**

```bash
git add src/parsers/board-categories.ts tests/board-categories.test.ts
git commit -m "feat(board): map BOJ category IDs to slugs/names"
```

---

## Phase 4: Board — list parser with live fixture

### Task 7: Capture real BOJ HTML fixture for the search-author page

**Files:**
- Create: `tests/fixtures/board/search-author.html`
- Create: `tests/fixtures/board/README.md`

- [ ] **Step 7.1: Create fixtures directory**

Run: `mkdir -p tests/fixtures/board`

- [ ] **Step 7.2: Fetch the real page**

Run:
```bash
curl -sL -A "Mozilla/5.0" \
  "https://www.acmicpc.net/board/search/all/author/amsminn" \
  > tests/fixtures/board/search-author.html
```

Sanity-check that the snapshot contains at least one `amsminn`-authored row:

```bash
grep -c 'amsminn' tests/fixtures/board/search-author.html
```

Expected: count > 3 (once for the search query echo + once per row + side nav items if any).

If the count is 0, curl likely hit a Cloudflare challenge. Fall back to Playwright:

```bash
# In a separate terminal — launch BOJ-authenticated Chrome first (see README "사전 준비")
# Then in this session, fetch via a small script or via browser MCP. Manual save from
# the live DOM is acceptable; the fixture is HTML, not a network trace.
```

- [ ] **Step 7.3: Verify the fixture has both a pinned-notice row (author ≠ amsminn) and amsminn rows**

```bash
grep -oE '/user/[A-Za-z0-9_]+' tests/fixtures/board/search-author.html | sort -u | head
```

Expected: output includes `/user/amsminn` AND at least one non-amsminn handle (e.g. `/user/startlink` or `/user/ryute`). If only `amsminn` appears, re-capture — the pinned-notice filter test in Task 9 requires a non-user row to be present.

- [ ] **Step 7.4: Document the fixture**

Create `tests/fixtures/board/README.md`:

```markdown
# Board HTML fixtures

Captured from BOJ for integration-testing the board scraper.

- `search-author.html` — `/board/search/all/author/amsminn` snapshot. Must contain:
  - At least one row authored by `amsminn`
  - At least one pinned-notice row authored by someone else (startlink/ryute)
  - At least one category cell linking to `/problem/{N}` (for the problemId extraction test)
- `post.html` — `/board/view/{id}` snapshot of a post with a non-zero comment count.

Regenerate if BOJ changes its board layout. Try curl first; if it returns a
Cloudflare challenge page, fall back to Playwright against a logged-in session.
```

- [ ] **Step 7.5: Commit**

```bash
git add tests/fixtures/board/
git commit -m "test(fixtures): capture BOJ board search-author HTML snapshot"
```

---

### Task 8: Board list parser — `parseBoardList`

**Files:**
- Create: `src/parsers/board-list.ts` (initial skeleton; pagination helper added in Task 10)
- Create: `tests/board-list-parser.test.ts`

- [ ] **Step 8.1: Scaffold the module skeleton**

Create `src/parsers/board-list.ts` with stubs:

```typescript
import type { Page } from 'playwright';
import type { BoardListRow } from '../types/index.js';
import { categorySlugFromId, categoryNameFromId } from './board-categories.js';

/**
 * Parse rows from /board/search/all/author/{user} (or a category-filtered variant).
 *
 * Filtering:
 *   - Skips rows whose author handle does not match `filterAuthor`. BOJ pins
 *     site-wide notices to the top of every board search result regardless of
 *     the author query, so the caller must pass the expected author to exclude
 *     them.
 *
 * Fields:
 *   - categoryId/slug/name: derived from the /board/list/{N} link in the
 *     category cell — NOT from the visible Korean text. The text also contains
 *     "1376번" when the post is tied to a problem.
 *   - problemId: present only when the category cell has a /problem/{N} link.
 *   - relativeDate: raw text like "8달 전". Exact timestamp comes later from
 *     /board/view/{id} (see board-post.ts).
 */
export async function parseBoardList(
  page: Page,
  filterAuthor: string,
): Promise<BoardListRow[]> {
  // Implementation in Step 8.3
  void categorySlugFromId;
  void categoryNameFromId;
  return [];
}

export async function getBoardNextPageHref(page: Page): Promise<string | null> {
  // Implementation in Step 10.3
  return null;
}
```

- [ ] **Step 8.2: Write the failing test**

Create `tests/board-list-parser.test.ts`:

```typescript
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
```

- [ ] **Step 8.3: Implement `parseBoardList`**

Replace the stub in `src/parsers/board-list.ts` with a real implementation:

```typescript
import type { Page } from 'playwright';
import type { BoardListRow } from '../types/index.js';
import { categorySlugFromId, categoryNameFromId } from './board-categories.js';

export async function parseBoardList(
  page: Page,
  filterAuthor: string,
): Promise<BoardListRow[]> {
  const rawRows = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    return rows.map((row) => {
      const titleCell = row.querySelector('td:nth-child(1)');
      const titleLink = titleCell?.querySelector('a[href^="/board/view/"]');
      const titleHref = titleLink?.getAttribute('href') ?? '';
      const postIdMatch = titleHref.match(/\/board\/view\/(\d+)/);

      const catCell = row.querySelector('td:nth-child(2)');
      const catListLink = catCell?.querySelector('a[href^="/board/list/"]');
      const catHref = catListLink?.getAttribute('href') ?? '';
      const catIdMatch = catHref.match(/\/board\/list\/(\d+)/);

      const problemLink = catCell?.querySelector('a[href^="/problem/"]');
      const problemHref = problemLink?.getAttribute('href') ?? '';
      const problemMatch = problemHref.match(/\/problem\/(\d+)/);

      const authorLink = row.querySelector('td:nth-child(4) a[href^="/user/"]');
      const authorText = authorLink?.textContent?.trim() ?? '';

      const dateCell = row.querySelector('td:last-child');
      const relativeDate = dateCell?.textContent?.trim() ?? '';

      return {
        postId: postIdMatch ? parseInt(postIdMatch[1], 10) : 0,
        title: titleLink?.textContent?.trim() ?? '',
        categoryIdFromHref: catIdMatch ? parseInt(catIdMatch[1], 10) : 0,
        categoryVisibleText: catListLink?.textContent?.trim() ?? '',
        problemId: problemMatch ? parseInt(problemMatch[1], 10) : 0,
        author: authorText,
        relativeDate,
      };
    });
  });

  const result: BoardListRow[] = [];
  for (const r of rawRows) {
    if (!r.postId || !r.author) continue;
    if (r.author !== filterAuthor) continue;
    const slug = r.categoryIdFromHref ? categorySlugFromId(r.categoryIdFromHref) : 'category-unknown';
    const name = r.categoryIdFromHref
      ? categoryNameFromId(r.categoryIdFromHref) || r.categoryVisibleText
      : r.categoryVisibleText;
    result.push({
      postId: r.postId,
      title: r.title,
      categoryId: r.categoryIdFromHref,
      categorySlug: slug,
      categoryName: name,
      problemId: r.problemId > 0 ? r.problemId : undefined,
      author: r.author,
      relativeDate: r.relativeDate,
    });
  }
  return result;
}

export async function getBoardNextPageHref(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('a'));
    const next = candidates.find((a) => a.textContent?.trim() === '다음 페이지');
    if (!next) return null;
    return next.getAttribute('href');
  });
}
```

- [ ] **Step 8.4: Install Playwright Chromium if missing, then run the tests**

```bash
npx playwright install chromium
npx vitest run tests/board-list-parser.test.ts
```

Expected: all 3 tests pass.

**Troubleshoot:** If the "amsminn 검색 결과" test returns zero rows, inspect the fixture — BOJ's row structure may be nested differently than `table tbody tr` on this page. Open `tests/fixtures/board/search-author.html` in a browser, use DevTools to locate the row selector, adjust the `document.querySelectorAll` call. Do NOT skip the test — zero rows is a real parser bug, not a fixture issue.

- [ ] **Step 8.5: Commit**

```bash
git add src/parsers/board-list.ts tests/board-list-parser.test.ts
git commit -m "feat(board): parse board search rows with author filter"
```

---

## Phase 5: Board — post parser with live fixture

### Task 9: Capture `/board/view/{id}` fixture + implement `parseBoardPost`

**Files:**
- Create: `tests/fixtures/board/post.html`
- Create: `src/parsers/board-post.ts`
- Create: `tests/board-post-parser.test.ts`

- [ ] **Step 9.1: Fetch a real post fixture**

Pick a post with at least one comment so `commentCount` can be tested. From the earlier exploration, post `161839` ("데이터를 추가해주세요" by amsminn) is a good candidate.

```bash
curl -sL -A "Mozilla/5.0" \
  "https://www.acmicpc.net/board/view/161839" \
  > tests/fixtures/board/post.html
```

Sanity-check:
```bash
grep -c 'amsminn' tests/fixtures/board/post.html
grep -c 'problem_content\|post_body\|comment' tests/fixtures/board/post.html
```

Expected: both > 0. If curl returns a challenge page, capture via Playwright against a logged-in session.

- [ ] **Step 9.2: Write the failing parser test**

Create `tests/board-post-parser.test.ts`:

```typescript
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
});
```

- [ ] **Step 9.3: Run the test — expect failure**

Run: `npx vitest run tests/board-post-parser.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 9.4: Implement `parseBoardPost`**

Create `src/parsers/board-post.ts`:

```typescript
import type { Page } from 'playwright';

export interface BoardPostMeta {
  title: string;
  author: string;
  writtenAt: string;        // ISO
  commentCount: number;
}

/**
 * Extract post-level metadata from a /board/view/{id} page.
 *
 * BOJ's post page structure (observed):
 *   - Title:        h2.page-header, or the first <h1>/<h2> above the body
 *   - Author:       an <a href="/user/{handle}"> near the metadata row
 *   - Timestamp:    an <a href="javascript:void(0);" title="YYYY-MM-DD HH:MM:SS">
 *     (BOJ shows "N일 전" as the visible text and the precise timestamp as
 *     the title attribute of the same anchor)
 *   - Comments:     #comment list items, or a comment count badge
 *
 * If BOJ changes this layout, update the selectors here — parse failures
 * should produce empty strings / 0 rather than throw, so the scraper can
 * still write `post.html` (which is the real source of truth).
 */
export async function parseBoardPost(page: Page): Promise<BoardPostMeta> {
  return page.evaluate(() => {
    // Title — page-header styled h2/h1/h3
    const titleEl =
      document.querySelector('h2.page-header') ??
      document.querySelector('.page-header h2') ??
      document.querySelector('.page-header h1') ??
      document.querySelector('h2') ??
      document.querySelector('h1');
    const title = (titleEl?.textContent ?? '').trim().replace(/\s+/g, ' ');

    // Author — the first /user/{handle} link inside the post metadata block
    // (the body's /user/ links are user mentions, not the author). We narrow by
    // picking the link whose closest ancestor is a <tr>/<div> with class
    // containing "problem-source" or the "글쓴이" label nearby.
    let author = '';
    const userLinks = Array.from(document.querySelectorAll('a[href^="/user/"]'));
    for (const a of userLinks) {
      const href = a.getAttribute('href') ?? '';
      const m = href.match(/\/user\/([^/?#]+)/);
      if (!m) continue;
      // Use the first one — BOJ's board post metadata places the author link
      // before any body user-mentions.
      author = m[1];
      break;
    }

    // Timestamp — find an <a> with both relative text ("N일 전" / "Ndays ago")
    // and an absolute title attribute.
    let writtenAt = '';
    for (const a of Array.from(document.querySelectorAll('a[title]'))) {
      const title = a.getAttribute('title') ?? '';
      // Accept YYYY-MM-DD HH:MM:SS or similar
      const dateMatch = title.match(/^(\d{4}-\d{2}-\d{2})[\sT](\d{2}:\d{2}:\d{2})/);
      if (dateMatch) {
        // Convert to ISO (assume Asia/Seoul — server time; for backup purposes
        // we store the local string plus a 'Z' would be wrong. Use '+09:00'.)
        writtenAt = `${dateMatch[1]}T${dateMatch[2]}+09:00`;
        break;
      }
    }

    // Comment count — count <div class="comment"> or similar; fall back to 0
    const commentNodes =
      document.querySelectorAll('.comment, #comments .comment-list > *, .comment-row');
    const commentCount = commentNodes.length;

    return { title, author, writtenAt, commentCount };
  });
}
```

**Note on the timestamp strategy:** BOJ renders both a relative (`2일 전`) and an absolute (`2026-04-17 18:23:45`) form. The absolute form is typically in the anchor's `title` attribute so tooltip reveals exact time. If the fixture captures a post where this pattern doesn't hold, the parser returns `writtenAt = ''` — acceptable degradation, since the full HTML is still saved.

- [ ] **Step 9.5: Run the test until green**

Run: `npx vitest run tests/board-post-parser.test.ts`
Expected: PASS.

**Troubleshoot:** If `writtenAt` comes back empty, open the fixture in a browser, inspect the element holding the date, and adjust the selector. The test tolerates `commentCount = 0` but not a missing title/author — those failures indicate a selector bug.

- [ ] **Step 9.6: Commit**

```bash
git add tests/fixtures/board/post.html src/parsers/board-post.ts tests/board-post-parser.test.ts
git commit -m "feat(board): parse post page metadata (title/author/writtenAt/comments)"
```

---

## Phase 6: Board — pagination helper

### Task 10: `paginateBoardList` — cursor-style pagination with cache

**Files:**
- Modify: `src/parsers/board-list.ts` (add `paginateBoardList` + cache I/O)
- Create: `tests/paginate-board-list.test.ts`

- [ ] **Step 10.1: Write failing tests**

Create `tests/paginate-board-list.test.ts`:

```typescript
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
} from '../src/parsers/board-list.js';

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
```

- [ ] **Step 10.2: Run the tests — expect failure**

Run: `npx vitest run tests/paginate-board-list.test.ts`
Expected: FAIL — `paginateBoardList`, `loadBoardListCache`, `saveBoardListCache` don't exist yet.

- [ ] **Step 10.3: Implement pagination + cache in `board-list.ts`**

Append to `src/parsers/board-list.ts` (keeping the existing `parseBoardList` and `getBoardNextPageHref` from Task 8):

```typescript
import { readFile, writeFile } from 'node:fs/promises';
import type { BrowserContext } from 'playwright';
import type { RateLimiter } from '../core/rate-limiter.js';
import type { Logger } from '../core/utils.js';
import { withPage } from '../core/utils.js';

export interface BoardListCache {
  complete: boolean;
  nextCursor: string | null;  // absolute or /-prefixed URL, or null when done
  posts: BoardListRow[];
}

export interface BoardPaginateCacheOptions {
  cachePath: string;
  resume: boolean;
}

export async function loadBoardListCache(
  path: string,
): Promise<BoardListCache | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as BoardListCache;
    if (
      typeof parsed.complete !== 'boolean' ||
      !Array.isArray(parsed.posts) ||
      (parsed.nextCursor !== null && typeof parsed.nextCursor !== 'string')
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveBoardListCache(
  path: string,
  cache: BoardListCache,
): Promise<void> {
  await writeFile(path, JSON.stringify(cache, null, 2), 'utf-8');
}

/**
 * Walk /board/search/... by following the "다음 페이지" link on each page.
 * Dedupes rows by postId and filters by author (same as parseBoardList).
 *
 * Cache (opt-in): resume=true picks up from `nextCursor`; resume=false
 * ignores an existing cache but still writes a fresh one as the run proceeds.
 */
export async function paginateBoardList(
  context: BrowserContext,
  baseUrl: string,
  filterAuthor: string,
  rateLimiter: RateLimiter,
  log: Logger,
  cacheOptions?: BoardPaginateCacheOptions,
): Promise<BoardListRow[]> {
  const result: BoardListRow[] = [];
  const seen = new Set<number>();
  let nextUrl: string | null = baseUrl;

  if (cacheOptions?.resume) {
    const cache = await loadBoardListCache(cacheOptions.cachePath);
    if (cache) {
      if (cache.complete) {
        log.info(`board 캐시 hit (complete): ${cache.posts.length}개 — 네트워크 요청 생략`);
        return cache.posts;
      }
      for (const p of cache.posts) {
        if (seen.has(p.postId)) continue;
        seen.add(p.postId);
        result.push(p);
      }
      nextUrl = cache.nextCursor
        ? absolutize(cache.nextCursor)
        : baseUrl; // incomplete cache with null cursor = restart from baseUrl
      log.info(`board 캐시 복원: ${result.length}개 — ${nextUrl}부터 이어서 수집`);
    }
  }

  const persist = async (complete: boolean, nextCursor: string | null) => {
    if (!cacheOptions) return;
    await saveBoardListCache(cacheOptions.cachePath, {
      complete,
      nextCursor,
      posts: result,
    });
  };

  let firstFetch = true;
  while (nextUrl) {
    if (!firstFetch) {
      await rateLimiter.waitPagination();
    }
    firstFetch = false;

    const currentUrl: string = nextUrl;
    const { rows, nextHref } = await withPage(context, currentUrl, async (page) => {
      const rows = await parseBoardList(page, filterAuthor);
      const nextHref = await getBoardNextPageHref(page);
      return { rows, nextHref };
    });

    let added = 0;
    for (const r of rows) {
      if (seen.has(r.postId)) continue;
      seen.add(r.postId);
      result.push(r);
      added++;
    }
    log.info(`board 페이지 ${currentUrl}: ${rows.length}개 (신규 ${added}), 누적 ${result.length}개`);

    nextUrl = nextHref ? absolutize(nextHref) : null;
    await persist(false, nextHref);
  }

  await persist(true, null);
  return result;
}

function absolutize(href: string): string {
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('/')) return `https://www.acmicpc.net${href}`;
  return `https://www.acmicpc.net/${href}`;
}
```

- [ ] **Step 10.4: Run the tests until green**

Run: `npx vitest run tests/paginate-board-list.test.ts`
Expected: all 4 tests pass.

- [ ] **Step 10.5: Commit**

```bash
git add src/parsers/board-list.ts tests/paginate-board-list.test.ts
git commit -m "feat(board): paginate search-author with cursor cache + resume"
```

---

## Phase 7: Board — scraper orchestration

### Task 11: `scrapeBoard` — ties parsers + pagination together

**Files:**
- Create: `src/scrapers/board.ts`
- Create: `tests/scrape-board-pagination.test.ts`

- [ ] **Step 11.1: Write failing scraper test**

Create `tests/scrape-board-pagination.test.ts`:

```typescript
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
```

- [ ] **Step 11.2: Run the tests — expect failure**

Run: `npx vitest run tests/scrape-board-pagination.test.ts`
Expected: FAIL — `scrapeBoard` does not exist.

- [ ] **Step 11.3: Implement `scrapeBoard`**

Create `src/scrapers/board.ts`:

```typescript
import { join } from 'node:path';
import type { BrowserContext } from 'playwright';
import type { BackupConfig, BoardIndex, BoardPost } from '../types/index.js';
import { RateLimiter } from '../core/rate-limiter.js';
import { ProgressTracker } from '../core/progress.js';
import { createLogger, withPage, ensureDir } from '../core/utils.js';
import { paginateBoardList } from '../parsers/board-list.js';
import { parseBoardPost } from '../parsers/board-post.js';
import { writeJson, writeHtml } from '../writers/json-writer.js';

export async function scrapeBoard(
  context: BrowserContext,
  config: BackupConfig,
  rateLimiter: RateLimiter,
  progress: ProgressTracker,
): Promise<number> {
  const log = createLogger('board');

  // 1. Collect every page of the user's board posts
  const searchUrl = `https://www.acmicpc.net/board/search/all/author/${config.user}`;
  const cachePath = join(config.outputDir, 'board-cache.json');
  log.info(`게시판 목록 수집 시작: ${searchUrl}`);
  const rows = await paginateBoardList(
    context,
    searchUrl,
    config.user,
    rateLimiter,
    log,
    { cachePath, resume: config.resume },
  );
  log.info(`게시글 ${rows.length}개 발견`);

  const limited = config.limit ? rows.slice(0, config.limit) : rows;

  const indexEntries: BoardIndex['posts'] = [];
  const byCategory: Record<string, number> = {};

  // 2. Process each post
  for (const row of limited) {
    if (progress.isCompleted('board', row.postId)) {
      log.info(`건너뜀 (이미 완료): #${row.postId} ${row.title}`);
      indexEntries.push({
        postId: row.postId,
        title: row.title,
        categorySlug: row.categorySlug,
        categoryName: row.categoryName,
        problemId: row.problemId,
        author: row.author,
        writtenAt: '',              // we don't re-fetch to find writtenAt for already-completed posts
        commentCount: 0,
        path: `board/${row.categorySlug}/${row.postId}/`,
      });
      byCategory[row.categorySlug] = (byCategory[row.categorySlug] ?? 0) + 1;
      continue;
    }

    try {
      log.info(`처리 중: #${row.postId} [${row.categorySlug}] ${row.title}`);

      await rateLimiter.wait();
      const postDir = join(config.outputDir, 'board', row.categorySlug, String(row.postId));
      await ensureDir(postDir);

      const { meta, html } = await withPage(
        context,
        `https://www.acmicpc.net/board/view/${row.postId}`,
        async (page) => {
          const meta = await parseBoardPost(page);
          const html = await page.content();
          return { meta, html };
        },
      );

      const post: BoardPost = {
        postId: row.postId,
        title: meta.title || row.title,
        categoryId: row.categoryId,
        categorySlug: row.categorySlug,
        categoryName: row.categoryName,
        problemId: row.problemId,
        author: meta.author || row.author,
        writtenAt: meta.writtenAt,
        commentCount: meta.commentCount,
        fetchedAt: new Date().toISOString(),
      };

      await writeJson(join(postDir, 'post.json'), post);
      await writeHtml(join(postDir, 'post.html'), html);

      indexEntries.push({
        postId: post.postId,
        title: post.title,
        categorySlug: post.categorySlug,
        categoryName: post.categoryName,
        problemId: post.problemId,
        author: post.author,
        writtenAt: post.writtenAt,
        commentCount: post.commentCount,
        path: `board/${post.categorySlug}/${post.postId}/`,
      });
      byCategory[post.categorySlug] = (byCategory[post.categorySlug] ?? 0) + 1;

      progress.markCompleted('board', post.postId);
      await progress.save();
      log.info(`완료: #${post.postId}`);
    } catch (err) {
      log.error(
        `게시글 처리 실패 (#${row.postId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 3. Save the index
  const index: BoardIndex = {
    totalCount: indexEntries.length,
    byCategory,
    posts: indexEntries,
    lastUpdated: new Date().toISOString(),
  };
  await writeJson(join(config.outputDir, 'board', 'index.json'), index);
  log.info(`게시판 인덱스 저장: ${join(config.outputDir, 'board', 'index.json')}`);

  return rows.length;
}
```

- [ ] **Step 11.4: Run the tests until green**

Run: `npx vitest run tests/scrape-board-pagination.test.ts`
Expected: both tests pass.

- [ ] **Step 11.5: Commit**

```bash
git add src/scrapers/board.ts tests/scrape-board-pagination.test.ts
git commit -m "feat(board): scrape user posts into per-category directories"
```

---

## Phase 8: Wire into `runBackup`

### Task 12: Add three phases to `runBackup` + fix stats

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 12.1: Add imports and stats fields**

In `src/index.ts`, add three imports after the existing scraper imports (around line 12):

```typescript
import { scrapeCorrected } from './scrapers/corrected.js';
import { scrapeDataAdded } from './scrapers/dataadded.js';
import { scrapeBoard } from './scrapers/board.js';
```

Update the `stats` object initialization (around line 45-50) from:

```typescript
  const stats = {
    submissions: 0,
    solvedProblems: 0,
    authoredProblems: 0,
    reviewedProblems: 0,
  };
```

to:

```typescript
  const stats = {
    submissions: 0,
    solvedProblems: 0,
    authoredProblems: 0,
    reviewedProblems: 0,
    correctedProblems: 0,
    dataAddedProblems: 0,
    boardPosts: 0,
  };
```

- [ ] **Step 12.2: Add three phases at the end of the try block**

In `src/index.ts`, after the existing "5. Solved problems backup" block (around line 91, just before "6. Save final metadata"), insert:

```typescript
    // 6. Corrected contributions backup
    if (shouldRun('corrected')) {
      display.startPhase('오타 수정 기여 문제 백업 시작...');
      stats.correctedProblems = await scrapeCorrected(context, config, rateLimiter, progress);
      display.complete('오타 수정 기여 문제 백업 완료');
    }

    // 7. Data-added contributions backup
    if (shouldRun('dataadded')) {
      display.startPhase('데이터 추가 기여 문제 백업 시작...');
      stats.dataAddedProblems = await scrapeDataAdded(context, config, rateLimiter, progress);
      display.complete('데이터 추가 기여 문제 백업 완료');
    }

    // 8. Board posts backup
    if (shouldRun('board')) {
      display.startPhase('게시판 글 백업 시작...');
      stats.boardPosts = await scrapeBoard(context, config, rateLimiter, progress);
      display.complete('게시판 글 백업 완료');
    }
```

Renumber the trailing comment from `// 6. Save final metadata` to `// 9. Save final metadata` for consistency.

- [ ] **Step 12.3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (earlier Task 1 errors in this file are now fixed).

- [ ] **Step 12.4: Full test run**

Run: `npm test`
Expected: all tests pass — existing + 6 new test files from this plan (`scrape-corrected-pagination`, `scrape-dataadded-pagination`, `board-categories`, `board-list-parser`, `board-post-parser`, `paginate-board-list`, `scrape-board-pagination`).

- [ ] **Step 12.5: Build**

Run: `npm run build`
Expected: clean compile, `dist/` populated.

- [ ] **Step 12.6: Commit**

```bash
git add src/index.ts
git commit -m "feat(runBackup): wire corrected/dataadded/board phases"
```

---

## Phase 9: Documentation

### Task 13: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 13.1: Extend the 사용법 section**

In `README.md`, inside the "사용법" section (around line 94-121), find the block:

```bash
# 특정 카테고리만 백업
npm start -- --user <handle> --only submissions
npm start -- --user <handle> --only authored
npm start -- --user <handle> --only reviewed
npm start -- --user <handle> --only solved
npm start -- --user <handle> --only profile
```

Insert three new lines after `--only profile`:

```bash
npm start -- --user <handle> --only corrected
npm start -- --user <handle> --only dataadded
npm start -- --user <handle> --only board
```

- [ ] **Step 13.2: Extend the 백업 대상 section**

In the "백업 대상" section (around line 135-141), append three bullets after the existing 5:

```markdown
- **오타 수정 기여** — `/problem/author/{user}/3`에 나열된 문제 본문 (기여한 문제)
- **데이터 추가 기여** — `/problem/author/{user}/6`에 나열된 문제 본문 (기여한 문제)
- **게시판 글** — 본인이 쓴 모든 게시글(본문 + 댓글)을 카테고리별 디렉토리에 저장
```

- [ ] **Step 13.3: Extend the 출력 구조 tree**

In the "출력 구조" tree (around line 143-178), insert the following blocks between `reviewed/` and `solved/`:

```
├── corrected/
│   ├── index.json
│   └── {problem_id}/
│       ├── problem.json
│       ├── problem.html
│       └── problem.png
├── dataadded/
│   ├── index.json
│   └── {problem_id}/
│       ├── problem.json
│       ├── problem.html
│       └── problem.png
```

And insert after `submissions/`:

```
└── board/
    ├── index.json
    └── {category_slug}/
        └── {post_id}/
            ├── post.json
            └── post.html
```

(Note: `submissions/` is currently the last entry in the tree; replace its leading `└──` with `├──` when adding `board/` after it. The board entry keeps `└──`.)

- [ ] **Step 13.4: Add Changelog entry**

In the "Changelog" section (around line 191), insert a new entry at the top (before `### 2026-04-17`):

```markdown
### 2026-04-19

- 오타 수정 기여 문제 백업 추가 — `--only corrected` (`/problemset?author_type=3`)
- 데이터 추가 기여 문제 백업 추가 — `--only dataadded` (`/problemset?author_type=6`)
- BOJ 게시판에 본인이 쓴 글 백업 추가 — `--only board` (카테고리별 디렉토리, 댓글 포함, 전체 페이지 순회 및 `--resume` 지원)
```

- [ ] **Step 13.5: Commit**

```bash
git add README.md
git commit -m "docs: document corrected/dataadded/board backup categories"
```

---

## Phase 10: Final verification

### Task 14: Full suite + manual smoke

**Files:** (none)

- [ ] **Step 14.1: Run every test**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 14.2: Typecheck + build**

Run: `npm run build`
Expected: clean compile, `dist/` populated.

- [ ] **Step 14.3: Manual smoke (requires BOJ session)**

Assuming Chrome is running with `--remote-debugging-port=9222` and logged in as `amsminn`:

1. `npm start -- --user amsminn --only corrected` — verify `output/corrected/index.json` lists ≥1 problem and corresponding `{id}/problem.html` is non-empty.
2. `npm start -- --user amsminn --only dataadded` — same verification.
3. `npm start -- --user amsminn --only board` — verify:
   - `output/board/index.json` has `byCategory.typo` ≥ 1
   - At least one `output/board/typo/{post_id}/post.html` exists and contains `댓글` or a known comment phrase (confirms comments were captured inline).
4. Interrupt the board scraper mid-pagination (Ctrl+C during `paginateBoardList` logging) and re-run with `--resume`. Verify the log shows `board 캐시 복원: ...` and the second run does not refetch already-completed posts.

- [ ] **Step 14.4: Open PR**

```bash
git push -u origin feat/contributions-and-board-backup
gh pr create --title "feat: backup corrected/dataadded contributions + board posts" --body "$(cat <<'EOF'
## Summary
- Add `scrapeCorrected` (`author_type=3`) and `scrapeDataAdded` (`author_type=6`) contribution scrapers, reusing `paginateProblemList` for full-list collection + cache + `--resume`.
- Add `scrapeBoard`: paginates `/board/search/all/author/{user}` via cursor-based "다음 페이지" traversal, stores each post under `output/board/{category_slug}/{post_id}/` with `post.html` (comments inline) + parsed `post.json`.
- Extend `ProgressTracker` to track the three new categories; extend `BackupMetadata.stats`; extend CLI `--only` choices.
- Unit tests: scraper pagination assertions, board list/post parsers against real BOJ HTML fixtures, category mapping, pagination cache (complete/incomplete/corrupt/resume).
- README updates: 사용법, 백업 대상, 출력 구조, Changelog 2026-04-19.

Spec: `docs/superpowers/specs/2026-04-19-contributions-and-board-backup-design.md`

## Test plan
- [ ] `npm test` — full suite green locally
- [ ] `npm run build` — clean compile
- [ ] Manual: `--only corrected`, `--only dataadded`, `--only board` each produce expected directories against `amsminn`'s account
- [ ] Manual: mid-run Ctrl+C + `--resume` for `--only board` triggers cache restore log
EOF
)"
```

---

## Rollback

If anything goes wrong after merge:

```bash
git revert <merge-commit-sha>
```

All changes are additive (three new scrapers, new parsers, new types, new CLI choices); no existing backup category's behavior is changed. A single revert cleanly restores the pre-feature state.
