import { join } from 'node:path';
import type { BrowserContext } from 'playwright';
import type { BackupConfig, BoardIndex, BoardPost } from '../types/index.js';
import { RateLimiter } from '../core/rate-limiter.js';
import { ProgressTracker } from '../core/progress.js';
import { createLogger, withPage, ensureDir } from '../core/utils.js';
import { paginateBoardList } from '../parsers/board-paginate.js';
import { parseBoardPost } from '../parsers/board-post.js';
import { writeJson, writeHtml } from '../writers/json-writer.js';

export async function scrapeBoard(
  context: BrowserContext,
  config: BackupConfig,
  rateLimiter: RateLimiter,
  progress: ProgressTracker,
): Promise<number> {
  const log = createLogger('board');

  // 1. Collect every page of the user's board posts
  const searchUrl = `https://www.acmicpc.net/board/search/all/author/${config.user}`;
  const cachePath = join(config.outputDir, 'board-cache.json');
  log.info(`게시판 목록 수집 시작: ${searchUrl}`);
  const rows = await paginateBoardList(
    context,
    searchUrl,
    config.user,
    rateLimiter,
    log,
    { cachePath, resume: config.resume },
  );
  log.info(`게시글 ${rows.length}개 발견`);

  const limited = config.limit ? rows.slice(0, config.limit) : rows;

  const indexEntries: BoardIndex['posts'] = [];
  const byCategory: Record<string, number> = {};

  // 2. Process each post
  for (const row of limited) {
    if (progress.isCompleted('board', row.postId)) {
      log.info(`건너뜀 (이미 완료): #${row.postId} ${row.title}`);
      // Re-use the previous run's post.json so writtenAt/commentCount aren't
      // zeroed out on resume. Fall back to list-row data if the file is gone
      // (e.g. user deleted output/ between runs).
      const priorPath = join(config.outputDir, 'board', row.categorySlug, String(row.postId), 'post.json');
      let prior: BoardPost | null = null;
      try {
        const raw = await import('node:fs/promises').then((m) => m.readFile(priorPath, 'utf-8'));
        prior = JSON.parse(raw) as BoardPost;
      } catch {
        prior = null;
      }
      indexEntries.push({
        postId: row.postId,
        title: prior?.title ?? row.title,
        categorySlug: row.categorySlug,
        categoryName: row.categoryName,
        problemId: row.problemId,
        author: prior?.author ?? row.author,
        writtenAt: prior?.writtenAt ?? '',
        commentCount: prior?.commentCount ?? 0,
        path: `board/${row.categorySlug}/${row.postId}/`,
      });
      byCategory[row.categorySlug] = (byCategory[row.categorySlug] ?? 0) + 1;
      continue;
    }

    try {
      log.info(`처리 중: #${row.postId} [${row.categorySlug}] ${row.title}`);

      await rateLimiter.wait();
      const postDir = join(config.outputDir, 'board', row.categorySlug, String(row.postId));
      await ensureDir(postDir);

      const { meta, html } = await withPage(
        context,
        `https://www.acmicpc.net/board/view/${row.postId}`,
        async (page) => {
          const meta = await parseBoardPost(page);
          const html = await page.content();
          return { meta, html };
        },
      );

      const post: BoardPost = {
        postId: row.postId,
        title: meta.title || row.title,
        categoryId: row.categoryId,
        categorySlug: row.categorySlug,
        categoryName: row.categoryName,
        problemId: row.problemId,
        author: meta.author || row.author,
        writtenAt: meta.writtenAt,
        commentCount: meta.commentCount,
        fetchedAt: new Date().toISOString(),
      };

      await writeJson(join(postDir, 'post.json'), post);
      await writeHtml(join(postDir, 'post.html'), html);

      indexEntries.push({
        postId: post.postId,
        title: post.title,
        categorySlug: post.categorySlug,
        categoryName: post.categoryName,
        problemId: post.problemId,
        author: post.author,
        writtenAt: post.writtenAt,
        commentCount: post.commentCount,
        path: `board/${post.categorySlug}/${post.postId}/`,
      });
      byCategory[post.categorySlug] = (byCategory[post.categorySlug] ?? 0) + 1;

      progress.markCompleted('board', post.postId);
      await progress.save();
      log.info(`완료: #${post.postId}`);
    } catch (err) {
      log.error(
        `게시글 처리 실패 (#${row.postId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 3. Save the index
  const index: BoardIndex = {
    totalCount: indexEntries.length,
    byCategory,
    posts: indexEntries,
    lastUpdated: new Date().toISOString(),
  };
  await writeJson(join(config.outputDir, 'board', 'index.json'), index);
  log.info(`게시판 인덱스 저장: ${join(config.outputDir, 'board', 'index.json')}`);

  return rows.length;
}
