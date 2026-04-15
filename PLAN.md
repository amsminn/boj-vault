# BOJ Vault - Project Plan

## 배경

백준 온라인 저지(BOJ, acmicpc.net)가 서버 종료를 앞두고 있다.
수년간 쌓아온 제출 기록, 소스코드, 프로필 데이터가 서버와 함께 소멸될 위험이 있으므로,
서버 종료 전에 개인 데이터를 완전히 백업하는 도구가 필요하다.

## 목표

Playwright 기반의 자동화 도구를 만들어 BOJ의 개인 데이터를 로컬에 구조화된 형태로 백업한다.

### 백업 대상

| 대상 | 설명 | 우선순위 |
|------|------|----------|
| 제출 소스코드 | 모든 제출의 원본 코드 | P0 (최우선) |
| 제출 메타데이터 | 결과, 언어, 메모리, 시간, 코드 길이, 제출 시각 | P0 |
| 출제한 문제 | 내가 만든 문제의 본문, 테스트데이터, 설정, 에디토리얼 등 | P0 |
| 검수한 문제 | 내가 검수한 문제 목록 및 관련 데이터 | P0 |
| 푼 문제 본문 | 풀었던 문제들의 제목, 본문 HTML | P1 |
| 프로필 정보 | 핸들, 티어, 맞은 문제 수, 랭킹 등 | P1 |
| 맞은 문제 목록 | solved.ac 연동 데이터 포함 | P1 |
| 페이지 스크린샷 | 프로필, 통계 페이지의 시각적 캡처 | P2 |

#### 출제/검수 문제 상세

출제자/검수자로서의 데이터는 서버 종료 시 복구 불가능한 핵심 자산이다.

**출제한 문제 (authored)**
- 문제 본문 HTML (한국어/영어 등 다국어 버전 모두)
- 테스트데이터 (입력/출력 파일) — 문제 관리 페이지에서 접근 가능한 경우
- 스페셜 저지 코드 (있는 경우)
- 문제 설정 (시간제한, 메모리제한, 채점 방식 등)
- 에디토리얼 / 풀이 노트 (등록된 경우)

**검수한 문제 (reviewed)**
- 문제 번호 및 제목 목록
- 문제 본문 HTML
- 검수 당시 제출한 솔루션 (제출 기록에 포함될 수 있음)

## 기술 스택

- **Runtime**: Node.js
- **브라우저 자동화**: Playwright
- **언어**: TypeScript

## 핵심 설계

### 인증 (CDP 방식)

BOJ는 Cloudflare 보호 + CAPTCHA가 적용되어 있어 자동 로그인이 어렵다.
이미 로그인된 Chrome 브라우저에 CDP(Chrome DevTools Protocol)로 연결하는 방식을 사용한다.

**사전 준비 (사용자가 수동으로 수행)**
1. Chrome을 remote debugging 모드로 실행
   ```bash
   # macOS
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
   # 또는 이미 실행 중인 Chrome에 연결할 수 있도록 항상 이 플래그로 실행
   ```
2. BOJ에 로그인 (수동, CAPTCHA 직접 해결)

**boj-vault가 하는 일**
1. `playwright.chromium.connectOverCDP('http://localhost:9222')`로 브라우저 연결
2. 이미 로그인된 세션 그대로 사용 — CAPTCHA/Cloudflare 우회 불필요
3. 연결 실패 시 안내 메시지 출력 후 종료

**왜 CDP인가**
| 방식 | CAPTCHA | Cloudflare | 안정성 |
|------|---------|------------|--------|
| ID/PW 자동 입력 | 막힘 | 막힘 | 낮음 |
| 쿠키 복사 | 우회 | 만료 시 실패 | 중간 |
| **CDP (기존 브라우저)** | **해당 없음** | **해당 없음** | **높음** |

### 크롤링 전략

