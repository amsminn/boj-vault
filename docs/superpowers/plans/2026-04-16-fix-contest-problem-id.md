# Fix Contest Submission Problem ID Resolution — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the bug where contest submissions are saved under the contest ID instead of the actual BOJ problem number (Issue #1).

**Architecture:** Two-phase fix — (1) Phase 1 parser correctly distinguishes regular vs contest URLs and marks unresolvable contest submissions with `problemId=0`, (2) Phase 2 extracts the real problem ID from the `/source/{submissionId}` page (already visited, no extra HTTP requests) and patches the submission before saving. A migration utility handles previously mis-saved data.

**Tech Stack:** TypeScript, Playwright (page.evaluate), Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/parsers/submission.ts` | Modify | Fix regex to handle contest URLs; add `parseSourceProblemId` |
| `src/scrapers/submissions.ts` | Modify | Use `parseSourceProblemId` in Phase 2 to resolve contest `problemId` |
| `src/types/index.ts` | Modify | Add optional `contestId` field to `Submission` |
| `tests/parse-submission.test.ts` | Create | Unit tests for `parseSubmissionTable` with contest/regular HTML |
| `tests/parse-source-problem-id.test.ts` | Create | Unit tests for `parseSourceProblemId` |

---

### Task 1: Add `contestId` field to `Submission` type

**Files:**
- Modify: `src/types/index.ts:14-25`

- [ ] **Step 1: Write the type change**

Add optional `contestId` field to `Submission` interface:

```typescript
export interface Submission {
  submissionId: number;
  problemId: number;
  contestId?: number;       // ← NEW: present when submitted during a contest
  problemTitle?: string;
  result: string;
  memory: number;
  time: number;
  language: string;
  codeLength: number;
  submittedAt: string;
  sourceCode?: string;
}
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: no errors (field is optional, no consumers break)

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add optional contestId field to Submission type"
```

---

### Task 2: Fix `parseSubmissionTable` to handle contest URLs

**Files:**
- Modify: `src/parsers/submission.ts:25-29`
- Test: `tests/parse-submission.test.ts` (create)

- [ ] **Step 1: Write the failing test for regular problem URL**

Create `tests/parse-submission.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

// We test the in-browser evaluate logic by extracting it into a helper.
// Since parseSubmissionTable runs page.evaluate with a string,
// we'll test the regex logic directly.

