# Contributions & Board Backup — Design

**Status:** Draft
**Date:** 2026-04-19
**Scope:** Add three new backup categories to `boj-vault`: 오타 수정 기여(`corrected`), 데이터 추가 기여(`dataadded`), and BOJ 게시판 본인 게시글(`board`).

## Background

현재 `boj-vault`는 제출, 출제(`authored`), 검수(`reviewed`), 맞은 문제(`solved`), 프로필을 백업한다. BOJ 프로필에는 추가로 두 가지 기여 기록이 있다:

1. **오타 수정** — `/problem/author/{user}/3` (실제 페이지네이션은 `/problemset?author={user}&author_type=3`)
2. **데이터 추가** — `/problem/author/{user}/6` (`author_type=6`)

또한 이런 기여는 대부분 BOJ 게시판 "오타/오역/요청" 카테고리에 게시글로 먼저 올려졌고, 이 **게시글 자체**도 서버 종료 시 소멸된다. 기여 문제 본문만으로는 어떤 수정/추가를 요청했는지 맥락이 남지 않으므로, 게시글 본문(+댓글)까지 같이 백업해야 한다.

## Goals

- 오타 수정/데이터 추가로 기여한 문제들의 본문을 `reviewed`와 동일한 형식으로 보존한다.
- BOJ 게시판에 본인이 쓴 모든 글(본문 + 댓글)을 카테고리별로 분류해 보존한다.
- 기존 `authored`/`reviewed` 스크래퍼와 동일한 품질 표준을 따른다: 전체 페이지 순회, 중간 캐시, `--resume` 지원, 실패 시 재개 가능.

## Non-goals

- **교차 참조(cross-link) 생성 안 함.** 게시판 글과 기여 문제는 각자의 디렉토리에 독립적으로 저장되고, 관계 정보는 게시글 메타(`post.json`의 `problemId` 필드)와 행 텍스트(`post.html`)로만 남긴다. 별도 링크 파일을 만들어 디렉토리 간 참조 그래프를 세우는 작업은 포함하지 않는다.
- **댓글을 별도 JSON으로 파싱하지 않음.** `/board/view/{id}` 페이지 HTML을 통째로 저장하면 댓글 HTML이 자동 포함되므로 별도 파싱은 YAGNI.
- **공통 스크래퍼로 기존 `authored`/`reviewed`를 리팩터하지 않음.** `corrected`/`dataadded`는 `reviewed.ts` 복제로 시작하고, 공통화는 최소 공통 함수(helper) 수준까지만.

## Data sources

### Contribution problem lists

| 카테고리 | 프로필 URL (1페이지만 반환) | 실제 페이지네이션 URL |
|---|---|---|
| `corrected` | `/problem/author/{user}/3` | `/problemset?sort=no_asc&author={user}&author_type=3` |
| `dataadded` | `/problem/author/{user}/6` | `/problemset?sort=no_asc&author={user}&author_type=6` |

기존 `authored.ts`(author_type=1)와 `reviewed.ts`(author_type=19)가 완전히 같은 구조를 쓰며, `src/parsers/paginate.ts`의 `paginateProblemList`가 페이지네이션·캐시·resume을 전부 처리한다.

### Board posts

| URL | 설명 |
|---|---|
| `/board/search/all/author/{user}` | 본인이 쓴 전체 게시글 (카테고리 무관) |
| `/board/search/all/author/{user}/{last_id}` | 커서 기반 다음 페이지 (관찰된 패턴; 실제 `a:has-text("다음 페이지")` href를 따라감) |
| `/board/view/{post_id}` | 개별 게시글 — 본문 + 댓글 인라인 렌더링 |

검색 결과 상단 3개 행은 사이트 고정 공지(`author !== config.user`)이므로 `author` 필드로 필터링해서 제외한다. 본인 글 행의 `category` 칸에는 `"1376번 오타/오역/요청"`처럼 연결된 문제 번호가 함께 렌더링되므로, 이를 파싱해 `post.json`의 `problemId` 필드로 저장한다.

## Output layout

기존 `output/` 구조에 세 개 디렉토리를 추가한다:

