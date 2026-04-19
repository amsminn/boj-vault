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
  const rawRows = await page.evaluate(() => {
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
  page: Page,
): Promise<string | null> {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('a'));
    const next = candidates.find((a) => a.textContent?.trim() === '다음 페이지');
    if (!next) return null;
    return next.getAttribute('href');
  });
}
