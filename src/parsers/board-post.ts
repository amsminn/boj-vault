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
 *   - Title:    .page-header h3 (NOT h2 — BOJ renders board post titles at h3)
 *   - Author:   first <a href="/user/{handle}"> on the page (post author link is
 *               rendered before any body user-mentions or comment authors)
 *   - Timestamp: <a title="YYYY-MM-DD HH:MM:SS" ...> — BOJ shows "N일 전"
 *               visible text and the precise timestamp in the title attribute
 *   - Comments: the post body AND each comment are wrapped in
 *               <div class="col-md-12 comment">. The first such div is the
 *               post body itself; subsequent ones are comments. So
 *               commentCount = count - 1 (clamped at 0).
 *
 * If BOJ changes this layout, update the selectors here — parse failures
 * should produce empty strings / 0 rather than throw, so the scraper can
 * still write `post.html` (which is the real source of truth).
 */
export async function parseBoardPost(page: Page): Promise<BoardPostMeta> {
  return page.evaluate(() => {
    // Title — board post title sits in `.page-header h3`, with h2/h1 as safety fallbacks
    const titleEl =
      document.querySelector('.page-header h3') ??
      document.querySelector('.page-header h2') ??
      document.querySelector('.page-header h1') ??
      document.querySelector('h2');
    const title = (titleEl?.textContent ?? '').trim().replace(/\s+/g, ' ');

    // Author — scope to the post metadata block so we don't pick up a /user/ link from
    // BOJ's nav/profile menu. The post author link lives inside the first
    // `<div class="col-md-12 comment"> .panel-heading` (the post body panel,
    // NOT a comment — BOJ re-uses the `.comment` class for the body).
    let author = '';
    const postMetaScope =
      document.querySelector('div.col-md-12.comment .panel-heading') ??
      document.querySelector('.page-header') ??
      document.body;
    const userLinks = Array.from(postMetaScope.querySelectorAll('a[href^="/user/"]'));
    for (const a of userLinks) {
      const href = a.getAttribute('href') ?? '';
      const m = href.match(/\/user\/([^/?#]+)/);
      if (!m) continue;
      author = m[1];
      break;
    }

    // Timestamp — BOJ stores the exact Unix timestamp in data-timestamp (KST = UTC+9).
    // Bootstrap's tooltip plugin moves the human-readable title to data-original-title
    // at runtime (leaving title=""), so we prefer data-timestamp for reliability.
    // Fallback: parse YYYY-MM-DD HH:MM:SS directly from the title attribute in case
    // the page is loaded before the tooltip JS runs.
    let writtenAt = '';
    for (const a of Array.from(document.querySelectorAll('a[data-timestamp]'))) {
      const tsStr = a.getAttribute('data-timestamp') ?? '';
      const ts = parseInt(tsStr, 10);
      if (!isNaN(ts) && ts > 0) {
        // Shift to KST by adding 9 hours, then format as ISO
        const kstMs = ts * 1000 + 9 * 3600 * 1000;
        const d = new Date(kstMs);
        const y = d.getUTCFullYear();
        const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        const h = String(d.getUTCHours()).padStart(2, '0');
        const mi = String(d.getUTCMinutes()).padStart(2, '0');
        const s = String(d.getUTCSeconds()).padStart(2, '0');
        writtenAt = `${y}-${mo}-${day}T${h}:${mi}:${s}+09:00`;
        break;
      }
    }
    // Fallback: title attribute (pre-tooltip-init or static pages)
    if (!writtenAt) {
      for (const a of Array.from(document.querySelectorAll('a[title]'))) {
        const titleAttr = a.getAttribute('title') ?? '';
        const dateMatch = titleAttr.match(/^(\d{4}-\d{2}-\d{2})[\sT](\d{2}:\d{2}:\d{2})/);
        if (dateMatch) {
          writtenAt = `${dateMatch[1]}T${dateMatch[2]}+09:00`;
          break;
        }
      }
    }

    // Comments — .col-md-12.comment divs contain both the post body (first) and
    // each comment. Subtract 1 for the post body itself.
    const allCommentDivs = document.querySelectorAll('div.col-md-12.comment');
    const commentCount = Math.max(0, allCommentDivs.length - 1);

    return { title, author, writtenAt, commentCount };
  });
}
