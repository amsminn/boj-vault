import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadCache,
  saveCache,
  migrateFromDisk,
  type SubmissionListCache,
} from '../src/scrapers/submissions.js';

const mockLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeMeta(id: number, problemId: number) {
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

describe('loadCache', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'boj-vault-test-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('파일 없으면 null 반환', async () => {
    expect(await loadCache(tempDir)).toBeNull();
  });

  it('기존 캐시 파일 로드', async () => {
    const cache: SubmissionListCache = {
      lastSubmissionId: 50000,
      pageNum: 3,
      complete: true,
      submissions: [makeMeta(50000, 1000), makeMeta(40000, 2000)],
    };
    await writeFile(
      join(tempDir, 'submissions-cache.json'),
      JSON.stringify(cache),
    );

    const loaded = await loadCache(tempDir);
    expect(loaded).toEqual(cache);
  });
});

describe('saveCache + loadCache round-trip', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'boj-vault-test-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('저장 후 로드하면 동일한 데이터', async () => {
    const cache: SubmissionListCache = {
      lastSubmissionId: 30000,
      pageNum: 7,
      complete: false,
      submissions: [
        makeMeta(90000, 1000),
        makeMeta(80000, 2000),
        makeMeta(30000, 3000),
      ],
    };

    await saveCache(tempDir, cache);
    const loaded = await loadCache(tempDir);
    expect(loaded).toEqual(cache);
  });

  it('빈 submissions도 정상 저장/로드', async () => {
    const cache: SubmissionListCache = {
      pageNum: 0,
      complete: false,
      submissions: [],
    };

    await saveCache(tempDir, cache);
    const loaded = await loadCache(tempDir);
    expect(loaded).toEqual(cache);
  });
});

describe('migrateFromDisk', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'boj-vault-test-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('submissions 디렉토리 없으면 null', async () => {
    expect(await migrateFromDisk(tempDir, mockLog)).toBeNull();
  });

  it('submissions 디렉토리가 비어있으면 null', async () => {
    await mkdir(join(tempDir, 'submissions'));
    expect(await migrateFromDisk(tempDir, mockLog)).toBeNull();
  });

  it('기존 JSON 파일에서 캐시 재구축', async () => {
    const dir1 = join(tempDir, 'submissions', '1000');
    const dir2 = join(tempDir, 'submissions', '2000');
    await mkdir(dir1, { recursive: true });
    await mkdir(dir2, { recursive: true });

    await writeFile(join(dir1, '50000.json'), JSON.stringify(makeMeta(50000, 1000)));
    await writeFile(join(dir2, '30000.json'), JSON.stringify(makeMeta(30000, 2000)));
    // 소스코드 파일은 무시해야 함
    await writeFile(join(dir1, '50000.cpp'), 'int main() {}');

    const result = await migrateFromDisk(tempDir, mockLog);

    expect(result).not.toBeNull();
    expect(result!.submissions).toHaveLength(2);
    // newest first 정렬
    expect(result!.submissions[0].submissionId).toBe(50000);
    expect(result!.submissions[1].submissionId).toBe(30000);
    // lastSubmissionId = min (페이지네이션 도달 지점)
    expect(result!.lastSubmissionId).toBe(30000);
    expect(result!.complete).toBe(false);
    expect(result!.pageNum).toBe(1); // ceil(2/20)
  });

  it('index.json은 무시', async () => {
    const subDir = join(tempDir, 'submissions');
    const problemDir = join(subDir, '1000');
    await mkdir(problemDir, { recursive: true });

    await writeFile(
      join(subDir, 'index.json'),
      JSON.stringify({ totalCount: 1, problems: [] }),
    );
    await writeFile(
      join(problemDir, '12345.json'),
      JSON.stringify(makeMeta(12345, 1000)),
    );

    const result = await migrateFromDisk(tempDir, mockLog);
    expect(result!.submissions).toHaveLength(1);
    expect(result!.submissions[0].submissionId).toBe(12345);
  });

  it('깨진 JSON 파일은 건너뜀', async () => {
    const problemDir = join(tempDir, 'submissions', '1000');
    await mkdir(problemDir, { recursive: true });

    await writeFile(join(problemDir, 'bad.json'), 'not json{{{');
    await writeFile(
      join(problemDir, '12345.json'),
      JSON.stringify(makeMeta(12345, 1000)),
    );

    const result = await migrateFromDisk(tempDir, mockLog);
    expect(result!.submissions).toHaveLength(1);
    expect(result!.submissions[0].submissionId).toBe(12345);
  });

  it('submissionId 없는 JSON은 건너뜀', async () => {
    const problemDir = join(tempDir, 'submissions', '1000');
    await mkdir(problemDir, { recursive: true });

    await writeFile(
      join(problemDir, 'weird.json'),
      JSON.stringify({ foo: 'bar' }),
    );
    await writeFile(
      join(problemDir, '12345.json'),
      JSON.stringify(makeMeta(12345, 1000)),
    );

    const result = await migrateFromDisk(tempDir, mockLog);
    expect(result!.submissions).toHaveLength(1);
  });

  it('제출 수가 많으면 pageNum 정확히 계산', async () => {
    const problemDir = join(tempDir, 'submissions', '1000');
    await mkdir(problemDir, { recursive: true });

    // 45건 생성 → ceil(45/20) = 3 페이지
    for (let i = 0; i < 45; i++) {
      const id = 10000 + i;
      await writeFile(
        join(problemDir, `${id}.json`),
        JSON.stringify(makeMeta(id, 1000)),
      );
    }

    const result = await migrateFromDisk(tempDir, mockLog);
    expect(result!.submissions).toHaveLength(45);
    expect(result!.pageNum).toBe(3);
    expect(result!.lastSubmissionId).toBe(10000); // min
    expect(result!.submissions[0].submissionId).toBe(10044); // max (newest first)
  });
});