1. **제출 목록 페이지네이션**: `/status?user_id={handle}` 에서 전체 제출 목록 수집
2. **소스코드 조회**: 각 제출 ID로 소스코드 페이지 접근하여 코드 추출
3. **출제한 문제**: 문제 관리 페이지에서 출제 문제 목록 + 테스트데이터 + 설정 추출
4. **검수한 문제**: 검수 이력 페이지 또는 프로필에서 검수 문제 목록 수집
5. **문제 본문**: 맞은 문제 + 출제/검수 문제의 페이지 HTML 저장
6. **프로필**: `/user/{handle}` 페이지에서 정보 파싱 + 스크린샷

### Rate Limiting

BOJ는 공식 API가 없고, 공식 규칙상 웹 스크래핑을 금지하며
과도한 트래픽 발생 시 이용 정지될 수 있다.
운영자(startlink)는 크롤링 자체를 막지 않겠다는 입장이나,
Cloudflare가 자동으로 과도한 트래픽을 차단할 수 있다.
CDP로 기존 브라우저에 연결하면 Cloudflare 챌린지는 회피되지만,
요청 빈도 기반 차단은 여전히 가능하므로 보수적으로 접근한다.

**BOJ 직접 크롤링**
- 기본 딜레이: 요청 간 3~5초 + 랜덤 지터(±1초)
- 페이지네이션 등 연속 요청: 5~8초 간격
- 에러/429 발생 시: exponential backoff (10초 → 20초 → 40초 → ... 최대 5분)
- 동시 요청: 없음 (순차 처리)
- 연속 에러 3회 시: 자동 일시정지 후 사용자 확인

**solved.ac API** (프로필/문제 메타 수집용, 보조적 사용)
- 공식 제한: 15분당 256회 (≈3.5초/요청)
- 적용 딜레이: 요청 간 4초 (여유분 포함)
- solved.ac도 Cloudflare 뒤에 있으므로, CDP 브라우저 컨텍스트에서 fetch하거나
  브라우저의 쿠키를 추출해 API 호출에 사용

### 중단/재개 (Resume)

수천 개의 제출을 한 번에 처리하다 실패할 수 있으므로, 중단 후 재개를 지원한다.

- 이미 저장된 submission ID는 스킵
- 진행 상태를 `progress.json`에 기록
- `--resume` 플래그로 이어서 실행

## Output 디렉토리 구조

```
output/
├── metadata.json                    # 백업 메타 (유저명, 백업 시각, 총 제출/출제/검수 수 등)
│
├── profile/
│   ├── profile.json                 # 유저 정보 (핸들, 티어, 맞은 문제 수 등)
│   ├── solved_problems.json         # 맞은 문제 번호 목록
│   └── screenshots/
│       ├── profile.png              # 프로필 페이지 캡처
│       └── stats.png                # 통계 페이지 캡처
│
├── authored/                        # 내가 출제한 문제
│   ├── index.json                   # 출제 문제 목록 [{problem_id, title, ...}]
│   └── {problem_id}/
│       ├── problem.json             # 문제 메타 (제목, 제한, 채점 방식 등)
│       ├── problem.html             # 문제 본문 HTML
│       ├── problem_en.html          # 영어 본문 (있는 경우)
│       ├── editorial.md             # 에디토리얼 (있는 경우)
│       ├── special_judge.*          # 스페셜 저지 코드 (있는 경우)
│       └── testdata/
│           ├── 1.in                 # 테스트 입력
│           ├── 1.out                # 테스트 출력
│           ├── 2.in
│           ├── 2.out
│           └── ...
│
├── reviewed/                        # 내가 검수한 문제
│   ├── index.json                   # 검수 문제 목록 [{problem_id, title, ...}]
│   └── {problem_id}/
│       ├── problem.json             # 문제 메타
│       └── problem.html             # 문제 본문 HTML
│
├── solved/                          # 내가 푼 문제 (본문 보존용)
│   ├── index.json                   # 전체 문제 인덱스
│   └── {problem_id}/
│       ├── problem.json             # 문제 메타 (제목, 시간제한, 메모리제한, 태그)
│       └── problem.html             # 문제 본문 HTML
│
└── submissions/
    ├── index.json                   # 전체 제출 인덱스
    └── {problem_id}/
        └── {submission_id}.json     # 개별 제출 (메타 + 소스코드 inline)
```

## 실행 흐름