describe('problem ID extraction logic', () => {
  // Mirror the extraction logic from parseSubmissionTable
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/parse-submission.test.ts`
Expected: FAIL — `extractProblemId` function doesn't exist yet (test file defines its own inline copy of the logic, so it should actually PASS with the new logic. The purpose is to lock in the expected behavior before changing production code.)

Actually, this test defines the extraction logic inline. Run it to confirm the new logic is correct:

Run: `npx vitest run tests/parse-submission.test.ts`
Expected: PASS (all 6 tests green — confirms the new regex logic is correct)

- [ ] **Step 3: Apply the fix to `parseSubmissionTable`**

In `src/parsers/submission.ts`, replace lines 25-29 inside the `page.evaluate` string:

**Before:**
```javascript
const problemLink = cells[2].querySelector('a[href*="/problem/"]');
const problemHref = problemLink ? problemLink.getAttribute('href') : '';
const problemMatch = problemHref ? problemHref.match(/\/problem\/(\d+)/) : null;
const problemId = problemMatch ? parseInt(problemMatch[1], 10) : 0;
```

**After:**
```javascript
const problemLink = cells[2].querySelector('a[href*="/problem/"]');
const problemHref = problemLink ? problemLink.getAttribute('href') : '';

// Contest URL: /contest/problem/{contestId}/{localNum}
// Regular URL: /problem/{id}
const contestMatch = problemHref ? problemHref.match(/\/contest\/problem\/(\d+)\/(\d+)/) : null;
const regularMatch = !contestMatch && problemHref ? problemHref.match(/\/problem\/(\d+)/) : null;

const problemId = regularMatch ? parseInt(regularMatch[1], 10) : 0;
const contestId = contestMatch ? parseInt(contestMatch[1], 10) : undefined;
```

Also update the `submissions.push` guard and call to include `contestId`:

**Before (line 47):**
```javascript
if (submissionId && problemId) {
  submissions.push({
    submissionId,
    problemId,
    problemTitle: problemTitle || undefined,
    result,
    ...
  });
}
```

**After:**
```javascript
if (submissionId && (problemId || contestId)) {
  submissions.push({
    submissionId,
    problemId,
    contestId: contestId || undefined,
    problemTitle: problemTitle || undefined,
    result,
    ...
  });
}
```

**Critical:** The original guard `if (submissionId && problemId)` would silently drop contest submissions where `problemId=0`. Changing it to `(problemId || contestId)` ensures contest submissions survive Phase 1 and reach Phase 2 for resolution.

- [ ] **Step 4: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: PASS (existing tests should still pass — they don't use contest URLs)

- [ ] **Step 6: Commit**

```bash
git add src/parsers/submission.ts tests/parse-submission.test.ts
git commit -m "fix: distinguish contest URLs from regular problem URLs in submission parser"
```

---

### Task 3: Add `parseSourceProblemId` to extract real problem ID from source page

**Files:**
- Modify: `src/parsers/submission.ts`
- Test: `tests/parse-source-problem-id.test.ts` (create)

The `/source/{submissionId}` page contains submission details including a link to the actual problem (e.g., `/problem/12345`). Since Phase 2 already navigates here for source code, we can extract the problem ID at zero extra cost.

- [ ] **Step 1: Write the failing test**

Create `tests/parse-source-problem-id.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';

// We can't easily test page.evaluate with a real browser in unit tests,
// so we test the extraction logic directly.
describe('parseSourceProblemId logic', () => {
  // The source page has a table with submission info.
  // One row links to the problem: <a href="/problem/12345">12345 — Title</a>
  // We extract the problem ID from this link.

  function extractProblemIdFromSourcePage(html: string): number {
    const match = html.match(/href="\/problem\/(\d+)"/);
    return match ? parseInt(match[1], 10) : 0;
  }

  it('extracts problem ID from source page link', () => {
    const html = '<a href="/problem/12345">12345 — Some Title</a>';
    expect(extractProblemIdFromSourcePage(html)).toBe(12345);
  });

  it('returns 0 when no problem link found', () => {
    const html = '<div>No links here</div>';
    expect(extractProblemIdFromSourcePage(html)).toBe(0);
  });

  it('handles 5-digit problem numbers', () => {
    const html = '<a href="/problem/31234">31234 — Hard Problem</a>';
    expect(extractProblemIdFromSourcePage(html)).toBe(31234);
  });
});
```

- [ ] **Step 2: Run test to confirm logic**

Run: `npx vitest run tests/parse-source-problem-id.test.ts`
Expected: PASS

- [ ] **Step 3: Implement `parseSourceProblemId` in `src/parsers/submission.ts`**

Add after `parseSourceCode` function:

```typescript
/**
 * Extract the real BOJ problem ID from the /source/{submissionId} page.
 *
 * The source page contains a link to the actual problem (e.g., /problem/12345),
 * which is always the canonical BOJ problem number — even for contest submissions.
 * Returns 0 if the problem ID cannot be determined.
 */
export async function parseSourceProblemId(page: Page): Promise<number> {
  return page.evaluate(`
    (() => {
      const link = document.querySelector('a[href^="/problem/"]');
      if (!link) return 0;
      const href = link.getAttribute('href') || '';
      const match = href.match(/^\\/problem\\/(\\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    })()
  `) as Promise<number>;
}
```

**Key design note:** The selector `a[href^="/problem/"]` uses `^=` (starts-with) instead of `*=` (contains). This prevents matching contest URLs like `/contest/problem/...`. On the source page, the problem link should be a direct `/problem/{id}` link.

- [ ] **Step 4: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/parsers/submission.ts tests/parse-source-problem-id.test.ts
git commit -m "feat: add parseSourceProblemId to extract real problem ID from source page"
```

---

### Task 4: Integrate `parseSourceProblemId` into Phase 2 of `scrapeSubmissions`

**Files:**
- Modify: `src/scrapers/submissions.ts:223-303`

- [ ] **Step 1: Add import for `parseSourceProblemId`**

In `src/scrapers/submissions.ts`, update the import:

**Before:**
```typescript
import {
  parseSubmissionTable,
  parseSourceCode,
  hasNextPage,
} from '../parsers/submission.js';
```

**After:**
```typescript
import {
  parseSubmissionTable,
  parseSourceCode,
  parseSourceProblemId,
  hasNextPage,
} from '../parsers/submission.js';
```

- [ ] **Step 2: Modify Phase 2 to extract and patch problem ID**

In the Phase 2 loop (inside `scrapeSubmissions`, around line 239-251), change the source page handling to also extract the problem ID:

**Before:**
```typescript
const sourceCode = await withPage(context, sourceUrl, async (page) => {
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
```

**After:**
```typescript
const { sourceCode, resolvedProblemId } = await withPage(context, sourceUrl, async (page) => {
  if (page.url().includes('/login')) {
    log.error(
      `로그인이 필요합니다. Chrome에서 BOJ에 로그인되어 있는지 확인하세요.`,
    );
    return { sourceCode: '', resolvedProblemId: 0 };
  }

  const [code, pid] = await Promise.all([
    parseSourceCode(page),
    parseSourceProblemId(page),
  ]);
  return { sourceCode: code, resolvedProblemId: pid };
});

if (sourceCode) {
  submission.sourceCode = sourceCode;
}

// Patch problemId for contest submissions (Phase 1 sets problemId=0)
if (resolvedProblemId > 0 && submission.problemId === 0) {
  log.info(
    `제출 ${submissionId}: 대회 문제 ID 확인 → ${resolvedProblemId}`,
  );
  submission.problemId = resolvedProblemId;
}
```

- [ ] **Step 3: Fix stale destructured `problemId` and add unresolved guard**

**Critical:** The current code at line 225 destructures `const { submissionId, problemId } = submission;` **before** Phase 2 runs. After Phase 2 mutates `submission.problemId`, the local `problemId` constant still holds `0`. The save block at line 277-280 uses this stale value, so files would be written to `submissions/0/`.

**Fix:** Move the `problemId` usage to after resolution, or reference `submission.problemId` directly.

Replace the destructuring at line 225:

**Before:**
```typescript
const { submissionId, problemId } = submission;
```

**After:**
```typescript
const { submissionId } = submission;
```

Then, update the save path (around line 277-280) to handle both resolved and unresolved cases:

**Before:**
```typescript
const submissionDir = join(
  config.outputDir,
  'submissions',
  String(problemId),
);
```

**After:**
```typescript
// Resolved → submissions/{problemId}/, unresolved contest → submissions/contest-{contestId}/
const problemDir = submission.problemId > 0
  ? String(submission.problemId)
  : `contest-${submission.contestId ?? 'unknown'}`;

if (submission.problemId === 0) {
  log.warn(
    `제출 ${submissionId}: 문제 ID를 확인할 수 없습니다 — contest-${submission.contestId}/ 에 저장`,
  );
}

const submissionDir = join(
  config.outputDir,
  'submissions',
  problemDir,
);
```

This ensures contest submissions whose real problem ID cannot be resolved (e.g., ongoing contest, private problems) are still saved under `submissions/contest-{contestId}/` instead of being lost. When the contest ends and problems become public, re-running with `--resume` off will resolve them correctly.

- [ ] **Step 4: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Run all existing tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/scrapers/submissions.ts
git commit -m "fix: resolve real problem ID for contest submissions during Phase 2"
```

---

### Task 5: Update `withPage` mock in resume tests for new return type

**Files:**
- Modify: `tests/submission-resume.test.ts:21-27`

The `withPage` mock in `submission-resume.test.ts` returns `''` for Phase 2 source URLs. Now Phase 2 expects an object `{ sourceCode, resolvedProblemId }`, so update the mock.

- [ ] **Step 1: Update the mock**

**Before:**
```typescript
withPage: async (_ctx: unknown, url: string, _fn: unknown) => {
  calledUrls.push(url);
  if (url.includes('/source/')) return ''; // Phase 2: source code
  return mockPhase1(url); // Phase 1: submission list
},
```

**After:**
```typescript
withPage: async (_ctx: unknown, url: string, fn: unknown) => {
  calledUrls.push(url);
  if (url.includes('/source/')) {
    // Phase 2: the real code calls fn(page), which returns { sourceCode, resolvedProblemId }
    // But since we mock withPage to NOT call fn, we return the expected shape directly.
    return { sourceCode: '', resolvedProblemId: 0 };
  }
  return mockPhase1(url); // Phase 1: submission list
},
```

**Wait** — actually, `withPage` is a wrapper that navigates and calls the callback. The mock replaces `withPage` entirely and does NOT call `fn`. The Phase 2 code does:

```typescript
const { sourceCode, resolvedProblemId } = await withPage(context, sourceUrl, async (page) => {
  // ...
  return { sourceCode: code, resolvedProblemId: pid };
});
```

So the mock needs to return the right shape. But actually, looking at the mock more carefully — it ignores `_fn` and returns directly. For Phase 2, it just returns `''`. Now it needs to return `{ sourceCode: '', resolvedProblemId: 0 }`.

However, since all test submissions have `problemId > 0` (they use `makeMeta` which sets real IDs) and the guard skips when `problemId === 0`, the tests still work even with `resolvedProblemId: 0`. The resolution only triggers when `submission.problemId === 0`.

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/submission-resume.test.ts
git commit -m "test: update withPage mock for new Phase 2 return type"
```

---

### Task 6: Add integration-style test for contest submission flow

**Files:**
- Modify: `tests/submission-resume.test.ts`

- [ ] **Step 1: Add test case for contest submission with problemId=0**

Add to the existing describe block in `tests/submission-resume.test.ts`:

```typescript
it('contest submission: problemId=0 resolved from source page', async () => {
  // Phase 1 returns a contest submission with problemId=0
  mockPhase1 = () => ({
    subs: [{ ...makeMeta(99999, 0), contestId: 963 }],
    morePages: false,
  });

  // Phase 2 mock: source page resolves real problem ID
  // Override the withPage mock to return resolvedProblemId for source URLs
  vi.mocked((await import('../src/core/utils.js')).withPage).mockImplementation(
    async (_ctx: unknown, url: string, _fn: unknown) => {
      calledUrls.push(url);
      if (url.includes('/source/')) {
        return { sourceCode: 'int main() {}', resolvedProblemId: 12345 };
      }
      return mockPhase1(url);
    },
  );

  const progress = new ProgressTracker(join(tempDir, 'progress.json'));
  const result = await scrapeSubmissions(
    {} as BrowserContext,
    makeConfig(tempDir, false),
    noopLimiter as any,
    progress,
  );

  // Verify the problemId was resolved from 0 → 12345
  expect(result[0].problemId).toBe(12345);
});
```

**Note:** The exact mock setup may need adjustment depending on how `withPage` is mocked in the test file. The key assertion is that `problemId` goes from `0` → `12345`.

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/submission-resume.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/submission-resume.test.ts
git commit -m "test: add integration test for contest submission problem ID resolution"
```

---

### Task 7 (Optional): Data migration for previously mis-saved submissions

**Files:**
- Create: `src/cli/migrate.ts` (new CLI command)

This task is **optional** — it helps users who already ran the tool and have incorrect data. The migration script would:

1. Scan `submissions/` directories
2. Read each `{submissionId}.json` metadata file
3. If `contestId` is present or `problemId` looks suspicious, re-fetch the source page to get the real problem ID
4. Move files from `submissions/{wrongId}/` to `submissions/{correctId}/`

This can be implemented as a follow-up issue since it requires network access and is a one-time operation.

- [ ] **Step 1: Create GitHub issue for migration follow-up**

```bash
gh issue create --title "Migration tool for contest submissions saved under wrong problem ID" \
  --body "Follow-up to #1. Users who ran boj-vault before the fix may have submissions saved under contest IDs instead of problem numbers. A migration CLI command should re-resolve these."
```

---

## Summary of Changes

| Task | What | Risk |
|------|------|------|
| 1 | Add `contestId` to `Submission` type | None — optional field |
| 2 | Fix regex + guard in `parseSubmissionTable` | Low — contest subs get `problemId=0` + `contestId`; guard widened to keep them |
| 3 | Add `parseSourceProblemId` function | None — new function, no existing code affected |
| 4 | Integrate resolution into Phase 2 + fix stale destructuring | Medium — changes Phase 2 return type, fixes `problemId` variable scope |
| 5 | Fix test mocks | Low — mechanical update |
| 6 | Integration test | None — new test |
| 7 | Migration (optional) | Deferred to follow-up issue |

## Review Notes

Two critical issues were caught during plan review and fixed:
1. **Guard filter**: `if (submissionId && problemId)` would silently drop contest submissions before Phase 2 → changed to `(problemId || contestId)`
2. **Stale destructuring**: `const { problemId } = submission` at line 225 captured the pre-resolution value → changed to use `submission.problemId` after resolution
