import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { BrowserContext } from 'playwright';
import type { Submission } from '../src/types/index.js';

// ---------------------------------------------------------------
// withPage mock — URL 캡처 + Phase 1/2 분기
// ---------------------------------------------------------------
const calledUrls: string[] = [];
let mockPhase1: (url: string) => unknown = () => ({
  subs: [],
  morePages: false,
});

vi.mock('../src/core/utils.js', async () => {
  const actual = await vi.importActual('../src/core/utils.js');
  return {
    ...(actual as object),
    withPage: async (_ctx: unknown, url: string, _fn: unknown) => {
      calledUrls.push(url);
      if (url.includes('/source/')) return ''; // Phase 2: source code
      return mockPhase1(url); // Phase 1: submission list
    },
  };
});

import { scrapeSubmissions, saveCache } from '../src/scrapers/submissions.js';
import { ProgressTracker } from '../src/core/progress.js';
import type { BackupConfig } from '../src/types/index.js';

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
function makeMeta(id: number, problemId: number): Omit<Submission, 'sourceCode'> {
  return {
    submissionId: id,
    problemId,
    result: '맞았습니다!!',
    memory: 1024,
    time: 10,
    language: 'C++17',
    codeLength: 100,
    submittedAt: '2024-01-01',
  };
}

function makeConfig(dir: string, resume: boolean): BackupConfig {
  return {
    user: 'testuser',
    cdpPort: 9222,
    outputDir: dir,
    delay: 0,
    resume,
  };
}

const noopLimiter = {
  wait: () => Promise.resolve(),
  waitPagination: () => Promise.resolve(),
  backoff: () => Promise.resolve(),
};

function statusUrls() {
  return calledUrls.filter((u) => u.includes('/status'));
}

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------
describe('scrapeSubmissions — resume 점프 동작', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'boj-resume-'));
    calledUrls.length = 0;
    mockPhase1 = () => ({ subs: [], morePages: false });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('resume=false: &top 없이 page 1 시작', async () => {
    const progress = new ProgressTracker(join(tempDir, 'progress.json'));

    await scrapeSubmissions(
      {} as BrowserContext,
      makeConfig(tempDir, false),
      noopLimiter as any,
      progress,
    );

    expect(statusUrls()).toEqual([
      'https://www.acmicpc.net/status?user_id=testuser',
    ]);
  });

  it('resume + incomplete 캐시: page 1 건너뛰고 &top=lastId-1로 점프', async () => {
    await saveCache(tempDir, {
      lastSubmissionId: 50000,
      pageNum: 5,
      complete: false,
      submissions: [],
    });
    const progress = new ProgressTracker(join(tempDir, 'progress.json'));

    await scrapeSubmissions(
      {} as BrowserContext,
      makeConfig(tempDir, true),
      noopLimiter as any,
      progress,
    );

    expect(statusUrls()).toEqual([
      'https://www.acmicpc.net/status?user_id=testuser&top=49999',
    ]);
  });

  it('resume + complete 캐시: Phase 1 요청 0건', async () => {
    await saveCache(tempDir, {
      lastSubmissionId: 50000,
      pageNum: 5,
      complete: true,
      submissions: [],
    });
    const progress = new ProgressTracker(join(tempDir, 'progress.json'));

    await scrapeSubmissions(
      {} as BrowserContext,
      makeConfig(tempDir, true),
      noopLimiter as any,
      progress,
    );

    expect(statusUrls()).toHaveLength(0);
  });

  it('resume + 캐시 없음 + 기존 파일: migration 후 min(id)-1로 점프', async () => {
    const dir = join(tempDir, 'submissions', '1000');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '50000.json'), JSON.stringify(makeMeta(50000, 1000)));
    await writeFile(join(dir, '40000.json'), JSON.stringify(makeMeta(40000, 1000)));

    const progress = new ProgressTracker(join(tempDir, 'progress.json'));

    await scrapeSubmissions(
      {} as BrowserContext,
      makeConfig(tempDir, true),
      noopLimiter as any,
      progress,
    );

    // min(50000, 40000) = 40000 → &top=39999로 점프
    expect(statusUrls()).toEqual([
      'https://www.acmicpc.net/status?user_id=testuser&top=39999',
    ]);
  });

  it('resume 후 여러 페이지 수집: URL이 순차적으로 점프', async () => {
    await saveCache(tempDir, {
      lastSubmissionId: 30000,
      pageNum: 3,
      complete: false,
      submissions: [],
    });

    let call = 0;
    mockPhase1 = () => {
      call++;
      if (call === 1) {
        return {
          subs: [makeMeta(29999, 1000), makeMeta(29998, 1000)],
          morePages: true,
        };
      }
      return { subs: [], morePages: false };
    };

    const progress = new ProgressTracker(join(tempDir, 'progress.json'));
    // Phase 2 스킵하도록 미리 완료 처리
    progress.markCompleted('submissions', 29999);
    progress.markCompleted('submissions', 29998);

    await scrapeSubmissions(
      {} as BrowserContext,
      makeConfig(tempDir, true),
      noopLimiter as any,
      progress,
    );

    expect(statusUrls()).toEqual([
      // page 4: &top=29999 (30000-1)
      'https://www.acmicpc.net/status?user_id=testuser&top=29999',
      // page 5: &top=29997 (29998-1), page 4 마지막 제출 기준
      'https://www.acmicpc.net/status?user_id=testuser&top=29997',
    ]);
  });
});
