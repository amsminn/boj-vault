import { join } from 'node:path';
import type { BrowserContext } from 'playwright';
import type { BackupConfig } from '../types/index.js';
import { RateLimiter } from '../core/rate-limiter.js';
import { ProgressTracker } from '../core/progress.js';
import { createLogger, withPage, ensureDir } from '../core/utils.js';
import { parseProblemPage } from '../parsers/problem.js';
import { paginateProblemList } from '../parsers/paginate.js';
import { writeJson, writeHtml } from '../writers/json-writer.js';

export async function scrapeDataAdded(
  context: BrowserContext,
  config: BackupConfig,
  rateLimiter: RateLimiter,
  progress: ProgressTracker,
): Promise<number> {
  const log = createLogger('dataadded');

  // 1. Collect every page of the dataadded problems list.
  // Note: /problem/author/{user}/6 only returns page 1; the true paginated
  // endpoint is /problemset with author_type=6.
  const listUrl = `https://www.acmicpc.net/problemset?sort=no_asc&author=${config.user}&author_type=6`;
  const cachePath = join(config.outputDir, 'dataadded-cache.json');
  log.info(`데이터 추가 기여 문제 목록 수집 시작: ${listUrl}`);
  const problems = await paginateProblemList(
    context,
    listUrl,
    rateLimiter,
    log,
    { cachePath, resume: config.resume },
  );
  log.info(`데이터 추가 기여 문제 ${problems.length}개 발견`);

  // Apply limit
  const limited = config.limit ? problems.slice(0, config.limit) : problems;

  // 2. Save the index
  const indexPath = join(config.outputDir, 'dataadded', 'index.json');
  await writeJson(indexPath, {
    totalCount: problems.length,
    problems,
    lastUpdated: new Date().toISOString(),
  });
  log.info(`인덱스 저장: ${indexPath}`);

  // 3. Process each problem
  for (const { problemId, title } of limited) {
    if (progress.isCompleted('dataadded', problemId)) {
      log.info(`건너뜀 (이미 완료): #${problemId} ${title}`);
      continue;
    }

    try {
      log.info(`처리 중: #${problemId} ${title}`);

      await rateLimiter.wait();
      const problemDir = join(config.outputDir, 'dataadded', String(problemId));
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

      progress.markCompleted('dataadded', problemId);
      await progress.save();
      log.info(`완료: #${problemId} ${title}`);
    } catch (err) {
      log.error(
        `문제 처리 실패 (#${problemId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  log.info('데이터 추가 기여 문제 백업 완료');
  return problems.length;
}
