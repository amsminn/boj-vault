// Profile
export interface UserProfile {
  handle: string;
  tier?: string;
  rank?: number;
  solvedCount?: number;
  rating?: number;
  bio?: string;
  profileImageUrl?: string;
  fetchedAt: string; // ISO date
}

// Submission
export interface Submission {
  submissionId: number;
  problemId: number;
  contestId?: number;
  problemTitle?: string;
  result: string;         // e.g. "맞았습니다!!", "틀렸습니다", etc.
  memory: number;         // KB
  time: number;           // ms
  language: string;
  codeLength: number;     // bytes
  submittedAt: string;    // ISO date or original string
  sourceCode?: string;
}

// Problem
export interface Problem {
  problemId: number;
  title: string;
  timeLimit: string;
  memoryLimit: string;
  description?: string;    // HTML content
  inputDesc?: string;
  outputDesc?: string;
  tags?: string[];
  fetchedAt: string;
}

// Authored problem (extends Problem with extra data)
export interface AuthoredProblem extends Problem {
  hasSpecialJudge: boolean;
  hasEditorial: boolean;
  testdataCount?: number;
  languages?: string[];     // available language versions (ko, en, etc.)
}

// Reviewed problem
export interface ReviewedProblem {
  problemId: number;
  title: string;
  fetchedAt: string;
}

// Board posts
export interface BoardListRow {
  postId: number;
  title: string;
  categoryId: number;      // numeric category ID from /board/list/{N} link
  categorySlug: string;    // 'typo' | 'question' | 'free' | ...
  categoryName: string;    // visible Korean label, e.g. '오타/오역/요청'
  problemId?: number;      // present when the row's category cell includes a problem link
  author: string;          // BOJ handle of the row author (used to filter out pinned notices)
  relativeDate: string;    // "2일 전" / "8달 전" — raw text from the list page
}

export interface BoardPost {
  postId: number;
  title: string;
  categoryId: number;
  categorySlug: string;
  categoryName: string;
  problemId?: number;
  author: string;
  writtenAt: string;       // exact ISO timestamp parsed from /board/view/{id}
  commentCount: number;
  fetchedAt: string;
}

export interface BoardIndex {
  totalCount: number;
  byCategory: Record<string, number>;
  posts: (Pick<BoardPost, 'postId' | 'title' | 'categorySlug' | 'categoryName' | 'problemId' | 'author' | 'writtenAt' | 'commentCount'> & { path: string })[];
  lastUpdated: string;
}

// Index files
export interface SubmissionIndex {
  totalCount: number;
  problems: { problemId: number; submissionCount: number }[];
  lastUpdated: string;
}

export interface ProblemIndex {
  totalCount: number;
  problems: { problemId: number; title: string }[];
  lastUpdated: string;
}

// Backup metadata
export interface BackupMetadata {
  handle: string;
  startedAt: string;
  completedAt?: string;
  version: string;
  stats: {
    submissions: number;
    solvedProblems: number;
    authoredProblems: number;
    reviewedProblems: number;
    correctedProblems: number;
    dataAddedProblems: number;
    boardPosts: number;
  };
}

// Backup config (CLI options)
export interface BackupConfig {
  user: string;
  cdpPort: number;
  outputDir: string;
  delay: number;
  only?: string;   // 'submissions' | 'authored' | 'reviewed' | 'solved' | 'profile' | 'corrected' | 'dataadded' | 'board'
  resume: boolean;
  limit?: number;  // max items to collect per category
}