```
1. 브라우저 연결
   └─ CDP로 로그인된 Chrome에 연결 → 세션 확인

2. 프로필 백업
   └─ /user/{handle} 파싱 → profile.json 저장 → 스크린샷 캡처

3. 맞은 문제 목록 수집
   └─ 프로필 또는 solved.ac API에서 문제 번호 목록 확보

4. 출제한 문제 백업
   └─ 문제 관리 페이지 → 문제 목록 수집 → 본문/테스트데이터/SPJ/에디토리얼 저장

5. 검수한 문제 백업
   └─ 검수 이력 → 문제 목록 수집 → 본문 저장

6. 제출 목록 수집
   └─ /status 페이지네이션 → 전체 제출 ID + 메타데이터 수집

7. 소스코드 수집
   └─ 각 제출 ID별 소스코드 페이지 접근 → 코드 추출 → JSON 저장

8. 푼 문제 본문 수집
   └─ 맞은 문제 목록 기반 → 문제 페이지 HTML 저장

9. 인덱스 생성
   └─ 각 카테고리별 index.json 작성

10. 완료
    └─ metadata.json에 최종 통계 기록
```

## CLI 인터페이스 (예상)

```bash
# 전체 백업 (Chrome이 --remote-debugging-port=9222로 실행 중이어야 함)
npx boj-vault backup --user amsminn

# 특정 카테고리만
npx boj-vault backup --user amsminn --only submissions
npx boj-vault backup --user amsminn --only authored
npx boj-vault backup --user amsminn --only reviewed

# 중단된 백업 재개
npx boj-vault backup --user amsminn --resume

# 출력 디렉토리 지정
npx boj-vault backup --user amsminn --output ./my-backup

# CDP 포트 변경
npx boj-vault backup --user amsminn --cdp-port 9333

# rate limit 딜레이 조정 (초 단위)
npx boj-vault backup --user amsminn --delay 5
```

## 리스크 및 대응

| 리스크 | 대응 |
|--------|------|
| CAPTCHA / Cloudflare 차단 | CDP로 기존 브라우저 연결하므로 해당 없음 |
| 제출 소스코드 비공개 설정 | 본인 계정 로그인 상태에서는 열람 가능 |
| 대량 요청으로 IP 차단 | 보수적 딜레이 (3~5초+지터), exponential backoff |
| Cloudflare 요청 빈도 차단 | CDP라도 빈도 차단은 가능 → 딜레이 + 자동 일시정지 |
| 크롤링 중 네트워크 에러 | 자동 재시도 (최대 3회) + resume 기능 |
| BOJ 페이지 구조 변경 | 셀렉터 기반 파싱이므로, 셀렉터만 업데이트하면 됨 |
| Chrome 브라우저 비정상 종료 | CDP 연결 끊김 감지 → progress 저장 후 안전 종료 |
| solved.ac API 제한 초과 | 15분당 256회 준수, 429 시 15분 대기 |

## Agent Teams 구성

개발을 Claude Code agent teams로 진행한다.
각 에이전트는 독립적인 모듈을 담당하며, 병렬로 작업 가능한 단위로 나눈다.

### 팀 구성

```
┌─────────────────────────────────────────────────────────┐
│                    Orchestrator (메인)                    │
│  전체 흐름 조율, PR 리뷰, 통합 테스트                        │
└──────┬──────────┬──────────┬──────────┬─────────────────┘
       │          │          │          │
  ┌────▼───┐ ┌───▼────┐ ┌──▼───┐ ┌───▼─────┐
  │ Agent1 │ │ Agent2 │ │Agent3│ │ Agent4  │
  │  Core  │ │Scrapers│ │Parser│ │  CLI    │
  └────────┘ └────────┘ └──────┘ └─────────┘
```

### Agent 1: Core — 기반 인프라

**담당 범위**
- CDP 연결 관리 (`connectOverCDP`, 연결 상태 모니터링, 재연결)
- Rate limiter 구현 (딜레이, 지터, exponential backoff)
- Progress tracker (progress.json 읽기/쓰기, resume 지원)
- 공통 유틸리티 (로거, 파일 저장, 에러 핸들링)

