import { join } from 'node:path';
import type { BrowserContext } from 'playwright';
import type { BackupConfig, AuthoredProblem } from '../types/index.js';
import { RateLimiter } from '../core/rate-limiter.js';
import { ProgressTracker } from '../core/progress.js';
import { ensureDir, createLogger, withPage } from '../core/utils.js';
import { parseProblemPage } from '../parsers/problem.js';
import { paginateProblemList } from '../parsers/paginate.js';
import { writeJson, writeHtml } from '../writers/json-writer.js';

export async function scrapeAuthored(
  context: BrowserContext,
  config: BackupConfig,
  rateLimiter: RateLimiter,
  progress: ProgressTracker,
): Promise<void> {
  const log = createLogger('authored');

  // 1. Collect every page of the authored problems list.
  // Note: /problem/author/{user}/1 always returns page 1 regardless of ?page=;
  // the true paginated endpoint is /problemset with author_type=1.
  const listUrl = `https://www.acmicpc.net/problemset?sort=no_asc&author=${config.user}&author_type=1`;
  const cachePath = join(config.outputDir, 'authored-cache.json');
  log.info(`출제한 문제 목록 수집 시작: ${listUrl}`);
  const problems = await paginateProblemList(
    context,
    listUrl,
    rateLimiter,
    log,
    { cachePath, resume: config.resume },
  );
  log.info(`출제한 문제 ${problems.length}개 발견`);

  // Apply limit
  const limited = config.limit ? problems.slice(0, config.limit) : problems;

  // 3. Save the index
  const indexPath = join(config.outputDir, 'authored', 'index.json');
  await writeJson(indexPath, {
    totalCount: problems.length,
    problems,
    lastUpdated: new Date().toISOString(),
  });
  log.info(`인덱스 저장: ${indexPath}`);

  // 4. Process each problem
  for (const { problemId, title } of limited) {
    if (progress.isCompleted('authored', problemId)) {
      log.info(`건너뜀 (이미 완료): #${problemId} ${title}`);
      continue;
    }

    try {
      log.info(`처리 중: #${problemId} ${title}`);

      // Navigate to problem page
      await rateLimiter.wait();
      const problemDir = join(config.outputDir, 'authored', String(problemId));
      await ensureDir(problemDir);
      const { problemData, pageHtml, hasSpecialJudge } = await withPage(
        context,
        `https://www.acmicpc.net/problem/${problemId}`,
        async (page) => {
          const problemData = await parseProblemPage(page);
          const pageHtml = await page.content();
          const hasSpecialJudge = pageHtml.includes('스페셜 저지');
          await page.screenshot({ path: join(problemDir, 'problem.png'), fullPage: true });
          return { problemData, pageHtml, hasSpecialJudge };
        },
      );

      // Build AuthoredProblem — start with languages as ['ko']
      const languages: string[] = ['ko'];

      const authoredProblem: AuthoredProblem = {
        ...problemData,
        hasSpecialJudge,
        hasEditorial: false,
        languages,
      };

      // Save problem.json and problem.html
      await writeJson(join(problemDir, 'problem.json'), authoredProblem);
      await writeHtml(join(problemDir, 'problem.html'), pageHtml);
      log.info(`저장 완료: #${problemId} problem.json / problem.html`);

      // Try to get English version
      try {
        await rateLimiter.wait();
        const enResult = await withPage(
          context,
          `https://www.acmicpc.net/problem/${problemId}?language=en`,
          async (page) => {
            const hasTitleEn = await page
              .locator('#problem_title')
              .count()
              .then((c) => c > 0);

            if (hasTitleEn) {
              const enHtml = await page.content();
              return { hasEnglish: true, enHtml };
            }
            return { hasEnglish: false, enHtml: '' };
          },
        );

        if (enResult.hasEnglish) {
          await writeHtml(join(problemDir, 'problem_en.html'), enResult.enHtml);
          languages.push('en');
          // Re-save problem.json with updated languages
          authoredProblem.languages = languages;
          await writeJson(join(problemDir, 'problem.json'), authoredProblem);
          log.info(`영문 버전 저장: #${problemId} problem_en.html`);
        }
      } catch (err) {
        log.warn(
          `영문 버전 가져오기 실패 (#${problemId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Try to get test data (best-effort)
      try {
        await rateLimiter.wait();
        const testdataUrl = `https://www.acmicpc.net/problem/testdata/${problemId}`;
        const testFiles = await withPage(context, testdataUrl, async (page) => {
          // Check if the page has a table with test data rows
          return await page.evaluate(() => {
            const rows = document.querySelectorAll('table tbody tr');
            const files: { name: string; href: string }[] = [];
            for (const row of rows) {
              const link = row.querySelector('a[href]');
              if (link) {
                const href = link.getAttribute('href') ?? '';
                const name = link.textContent?.trim() ?? '';
                if (href && name) {
                  files.push({ name, href });
                }
              }
            }
            return files;
          });
        });

        if (testFiles.length > 0) {
          const testdataDir = join(problemDir, 'testdata');
          await ensureDir(testdataDir);
          authoredProblem.testdataCount = testFiles.length;
          log.info(`테스트 데이터 ${testFiles.length}개 발견: #${problemId}`);

          for (const file of testFiles) {
            try {
              const fileUrl = file.href.startsWith('http')
                ? file.href
                : `https://www.acmicpc.net${file.href}`;

              await rateLimiter.wait();
              const body = await withPage(context, fileUrl, async (page) => {
                // Plain-text test data files are rendered inside <pre> by the browser.
                // Extract just the text content, not the HTML wrapper.
                return await page.evaluate(
                  () => document.body.innerText ?? document.body.textContent ?? '',
                );
              });

              await writeHtml(join(testdataDir, file.name), body);
              log.info(`테스트 데이터 저장: ${file.name}`);
            } catch (fileErr) {
              log.warn(
                `테스트 데이터 다운로드 실패 (${file.name}): ${fileErr instanceof Error ? fileErr.message : String(fileErr)}`,
              );
            }
          }

          // Re-save with testdataCount
          await writeJson(join(problemDir, 'problem.json'), authoredProblem);
        } else {
          log.info(`테스트 데이터 없음: #${problemId}`);
        }
      } catch (err) {
        log.warn(
          `테스트 데이터 가져오기 실패 (#${problemId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Mark completed
      progress.markCompleted('authored', problemId);
      await progress.save();
      log.info(`완료: #${problemId} ${title}`);
    } catch (err) {
      log.error(
        `문제 처리 실패 (#${problemId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  log.info('출제한 문제 백업 완료');
}
