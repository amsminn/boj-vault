import { describe, it, expect } from 'vitest';

// parseSubmissionTable runs inside page.evaluate as a string,
// so we test the extraction logic directly to verify correctness.

describe('problem ID extraction logic', () => {
  function extractProblemId(href: string) {
    // Contest URL: /contest/problem/{contestId}/{localNum}
    const contestMatch = href.match(/\/contest\/problem\/(\d+)\/(\d+)/);
    if (contestMatch) {
      return { problemId: 0, contestId: parseInt(contestMatch[1], 10) };
    }
    // Regular URL: /problem/{id}
    const regularMatch = href.match(/\/problem\/(\d+)/);
    if (regularMatch) {
      return { problemId: parseInt(regularMatch[1], 10), contestId: undefined };
    }
    return { problemId: 0, contestId: undefined };
  }

  it('regular problem URL → correct problemId', () => {
    const result = extractProblemId('/problem/1000');
    expect(result.problemId).toBe(1000);
    expect(result.contestId).toBeUndefined();
  });

  it('contest problem URL → problemId=0, contestId captured', () => {
    const result = extractProblemId('/contest/problem/963/1');
    expect(result.problemId).toBe(0);
    expect(result.contestId).toBe(963);
  });

  it('contest URL should NOT extract contestId as problemId', () => {
    const result = extractProblemId('/contest/problem/963/1');
    expect(result.problemId).not.toBe(963);
  });

  it('empty href → problemId=0', () => {
    const result = extractProblemId('');
    expect(result.problemId).toBe(0);
  });

  it('5-digit problem number', () => {
    const result = extractProblemId('/problem/31234');
    expect(result.problemId).toBe(31234);
  });

  it('contest with multi-digit local number', () => {
    const result = extractProblemId('/contest/problem/1200/15');
    expect(result.problemId).toBe(0);
    expect(result.contestId).toBe(1200);
  });
});
