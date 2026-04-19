import { readFile, writeFile } from 'node:fs/promises';
import type { BrowserContext } from 'playwright';
import type { RateLimiter } from '../core/rate-limiter.js';
import type { Logger } from '../core/utils.js';
import { withPage } from '../core/utils.js';
import type { BoardListRow } from '../types/index.js';
import { parseBoardList, getBoardNextPageHref } from './board-list.js';

export interface BoardListCache {
  complete: boolean;
  nextCursor: string | null; // absolute or /-prefixed URL, or null when done
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