```
output/
├── (기존: metadata.json, profile/, authored/, reviewed/, solved/, submissions/)
│
├── corrected/                         # 오타 수정 기여 (author_type=3)
│   ├── index.json                     # { totalCount, problems: [{problemId, title}], lastUpdated }
│   └── {problem_id}/
│       ├── problem.json               # Problem (reviewed와 동일 스키마)
│       ├── problem.html
│       └── problem.png                # full-page 스크린샷
│
├── dataadded/                         # 데이터 추가 기여 (author_type=6)
│   ├── index.json
│   └── {problem_id}/
│       ├── problem.json
│       ├── problem.html
│       └── problem.png
│
└── board/
    ├── index.json                     # { totalCount, byCategory: {slug: count}, posts: [...] }
    ├── typo/                          # 오타/오역/요청 — /board/list/6
    │   └── {post_id}/
    │       ├── post.json              # BoardPost
    │       └── post.html              # full page HTML (본문 + 댓글 포함)
    ├── question/                      # 질문 — /board/list/3
    │   └── {post_id}/ ...
    ├── free/                          # 자유 — /board/list/2
    ├── ad/                            # 홍보 — /board/list/9
    ├── notice/                        # 공지 (본인 글인 경우만) — /board/list/1
    ├── update/                        # 업데이트
    ├── solvedac/                      # solved.ac
    └── boardnotice/                   # 게시판 공지
```

**카테고리 slug 규칙:** BOJ URL slug 그대로 사용(`typo`, `question`, `free`, `ad`, `notice`, `update`, `solvedac`, `boardnotice`). 본인이 글을 쓰지 않은 카테고리 디렉토리는 생성하지 않는다. 행의 `category` 셀 텍스트에서 slug를 역추적하는 건 취약하므로, 행에 포함된 `/board/list/{N}` 링크의 숫자 ID로 slug를 결정한다(카테고리 ID→slug 테이블 내장).

**`board/index.json` 스키마:**
```json
{
  "totalCount": 11,
  "byCategory": { "typo": 9, "question": 1, "free": 1 },
  "posts": [
    {
      "postId": 161839,
      "title": "데이터를 추가해주세요",
      "categorySlug": "typo",
      "categoryName": "오타/오역/요청",
      "problemId": 1376,
      "author": "amsminn",
      "writtenAt": "2025-08-... (ISO date)",
      "commentCount": 1,
      "path": "board/typo/161839/"
    }
  ],
  "lastUpdated": "2026-04-19T..."
}
```

## Modules

### New files

| File | Purpose |
|---|---|
| `src/scrapers/corrected.ts` | `reviewed.ts` 패턴 복제, `author_type=3` + `corrected-cache.json` |
| `src/scrapers/dataadded.ts` | 동일, `author_type=6` + `dataadded-cache.json` |
| `src/scrapers/board.ts` | 게시판 전용 스크래퍼 |
| `src/parsers/board-list.ts` | `/board/search/all/author/{user}` 목록 파싱 + 전체 페이지 순회 + 캐시/resume |
| `src/parsers/board-post.ts` | `/board/view/{id}` 메타 파싱 (`BoardPost`) |
| `src/parsers/board-categories.ts` | 카테고리 ID↔slug 매핑 상수 (`1→notice`, `2→free`, …) |

### Modified files

| File | Change |
|---|---|
| `src/types/index.ts` | `BoardPost`, `BoardIndex`, `ContributionProblem`(= alias of `Problem`) 타입 추가; `BackupMetadata.stats`에 `correctedProblems`, `dataAddedProblems`, `boardPosts` 카운터 추가; `BackupConfig.only` 유니온에 `'corrected' \| 'dataadded' \| 'board'` 추가 |
| `src/index.ts` | `runBackup`에 3개 phase 추가 (`shouldRun('corrected')`, `shouldRun('dataadded')`, `shouldRun('board')`); `stats` 객체에 카운터 추가 |
| `src/cli/index.ts` 혹은 `src/cli/config.ts` | `--only` choices에 3개 값 추가 |
| `src/core/progress.ts` | 카테고리 유니온에 `'corrected' \| 'dataadded' \| 'board'` 추가 |
| `src/writers/index-builder.ts` | 필요 시 `buildMetadata`에 새 카운터 반영 |
| `README.md` | 사용법/백업 대상/출력 구조/Changelog 업데이트 |

### Type additions (shape)

```typescript
// src/types/index.ts 에 추가
export interface BoardPost {
  postId: number;
  title: string;
  categorySlug: string;    // 'typo' | 'question' | ...
  categoryName: string;    // '오타/오역/요청' 등 표시용 원문
  categoryId: number;      // /board/list/{N} 의 N
  problemId?: number;      // 카테고리 셀에 문제 번호가 포함된 경우만
  author: string;
  writtenAt: string;       // ISO
  commentCount: number;
  fetchedAt: string;
}

export interface BoardIndex {
  totalCount: number;
  byCategory: Record<string, number>;
  posts: (Pick<BoardPost, 'postId' | 'title' | 'categorySlug' | 'categoryName' | 'problemId' | 'author' | 'writtenAt' | 'commentCount'> & { path: string })[];
  lastUpdated: string;
}
```

