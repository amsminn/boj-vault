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

  // Skip the pagination delay before the first fetch of this run — whether
  // starting fresh (pageNum=0) or resuming from a cached pageNum>0, there's
  // no prior in-session request to pace against.
  let firstFetch = true;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    pageNum++;
    if (!firstFetch) {
      await rateLimiter.waitPagination();
    }
    firstFetch = false;

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