describe('pageNum — 스크래퍼 루프 정합성', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'boj-vault-test-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * scrapeSubmissions의 pageNum 규칙:
   *   let pageNum = cache?.pageNum ?? 0;
   *   while (true) { pageNum++; ... }
   *
   * 즉 pageNum은 "마지막으로 완료한 페이지 번호"이고,
   * 루프 진입 시 +1 해서 다음 페이지부터 시작한다.
   */

  it('fresh start: page 0에서 시작 → 첫 페이지는 1, URL에 &top 없음', () => {
    let pageNum = 0; // scraper 초기값
    const lastSubmissionId: number | undefined = undefined;

    pageNum++;
    let url = `https://www.acmicpc.net/status?user_id=test`;
    if (lastSubmissionId !== undefined) {
      url += `&top=${lastSubmissionId - 1}`;
    }

    expect(pageNum).toBe(1);
    expect(url).not.toContain('&top');
  });

  it('캐시 resume: pageNum 이어서 증가, URL에 &top 포함', async () => {
    // scraper가 page 1,2를 수집 후 저장한 캐시
    const cache: SubmissionListCache = {
      lastSubmissionId: 49960,
      pageNum: 2,
      complete: false,
      submissions: [],
    };
    await saveCache(tempDir, cache);

    const loaded = await loadCache(tempDir);
    let pageNum = loaded!.pageNum;
    const lastSubmissionId = loaded!.lastSubmissionId!;

    pageNum++;
    const url =
      `https://www.acmicpc.net/status?user_id=test&top=${lastSubmissionId - 1}`;

    expect(pageNum).toBe(3);
    expect(url).toContain('&top=49959');
  });

  it('migration 후 resume: 45건(3페이지) → page 4부터', async () => {
    const problemDir = join(tempDir, 'submissions', '1000');
    await mkdir(problemDir, { recursive: true });

    for (let i = 0; i < 45; i++) {
      const id = 50000 - i; // 50000 ~ 49956
      await writeFile(
        join(problemDir, `${id}.json`),
        JSON.stringify(makeMeta(id, 1000)),
      );
    }

    const cache = await migrateFromDisk(tempDir, mockLog);
    let pageNum = cache!.pageNum;
    const lastSubmissionId = cache!.lastSubmissionId!;

    pageNum++;

    expect(pageNum).toBe(4); // ceil(45/20)=3 → 다음은 4
    expect(lastSubmissionId).toBe(49956); // min
    expect(`&top=${lastSubmissionId - 1}`).toBe('&top=49955');
  });

  it('정확히 20건(1페이지 경계) → page 2부터', async () => {
    const problemDir = join(tempDir, 'submissions', '1000');
    await mkdir(problemDir, { recursive: true });

    for (let i = 0; i < 20; i++) {
      await writeFile(
        join(problemDir, `${10000 + i}.json`),
        JSON.stringify(makeMeta(10000 + i, 1000)),
      );
    }

    const result = await migrateFromDisk(tempDir, mockLog);
    expect(result!.pageNum).toBe(1); // ceil(20/20) = 1

    let pageNum = result!.pageNum;
    pageNum++;
    expect(pageNum).toBe(2);
  });

  it('21건(경계+1) → ceil(21/20)=2 → page 3부터', async () => {
    const problemDir = join(tempDir, 'submissions', '1000');
    await mkdir(problemDir, { recursive: true });

    for (let i = 0; i < 21; i++) {
      await writeFile(
        join(problemDir, `${10000 + i}.json`),
        JSON.stringify(makeMeta(10000 + i, 1000)),
      );
    }

    const result = await migrateFromDisk(tempDir, mockLog);
    expect(result!.pageNum).toBe(2);

    let pageNum = result!.pageNum;
    pageNum++;
    expect(pageNum).toBe(3);
  });
});

