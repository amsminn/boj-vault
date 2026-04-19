import { readFile, writeFile } from 'node:fs/promises';
import type { BrowserContext, Page } from 'playwright';
import type { RateLimiter } from '../core/rate-limiter.js';
import type { Logger } from '../core/utils.js';
import { withPage } from '../core/utils.js';
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
  page: Page | { __response: { rows?: BoardListRow[] } },
  filterAuthor: string,
): Promise<BoardListRow[]> {
  // Test stub: if the page carries a pre-loaded __response, return it directly.
  if ('__response' in page) {
    const rows = (page as any).__response?.rows ?? [];
    return (rows as BoardListRow[]).filter((r: BoardListRow) => r.author === filterAuthor);
  }
  const realPage = page as Page;
  const rawRows = await realPage.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    return rows.map((row) => {
      // Anchor on href prefixes instead of column positions so future column
      // additions/reorders don't silently shift data into the wrong field.
      const titleLink = row.querySelector('a[href^="/board/view/"]');
      const titleHref = titleLink?.getAttribute('href') ?? '';
      const postIdMatch = titleHref.match(/\/board\/view\/(\d+)/);

      const catListLink = row.querySelector('a[href^="/board/list/"]');
      const catHref = catListLink?.getAttribute('href') ?? '';
      const catIdMatch = catHref.match(/\/board\/list\/(\d+)/);

      const problemLink = row.querySelector('a[href^="/problem/"]');
      const problemHref = problemLink?.getAttribute('href') ?? '';
      const problemMatch = problemHref.match(/\/problem\/(\d+)/);

      const authorLink = row.querySelector('a[href^="/user/"]');
      const authorText = authorLink?.textContent?.trim() ?? '';

      // Date cell: the last <td> that contains no <a> (date column is text-only).
      const dateCell = Array.from(row.querySelectorAll('td'))
        .reverse()
        .find((td) => !td.querySelector('a'));
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
    if (!r.postId || !r.author) continue; // skip malformed/empty rows (separators, etc.)
    if (r.author !== filterAuthor) continue; // skip pinned site-wide notices
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

export async function getBoardNextPageHref(
  page: Page | { __response: { nextHref?: string | null } },
): Promise<string | null> {
  // Test stub: if the page carries a pre-loaded __response, return it directly.
  if ('__response' in page) {
    return (page as any).__response?.nextHref ?? null;
  }
  return (page as Page).evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('a'));
    const next = candidates.find((a) => a.textContent?.trim() === '다음 페이지');
    if (!next) return null;
    return next.getAttribute('href');
  });
}

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
