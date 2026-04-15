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
  };
}

// Backup config (CLI options)
export interface BackupConfig {
  user: string;
  cdpPort: number;
  outputDir: string;
  delay: number;
  only?: string;   // 'submissions' | 'authored' | 'reviewed' | 'solved' | 'profile'
  resume: boolean;
  limit?: number;  // max items to collect per category
}
