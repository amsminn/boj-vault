import type { Page } from 'playwright';
import type { Submission } from '../types/index.js';

/**
 * Parse the submission list table from a BOJ /status page.
 *
 * BOJ's #status-table columns:
 *   제출 번호 | 아이디 | 문제 | 문제 제목 | 결과 | 메모리 | 시간 | 언어 | 코드 길이 | 제출한 시간
 */
export async function parseSubmissionTable(page: Page): Promise<Submission[]> {
  return page.evaluate(`
    (() => {
      const rows = document.querySelectorAll('#status-table tbody tr');
      const submissions = [];

      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 9) continue;

        // BOJ status table columns (9 columns):
        // 0: 제출 번호, 1: 아이디, 2: 문제(번호+제목), 3: 결과,
        // 4: 메모리, 5: 시간, 6: 언어, 7: 코드 길이, 8: 제출한 시간
        const submissionId = parseInt(cells[0].textContent.trim(), 10);

        // Problem cell contains both ID and title — extract ID from the link
        const problemLink = cells[2].querySelector('a[href*="/problem/"]');
        const problemHref = problemLink ? problemLink.getAttribute('href') : '';
        const problemMatch = problemHref ? problemHref.match(/\\/problem\\/(\\d+)/) : null;
        const problemId = problemMatch ? parseInt(problemMatch[1], 10) : 0;
        const problemTitle = problemLink ? problemLink.getAttribute('data-original-title') || problemLink.textContent.trim() : '';

        const result = cells[3].querySelector('.result-text')
          ? cells[3].querySelector('.result-text').textContent.trim()
          : cells[3].textContent.trim();

        const memory = parseInt(cells[4].textContent.trim(), 10) || 0;
        const time = parseInt(cells[5].textContent.trim(), 10) || 0;
        const language = cells[6].textContent.trim();
        const codeLength = parseInt(cells[7].textContent.trim(), 10) || 0;

        // Submitted time — may have a title attribute with full datetime
        const timeAnchor = cells[8].querySelector('a[data-original-title], a[title]');
        const submittedAt = timeAnchor
          ? (timeAnchor.getAttribute('data-original-title') || timeAnchor.getAttribute('title') || '').trim()
          : cells[8].textContent.trim();

        if (submissionId && problemId) {
          submissions.push({
            submissionId,
            problemId,
            problemTitle: problemTitle || undefined,
            result,
            memory,
            time,
            language,
            codeLength,
            submittedAt,
          });
        }
      }

      return submissions;
    })()
  `) as Promise<Submission[]>;
}

/**
 * Extract source code from a submission detail page.
 *
 * Tries `<textarea class="codemirror-textarea">` first,
 * then falls back to a `<pre>` inside `.source`.
 */
export async function parseSourceCode(page: Page): Promise<string> {
  // Try textarea first
  const textarea = page.locator('textarea.codemirror-textarea');
  if (await textarea.count() > 0) {
    const code = await textarea.inputValue();
    if (code) return code;
  }

  // Fallback: <pre> inside .source container
  const sourcePre = page.locator('.source pre');
  if (await sourcePre.count() > 0) {
    const code = await sourcePre.innerText();
    if (code) return code;
  }

  return '';
}

/**
 * Check if there's a next page link in the pagination.
 *
 * Looks for `#next_page` or a pagination link containing `>` or `다음`.
 */
export async function hasNextPage(page: Page): Promise<boolean> {
  // Check for #next_page element
  const nextPageById = page.locator('#next_page');
  if (await nextPageById.count() > 0) {
    return true;
  }

  // Check for pagination links with ">" or "다음"
  const nextByText = page.locator('a:has-text("다음"), a:has-text(">")').first();
  if (await nextByText.count() > 0) {
    // Make sure the link is within a pagination context and is not just any ">"
    const isInPagination = await nextByText.evaluate((el) => {
      const parent = el.closest('.pagination, .paging, .page_navigation, nav');
      return parent !== null;
    });
    if (isInPagination) return true;
  }

  return false;
}