describe('resume 시나리오 통합', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'boj-vault-test-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('캐시 없이 기존 파일 → 마이그레이션 → 캐시 생성 → 재로드', async () => {
    // Step 1: 기존 파일만 존재 (캐시 없음)
    const problemDir = join(tempDir, 'submissions', '1000');
    await mkdir(problemDir, { recursive: true });
    await writeFile(
      join(problemDir, '50000.json'),
      JSON.stringify(makeMeta(50000, 1000)),
    );
    await writeFile(
      join(problemDir, '40000.json'),
      JSON.stringify(makeMeta(40000, 1000)),
    );

    // Step 2: 캐시 로드 시도 → null
    expect(await loadCache(tempDir)).toBeNull();

    // Step 3: 마이그레이션
    const migrated = await migrateFromDisk(tempDir, mockLog);
    expect(migrated).not.toBeNull();
    expect(migrated!.submissions).toHaveLength(2);
    expect(migrated!.complete).toBe(false);
    expect(migrated!.lastSubmissionId).toBe(40000);

    // Step 4: 캐시 저장
    await saveCache(tempDir, migrated!);

    // Step 5: 다시 로드 → 정상
    const reloaded = await loadCache(tempDir);
    expect(reloaded).toEqual(migrated);
  });

  it('incremental 저장: 페이지 추가 시 캐시 업데이트', async () => {
    // 초기 캐시 (2건, incomplete)
    const initial: SubmissionListCache = {
      lastSubmissionId: 40000,
      pageNum: 1,
      complete: false,
      submissions: [makeMeta(50000, 1000), makeMeta(40000, 1000)],
    };
    await saveCache(tempDir, initial);

    // 새 페이지 수집 시뮬레이션 — 기존 캐시에 추가
    const loaded = await loadCache(tempDir);
    const newSubs = [makeMeta(30000, 2000), makeMeta(20000, 2000)];
    const updated: SubmissionListCache = {
      lastSubmissionId: 20000,
      pageNum: 2,
      complete: false,
      submissions: [...loaded!.submissions, ...newSubs],
    };
    await saveCache(tempDir, updated);

    // 검증
    const reloaded = await loadCache(tempDir);
    expect(reloaded!.submissions).toHaveLength(4);
    expect(reloaded!.pageNum).toBe(2);
    expect(reloaded!.lastSubmissionId).toBe(20000);
    expect(reloaded!.complete).toBe(false);

    // 완료 마킹
    const completed: SubmissionListCache = { ...reloaded!, complete: true };
    await saveCache(tempDir, completed);

    const final = await loadCache(tempDir);
    expect(final!.complete).toBe(true);
    expect(final!.submissions).toHaveLength(4);
  });
});
