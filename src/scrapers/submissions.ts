import { join } from 'node:path';
import type { BrowserContext } from 'playwright';
import type { BackupConfig, Submission } from '../types/index.js';
import { RateLimiter } from '../core/rate-limiter.js';
import { ProgressTracker } from '../core/progress.js';
import {
  parseSubmissionTable,
  parseSourceCode,
  hasNextPage,
} from '../parsers/submission.js';
import { writeJson, writeSourceCode } from '../writers/json-writer.js';
import { ensureDir, createLogger, withPage, langToExt } from '../core/utils.js';

const MAX_RETRIES = 3;

export async function scrapeSubmissions(
  context: BrowserContext,
  config: BackupConfig,
  rateLimiter: RateLimiter,
  progress: ProgressTracker,
): Promise<Submission[]> {
  const log = createLogger('submissions');

  // ------------------------------------------------------------------
  // Phase 1: Collect submission list by paginating through /status
  // ------------------------------------------------------------------
  log.info(`제출 목록 수집 시작: ${config.user}`);

  const allSubmissions: Submission[] = [];
  let pageNum = 0;
  let lastSubmissionId: number | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    pageNum++;

    // Build URL: first page has no &top= param, subsequent pages use &top=lastId-1
    let url = `https://www.acmicpc.net/status?user_id=${config.user}`;
    if (lastSubmissionId !== undefined) {
      url += `&top=${lastSubmissionId - 1}`;
    }

    const { subs, morePages } = await withPage(context, url, async (page) => {
      const subs = await parseSubmissionTable(page);
      const morePages = subs.length > 0 ? await hasNextPage(page) : false;
      return { subs, morePages };
    });

    const submissions = subs;

    // Stop if the page returned no submissions
    if (submissions.length === 0) {
      log.info(`페이지 ${pageNum}: 제출 없음 — 수집 종료`);
      break;
    }

    allSubmissions.push(...submissions);
    log.info(`페이지 ${pageNum} 수집 완료 (${allSubmissions.length}건)`);

    // Stop if limit reached
    if (config.limit && allSubmissions.length >= config.limit) {
      allSubmissions.length = config.limit;
      log.info(`제한 도달 (${config.limit}건) — 수집 종료`);
      break;
    }

    // Update lastSubmissionId for next page pagination
    lastSubmissionId = submissions[submissions.length - 1].submissionId;

    // Check if there are more pages
    if (!morePages) {
      log.info('마지막 페이지 도달 — 수집 종료');
      break;
    }

    await rateLimiter.waitPagination();
  }

  log.info(`총 ${allSubmissions.length}건의 제출 수집 완료`);

  // ------------------------------------------------------------------
  // Phase 2: Collect source code for each submission
  // ------------------------------------------------------------------
  const total = allSubmissions.length;
  let current = 0;

  for (const submission of allSubmissions) {
    current++;
    const { submissionId, problemId } = submission;

    // Skip already completed submissions (resume support)
    if (progress.isCompleted('submissions', submissionId)) {
      continue;
    }

    // Log progress periodically (every submission, since each takes a while)
    log.info(`소스코드 수집 중 [${current}/${total}]`);

    let success = false;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const sourceUrl = `https://www.acmicpc.net/source/${submissionId}`;

        const sourceCode = await withPage(context, sourceUrl, async (page) => {
          // Check if redirected to login page
          if (page.url().includes('/login')) {
            log.error(
              `로그인이 필요합니다. Chrome에서 BOJ에 로그인되어 있는지 확인하세요.`,
            );
            return '';
          }

          return await parseSourceCode(page);
        });

        if (sourceCode) {
          submission.sourceCode = sourceCode;
        }

        success = true;
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(
          `제출 ${submissionId}: 시도 ${attempt + 1}/${MAX_RETRIES} 실패 — ${msg}`,
        );
        if (attempt < MAX_RETRIES - 1) {
          await rateLimiter.backoff(attempt);
        }
      }
    }

    if (!success && !submission.sourceCode) {
      log.error(
        `제출 ${submissionId}: 소스코드 수집 실패 — 메타데이터만 저장합니다`,
      );
    }

    // Save submission files
    const submissionDir = join(
      config.outputDir,
      'submissions',
      String(problemId),
    );
    await ensureDir(submissionDir);

    // Save source code as a separate file with proper extension
    if (submission.sourceCode) {
      const ext = langToExt(submission.language);
      await writeSourceCode(
        join(submissionDir, `${submissionId}${ext}`),
        submission.sourceCode,
      );
    }

    // Save metadata JSON (without inline sourceCode)
    const { sourceCode: _, ...meta } = submission;
    await writeJson(join(submissionDir, `${submissionId}.json`), meta);

    // Mark completed and persist progress
    progress.markCompleted('submissions', submissionId);
    await progress.save();

    // Rate limit between source-code fetches
    await rateLimiter.wait();
  }

  log.info(`소스코드 수집 완료 (${total}건)`);
  return allSubmissions;
}
