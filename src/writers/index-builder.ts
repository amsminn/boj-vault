import type { Submission, SubmissionIndex, ProblemIndex, BackupMetadata } from '../types/index.js';

/**
 * Aggregate submissions into an index grouped by problem.
 */
export function buildSubmissionIndex(submissions: Submission[]): SubmissionIndex {
  const problemMap = new Map<number, number>();

  for (const sub of submissions) {
    const count = problemMap.get(sub.problemId) ?? 0;
    problemMap.set(sub.problemId, count + 1);
  }

  const problems = Array.from(problemMap.entries())
    .map(([problemId, submissionCount]) => ({ problemId, submissionCount }))
    .sort((a, b) => a.problemId - b.problemId);

  return {
    totalCount: submissions.length,
    problems,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Build a problem index from a list of problems.
 */
export function buildProblemIndex(
  problems: { problemId: number; title: string }[],
): ProblemIndex {
  const sorted = [...problems].sort((a, b) => a.problemId - b.problemId);

  return {
    totalCount: sorted.length,
    problems: sorted.map(({ problemId, title }) => ({ problemId, title })),
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Create backup metadata with current timestamp and package version.
 */
export function buildMetadata(
  handle: string,
  stats: BackupMetadata['stats'],
): BackupMetadata {
  return {
    handle,
    startedAt: new Date().toISOString(),
    version: '0.1.0',
    stats,
  };
}
