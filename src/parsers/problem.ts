import type { Page } from 'playwright';
import type { Problem } from '../types/index.js';

/**
 * Extract problem data from a BOJ problem page (/problem/{id}).
 *
 * Elements:
 *   - Title:        #problem_title
 *   - Info table:   #problem-info (time limit, memory limit)
 *   - Description:  #problem_description
 *   - Input:        #problem_input
 *   - Output:       #problem_output
 */
export async function parseProblemPage(page: Page): Promise<Problem> {
  return page.evaluate(() => {
    // Problem ID from the URL
    const urlMatch = window.location.pathname.match(/\/problem\/(\d+)/);
    const problemId = urlMatch ? parseInt(urlMatch[1], 10) : 0;

    // Title
    const titleEl = document.getElementById('problem_title');
    const title = titleEl?.textContent?.trim() ?? '';

    // Time limit and memory limit from the #problem-info table
    const infoTable = document.getElementById('problem-info');
    const infoRows = infoTable?.querySelectorAll('td') ?? [];
    const timeLimit = infoRows[0]?.textContent?.trim() ?? '';
    const memoryLimit = infoRows[1]?.textContent?.trim() ?? '';

    // Description sections (preserve HTML)
    const descriptionEl = document.getElementById('problem_description');
    const description = descriptionEl?.innerHTML?.trim() || undefined;

    const inputDescEl = document.getElementById('problem_input');
    const inputDesc = inputDescEl?.innerHTML?.trim() || undefined;

    const outputDescEl = document.getElementById('problem_output');
    const outputDesc = outputDescEl?.innerHTML?.trim() || undefined;

    // Tags (if present on the page — BOJ shows them as <a> inside .spoiler-link or #problem_tags)
    const tagElements = document.querySelectorAll('#problem_tags a, .problem-label');
    const tags: string[] = [];
    for (const tagEl of tagElements) {
      const text = tagEl.textContent?.trim();
      if (text) tags.push(text);
    }

    return {
      problemId,
      title,
      timeLimit,
      memoryLimit,
      description,
      inputDesc,
      outputDesc,
      tags: tags.length > 0 ? tags : undefined,
      fetchedAt: new Date().toISOString(),
    };
  });
}

/**
 * Parse a list of problems from a page containing a table with problem links.
 *
 * Used for authored/reviewed problem lists. Looks for `<a>` elements
 * whose href matches `/problem/{id}`.
 */
export async function parseProblemList(
  page: Page,
): Promise<{ problemId: number; title: string }[]> {
  return page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="/problem/"]');
    const problems: { problemId: number; title: string }[] = [];
    const seen = new Set<number>();

    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      const match = href.match(/\/problem\/(\d+)/);
      if (!match) continue;

      const problemId = parseInt(match[1], 10);
      if (!problemId || seen.has(problemId)) continue;

      seen.add(problemId);
      const title = link.textContent?.trim() ?? '';
      problems.push({ problemId, title });
    }

    return problems;
  });
}