### Board pagination cache shape

`board` 스크래퍼는 page-number 기반이 아닌 cursor 기반이므로 `paginateProblemList`를 그대로 재사용하지 않고 별도 캐시 스키마를 쓴다:

```json
// board-cache.json
{
  "complete": false,
  "nextCursor": "/board/search/all/author/amsminn/79000",
  "posts": [ /* BoardPost 최소 필드 (postId, title, categorySlug, categoryId, problemId?, author, writtenAt, commentCount) */ ]
}
```

정상 완주 시 `complete: true`, `nextCursor: null`.

## Default run order & `--only` behavior

`--only` 미지정 시: 기존 순서(`profile → authored → reviewed → submissions → solved`) **뒤에** `corrected → dataadded → board` 세 단계가 추가되어 모두 실행된다. 각 단계는 독립적이며 한 단계 실패가 다른 단계를 막지 않는다 (기존 try/catch 패턴 유지).

## Screenshots: contributions vs. board

- `corrected`/`dataadded`: `reviewed`와 동일하게 `problem.png`(full-page) 저장 — 문제 페이지의 시각적 스냅샷이 렌더링 변경에 대비한 백업 가치가 있음.
- `board`: `post.png` 저장 **안 함**. `post.html`이 본문 + 댓글을 모두 포함하는 "진실의 원천"이며, 게시글 렌더링은 문제 페이지보다 단순해서 HTML만으로 복구 가능하다고 판단.

## Pagination hard rules (verification checklist)