**산출물**
- `src/core/cdp.ts` — CDP 연결 관리
- `src/core/rate-limiter.ts` — 요청 속도 제어
- `src/core/progress.ts` — 진행 상태 추적
- `src/core/utils.ts` — 공통 유틸

### Agent 2: Scrapers — 데이터 수집

**담당 범위**
- 각 백업 대상별 스크래퍼 구현
- BOJ 페이지 네비게이션 및 데이터 추출
- 페이지네이션 처리

**산출물**
- `src/scrapers/profile.ts` — 프로필 + 스크린샷
- `src/scrapers/submissions.ts` — 제출 목록 + 소스코드
- `src/scrapers/authored.ts` — 출제 문제 + 테스트데이터
- `src/scrapers/reviewed.ts` — 검수 문제
- `src/scrapers/solved.ts` — 푼 문제 본문

**의존성**: Agent 1의 Core 모듈 (rate limiter, CDP 연결 등)

### Agent 3: Parser — 데이터 가공/저장

**담당 범위**
- BOJ HTML 파싱 (DOM → 구조화된 JSON)
- 각 카테고리별 데이터 스키마 정의 (TypeScript 타입)
- index.json 생성 로직
- metadata.json 작성

**산출물**
- `src/parsers/problem.ts` — 문제 페이지 파싱
- `src/parsers/submission.ts` — 제출 페이지 파싱
- `src/parsers/profile.ts` — 프로필 페이지 파싱
- `src/types/` — 전체 데이터 스키마
- `src/writers/` — JSON/HTML 파일 저장

### Agent 4: CLI — 사용자 인터페이스

**담당 범위**
- CLI 인터페이스 (commander 또는 yargs)
- 설정 관리 (CDP 포트, 딜레이, output 경로 등)
- 진행 상황 표시 (프로그레스 바, 로그)
- 에러 시 사용자 친화적 메시지

**산출물**
- `src/cli/index.ts` — 엔트리포인트 + 명령어 정의
- `src/cli/config.ts` — 설정 파싱
- `src/cli/display.ts` — 진행 상황 UI

### 작업 순서 및 의존성

```
Phase 1 (병렬)
├─ Agent 1: Core 인프라 구현
├─ Agent 3: 타입 정의 + 파서 구현
└─ Agent 4: CLI 뼈대 구현

Phase 2 (Agent 1 완료 후)
└─ Agent 2: 스크래퍼 구현 (Core에 의존)

Phase 3 (전체 통합)
└─ Orchestrator: 통합 + E2E 테스트 + 리뷰
```

### 소스코드 구조 (최종)

```
boj-vault/
├── package.json
├── tsconfig.json
├── PLAN.md
├── src/
│   ├── index.ts                  # 메인 엔트리포인트
│   ├── core/
│   │   ├── cdp.ts                # CDP 연결 관리
│   │   ├── rate-limiter.ts       # 요청 속도 제어
│   │   ├── progress.ts           # 중단/재개 관리
│   │   └── utils.ts              # 공통 유틸
│   ├── scrapers/
│   │   ├── profile.ts            # 프로필 스크래퍼
│   │   ├── submissions.ts        # 제출 스크래퍼
│   │   ├── authored.ts           # 출제 문제 스크래퍼
│   │   ├── reviewed.ts           # 검수 문제 스크래퍼
│   │   └── solved.ts             # 푼 문제 스크래퍼
│   ├── parsers/
│   │   ├── problem.ts            # 문제 HTML 파서
│   │   ├── submission.ts         # 제출 HTML 파서
│   │   └── profile.ts            # 프로필 HTML 파서
│   ├── writers/
│   │   ├── json-writer.ts        # JSON 파일 저장
│   │   └── index-builder.ts      # index.json 생성
│   ├── types/
│   │   └── index.ts              # 전체 타입 정의
│   └── cli/
│       ├── index.ts              # CLI 명령어 정의
│       ├── config.ts             # 설정 관리
│       └── display.ts            # 진행 상황 표시
└── output/                       # 백업 결과 (gitignore)
```
