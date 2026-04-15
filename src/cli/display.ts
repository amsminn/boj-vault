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
  }): void {
    const border = '─'.repeat(40);

    console.log(`\n${BOLD}${CYAN}┌${border}┐${RESET}`);
    console.log(`${BOLD}${CYAN}│${RESET}  ${BOLD}백업 완료 요약${RESET}${' '.repeat(24)}${BOLD}${CYAN}│${RESET}`);
    console.log(`${BOLD}${CYAN}├${border}┤${RESET}`);
    console.log(`${BOLD}${CYAN}│${RESET}  제출        ${String(stats.submissions).padStart(20)}${' '.repeat(4)}${BOLD}${CYAN}│${RESET}`);
    console.log(`${BOLD}${CYAN}│${RESET}  맞은 문제   ${String(stats.solvedProblems).padStart(20)}${' '.repeat(4)}${BOLD}${CYAN}│${RESET}`);
    console.log(`${BOLD}${CYAN}│${RESET}  출제한 문제 ${String(stats.authoredProblems).padStart(20)}${' '.repeat(4)}${BOLD}${CYAN}│${RESET}`);
    console.log(`${BOLD}${CYAN}│${RESET}  검수한 문제 ${String(stats.reviewedProblems).padStart(20)}${' '.repeat(4)}${BOLD}${CYAN}│${RESET}`);
    console.log(`${BOLD}${CYAN}└${border}┘${RESET}`);
  }
}