아래는 구현 후 **테스트로 강제**되어야 하는 불변 조건이다. 과거에 `authored`/`reviewed`가 1페이지만 수집하는 버그가 있었으므로(#4, 커밋 `1664577`, `d369bc4`), 신규 스크래퍼도 동일 함정을 반복하지 않도록 명시적으로 검증한다.

- [ ] `corrected`/`dataadded`는 `paginateProblemList`를 **재활용**하여 N-페이지를 모두 순회한다 (단위 테스트: page=1→2→3 URL 순차 방문 검증).
- [ ] `board` 스크래퍼는 `/board/search/all/author/{user}`에서 **다음 페이지 링크가 사라질 때까지** 계속 요청한다.
- [ ] 세 스크래퍼 모두 목록을 **전부 모은 뒤** 각 항목 수집을 시작한다 (기존 `authored`/`reviewed` 패턴 준수).
- [ ] 각 스크래퍼는 페이지 사이에 `rateLimiter.waitPagination()`을 호출한다. 단, 첫 페이지 직전에는 호출하지 않는다 (기존 `paginateProblemList` 규칙과 일관).
- [ ] 각 스크래퍼는 중간 상태를 `{category}-cache.json`에 저장하고, `--resume` 시 캐시된 목록을 그대로 재사용한다 (`complete: true`면 네트워크 0회).
- [ ] 각 항목(문제/게시글)은 `progress.markCompleted(category, id)`로 기록되어, 재실행 시 이미 완료된 항목을 건너뛴다.
- [ ] 게시판 목록 파서는 `author !== config.user`인 상단 고정 행을 필터링한다.
- [ ] 게시판 카테고리 slug 매핑은 `/board/list/{N}` 링크의 숫자 ID로 결정한다 (카테고리 셀 텍스트 파싱 금지).

## Rate limiting

`RateLimiter`(`src/core/rate-limiter.ts`)를 기존 그대로 공유한다:
- 각 항목(문제 페이지, 게시글 페이지) 요청 전에 `rateLimiter.wait()`
- 페이지네이션 사이에 `rateLimiter.waitPagination()`
- 5xx/네트워크 에러는 `rateLimiter.backoff()` (기존 정책 유지)

게시판 탐색 중 관찰한 바로 BOJ가 간헐적으로 504를 반환한다(`acmicpc.net` 자체가 과부하 상태). 재시도 정책은 기존과 동일하게 5초 간격 무한 재시도.

## Test plan

### Unit tests (신규)

| Test file | Scope |
|---|---|
| `tests/scrape-corrected-pagination.test.ts` | `scrapeCorrected`가 `author_type=3` URL로 여러 페이지를 모두 방문; `--resume` 시 `corrected-cache.json` 재사용 |
| `tests/scrape-dataadded-pagination.test.ts` | 동일, `author_type=6`, `dataadded-cache.json` |
| `tests/scrape-board-pagination.test.ts` | `scrapeBoard`가 `/board/search/all/author/{user}` 다음 페이지 링크를 모두 따라감; 상단 공지 필터링; 카테고리 ID→slug 매핑; `--resume` 시 캐시 재사용 |
| `tests/board-list-parser.test.ts` | `/board/search/...` HTML에서 행→BoardPost 배열 변환 (fixture 기반) |

### Integration tests (fixture 기반)

기존 `tests/problem-list-integration.test.ts`가 Playwright로 BOJ HTML fixture를 검증하는 패턴을 따른다.

| Test file | Fixtures |
|---|---|
| `tests/board-list-integration.test.ts` | `tests/fixtures/board/search-author.html` — 실제 `amsminn` 검색 결과 |

### Manual smoke

구현 완료 후:
1. `npm start -- --user amsminn --only corrected` — `output/corrected/*`에 문제 다운로드 확인
2. `npm start -- --user amsminn --only dataadded` — 동일
3. `npm start -- --user amsminn --only board` — `output/board/typo/*.html` 댓글 포함 여부 확인
4. 중간에 `Ctrl+C` → `--resume` → 캐시 복원 로그 확인

## README updates (구체 항목)

1. **"사용법" 섹션**에 다음 커맨드 예시 추가:
   ```bash
   npm start -- --user <handle> --only corrected
   npm start -- --user <handle> --only dataadded
   npm start -- --user <handle> --only board
   ```

2. **"백업 대상" 섹션**에 불릿 3개 추가:
   - **오타 수정 기여** — `/problem/author/{user}/3`에 나열된 문제 본문
   - **데이터 추가 기여** — `/problem/author/{user}/6`에 나열된 문제 본문
   - **게시판 글** — 본인이 쓴 모든 게시글(본문 + 댓글)을 카테고리별 분류로 저장

3. **"출력 구조" 트리**에 `corrected/`, `dataadded/`, `board/` 블록 추가 (위 Output layout 참고).

4. **"Changelog" 섹션 상단**에 `### 2026-04-19` 추가:
   - 오타 수정 / 데이터 추가 기여 문제 백업 추가 (`--only corrected` / `--only dataadded`)
   - BOJ 게시판에 본인이 쓴 게시글 백업 추가 (`--only board`) — 카테고리별 디렉토리에 저장, 전체 페이지 순회 및 `--resume` 지원

## Build sequence (high-level)

세부 스텝은 writing-plans 단계에서 상세화한다. 대략적인 순서:

1. **Types & scaffolding** — `src/types/index.ts` 타입 추가, `progress.ts` 유니온 확장, CLI choices 확장
2. **Contributions scrapers** — `corrected.ts`, `dataadded.ts` (reviewed.ts 복제 + author_type만 변경); `runBackup`에 단계 추가
3. **Board parser + scraper** — `board-categories.ts` 상수, `board-list.ts` 목록/페이지네이션, `board-post.ts` 메타 파서, `board.ts` 스크래퍼; `runBackup`에 단계 추가
4. **Tests** — 각 스크래퍼 단위 테스트 + 게시판 fixture 기반 파서 테스트
5. **README + Changelog**
6. **Manual smoke + final verification**

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| BOJ 게시판 DOM 구조 변경 | 파서를 `src/parsers/board-*.ts`로 분리; fixture 기반 통합 테스트 |
| 상단 공지가 본인 글 수보다 많거나 적어서 필터링 오류 | `author === config.user` 엄격 비교 (공지는 `startlink`, `ryute` 등이므로 본인 handle과 절대 충돌하지 않음) |
| BOJ 서버 불안정 (504 빈번) | 기존 `RateLimiter.backoff()` 무한 재시도 정책 유지; 페이지네이션 중간 캐시로 부분 진행분 보존 |
| 게시판 카테고리가 향후 추가됨 | `board-categories.ts`에 매핑 없으면 slug를 `category-{id}`로 fallback 생성 + 경고 로그 |
| 카테고리 셀 파싱 실패 (문제 번호 없는 글) | `problemId`는 optional; 없어도 메타 저장에 지장 없음 |

## Open questions

(현재 없음 — 사용자 승인 완료)
