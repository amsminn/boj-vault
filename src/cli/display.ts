const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

export class Display {
  startPhase(name: string): void {
    console.log(`\n${CYAN}${BOLD}▶ ${name}${RESET}`);
  }

  progress(current: number, total: number, label: string): void {
    const line = `  ${DIM}[${current}/${total}]${RESET} ${label}`;
    process.stdout.write(`\r${line}`);
  }

  complete(label: string): void {
    // Clear the current line, then print the completion message
    process.stdout.write('\r\x1b[K');
    console.log(`${GREEN}✓ ${label}${RESET}`);
  }

  error(message: string): void {
    console.log(`${RED}✗ ${message}${RESET}`);
  }

  warn(message: string): void {
    console.log(`${YELLOW}⚠ ${message}${RESET}`);
  }

  summary(stats: {
    submissions: number;
    solvedProblems: number;
    authoredProblems: number;
    reviewedProblems: number;
    correctedProblems: number;
    dataAddedProblems: number;
    boardPosts: number;
  }): void {
    const border = '─'.repeat(40);

    const row = (label: string, value: number): string =>
      `${BOLD}${CYAN}│${RESET}  ${label.padEnd(12)} ${String(value).padStart(20)}${' '.repeat(4)}${BOLD}${CYAN}│${RESET}`;

    console.log(`\n${BOLD}${CYAN}┌${border}┐${RESET}`);
    console.log(`${BOLD}${CYAN}│${RESET}  ${BOLD}백업 완료 요약${RESET}${' '.repeat(24)}${BOLD}${CYAN}│${RESET}`);
    console.log(`${BOLD}${CYAN}├${border}┤${RESET}`);
    console.log(row('제출', stats.submissions));
    console.log(row('맞은 문제', stats.solvedProblems));
    console.log(row('출제한 문제', stats.authoredProblems));
    console.log(row('검수한 문제', stats.reviewedProblems));
    console.log(row('오타 수정', stats.correctedProblems));
    console.log(row('데이터 추가', stats.dataAddedProblems));
    console.log(row('게시판 글', stats.boardPosts));
    console.log(`${BOLD}${CYAN}└${border}┘${RESET}`);
  }
}
