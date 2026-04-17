import { join } from 'node:path';
import type { BrowserContext } from 'playwright';
import type { BackupConfig } from '../types/index.js';
import { RateLimiter } from '../core/rate-limiter.js';
import { ProgressTracker } from '../core/progress.js';
import { createLogger, withPage, ensureDir } from '../core/utils.js';
import { parseProblemPage } from '../parsers/problem.js';
import { paginateProblemList } from '../parsers/paginate.js';
import { writeJson, writeHtml } from '../writers/json-writer.js';

export async function scrapeSolved(
  context: BrowserContext,
  config: BackupConfig,
  rateLimiter: RateLimiter,
  progress: ProgressTracker,
): Promise<void> {
  const log = createLogger('solved');

  // 1. Navigate to user profile to collect solved problem IDs
  const profileUrl = `https://www.acmicpc.net/user/${config.user}`;
  log.info(`사용자 프로필 페이지 이동: ${profileUrl}`);

  let problems = await withPage(context, profileUrl, async (page) => {
    // 2. Extract solved problem IDs from the profile page
    return await page.evaluate(() => {
      // BOJ profile page lists solved problems as links in the "맞은 문제" section
      // They typically appear inside a `.problem-list` element or similar
      const result: { problemId: number; title: string }[] = [];
      const seen = new Set<number>();

      // Try .problem-list first (common BOJ layout)
      const problemLinks = document.querySelectorAll(
        '.problem-list a, .panel .panel-body a[href*="/problem/"]',
      );

      for (const link of problemLinks) {
        const href = link.getAttribute('href') ?? '';
        const match = href.match(/\/problem\/(\d+)/);
        if (!match) continue;

        const problemId = parseInt(match[1], 10);
        if (!problemId || seen.has(problemId)) continue;

        seen.add(problemId);
        const title = link.textContent?.trim() ?? '';
        result.push({ problemId, title });
      }

      return result;
    });
  });

  // 3. Fallback: if no problems found on profile, try the problemset page
  if (problems.length === 0) {
    log.warn('프로필에서 맞은 문제를 찾을 수 없음 -- 대체 경로 시도');
    // paginateProblemList handles its own between-page pacing via
    // rateLimiter.waitPagination(); the prior profile fetch has already
    // closed, so we skip the extra rateLimiter.wait() here.
    const fallbackUrl = `https://www.acmicpc.net/problemset?sort=no_asc&user=${config.user}&result=ac`;
    log.info(`대체 페이지 수집 시작: ${fallbackUrl}`);
    problems = await paginateProblemList(context, fallbackUrl, rateLimiter, log);
  }

  log.info(`맞은 문제 ${problems.length}개 발견`);

  // Apply limit
  if (config.limit && problems.length > config.limit) {
    problems = problems.slice(0, config.limit);
    log.info(`제한 적용: ${config.limit}개만 수집`);
  }

  // 4. Save the index
  const indexPath = join(config.outputDir, 'solved', 'index.json');
  await writeJson(indexPath, {
    totalCount: problems.length,
    problems,
    lastUpdated: new Date().toISOString(),
  });
  log.info(`인덱스 저장: ${indexPath}`);

  // 5. Process each problem
  for (const { problemId, title } of problems) {
    if (progress.isCompleted('problems', problemId)) {
      log.info(`건너뜀 (이미 완료): #${problemId} ${title}`);
      continue;
    }

    try {
      log.info(`처리 중: #${problemId} ${title}`);

      // Navigate to problem page
      await rateLimiter.wait();
      const problemDir = join(config.outputDir, 'solved', String(problemId));
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

      // Save problem.json and problem.html
      await writeJson(join(problemDir, 'problem.json'), problemData);
      await writeHtml(join(problemDir, 'problem.html'), pageHtml);

      // Mark completed
      progress.markCompleted('problems', problemId);
      await progress.save();
      log.info(`완료: #${problemId} ${title}`);
    } catch (err) {
      log.error(
        `문제 처리 실패 (#${problemId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  log.info('맞은 문제 백업 완료');
}
