import { join } from 'node:path';
import type { BackupConfig } from './types/index.js';
import { connectBrowser, disconnectBrowser } from './core/cdp.js';
import { RateLimiter } from './core/rate-limiter.js';
import { ProgressTracker } from './core/progress.js';
import { createLogger, ensureDir } from './core/utils.js';
import { Display } from './cli/display.js';
import { scrapeProfile } from './scrapers/profile.js';
import { scrapeSubmissions } from './scrapers/submissions.js';
import { scrapeAuthored } from './scrapers/authored.js';
import { scrapeReviewed } from './scrapers/reviewed.js';
import { scrapeSolved } from './scrapers/solved.js';
import { scrapeCorrected } from './scrapers/corrected.js';
import { scrapeDataAdded } from './scrapers/dataadded.js';
import { scrapeBoard } from './scrapers/board.js';
import { buildSubmissionIndex, buildMetadata } from './writers/index-builder.js';
import { writeJson } from './writers/json-writer.js';

export async function runBackup(config: BackupConfig): Promise<void> {
  const log = createLogger('main');
  const display = new Display();

  // Ensure output directory exists
  await ensureDir(config.outputDir);

  // Initialize progress tracker
  const progressPath = join(config.outputDir, 'progress.json');
  const progress = new ProgressTracker(progressPath);
  if (config.resume) {
    await progress.load();
    log.info('이전 진행 상태를 불러왔습니다');
  }

  // Initialize rate limiter (delay is in seconds from CLI, convert to ms)
  const rateLimiter = new RateLimiter({
    baseDelay: config.delay * 1000,
    paginationDelay: config.delay * 1500,
  });

  // Connect to browser via CDP
  display.startPhase('브라우저 연결 중...');
  const { browser, context, page } = await connectBrowser(config.cdpPort);
  display.complete('브라우저 연결 완료');

  const shouldRun = (category: string) =>
    !config.only || config.only === category;

  const stats = {
    submissions: 0,
    solvedProblems: 0,
    authoredProblems: 0,
    reviewedProblems: 0,
    correctedProblems: 0,
    dataAddedProblems: 0,
    boardPosts: 0,
  };

  try {
    // 1. Profile backup
    if (shouldRun('profile')) {
      display.startPhase('프로필 백업 시작...');
      await scrapeProfile(context, config);
      display.complete('프로필 백업 완료');
    }

    // 2. Authored problems backup
    if (shouldRun('authored')) {
      display.startPhase('출제한 문제 백업 시작...');
      await scrapeAuthored(context, config, rateLimiter, progress);
      display.complete('출제한 문제 백업 완료');
    }

    // 3. Reviewed problems backup
    if (shouldRun('reviewed')) {
      display.startPhase('검수한 문제 백업 시작...');
      await scrapeReviewed(context, config, rateLimiter, progress);
      display.complete('검수한 문제 백업 완료');
    }

    // 4. Submissions backup (list + source code)
    if (shouldRun('submissions')) {
      display.startPhase('제출 기록 백업 시작...');
      const submissions = await scrapeSubmissions(context, config, rateLimiter, progress);
      stats.submissions = submissions.length;

      // Build and save submission index
      const submissionIndex = buildSubmissionIndex(submissions);
      await writeJson(join(config.outputDir, 'submissions', 'index.json'), submissionIndex);
      display.complete(`제출 기록 백업 완료 (${submissions.length}건)`);
    }

    // 5. Solved problems backup
    if (shouldRun('solved')) {
      display.startPhase('맞은 문제 본문 백업 시작...');
      await scrapeSolved(context, config, rateLimiter, progress);
      display.complete('맞은 문제 본문 백업 완료');
    }

    // 6. Corrected contributions backup
    if (shouldRun('corrected')) {
      display.startPhase('오타 수정 기여 문제 백업 시작...');
      stats.correctedProblems = await scrapeCorrected(context, config, rateLimiter, progress);
      display.complete('오타 수정 기여 문제 백업 완료');
    }

    // 7. Data-added contributions backup
    if (shouldRun('dataadded')) {
      display.startPhase('데이터 추가 기여 문제 백업 시작...');
      stats.dataAddedProblems = await scrapeDataAdded(context, config, rateLimiter, progress);
      display.complete('데이터 추가 기여 문제 백업 완료');
    }

    // 8. Board posts backup
    if (shouldRun('board')) {
      display.startPhase('게시판 글 백업 시작...');
      stats.boardPosts = await scrapeBoard(context, config, rateLimiter, progress);
      display.complete('게시판 글 백업 완료');
    }

    // 9. Save final metadata
    const metadata = buildMetadata(config.user, stats);
    metadata.completedAt = new Date().toISOString();
    await writeJson(join(config.outputDir, 'metadata.json'), metadata);

    display.summary(stats);
    log.info('백업이 완료되었습니다');
  } catch (err) {
    // Save progress before exiting on error
    await progress.save();
    log.error(`백업 중 오류 발생: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  } finally {
    await disconnectBrowser(browser);
  }
}
