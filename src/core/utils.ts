import { mkdir } from 'node:fs/promises';
import type { BrowserContext, Page, Response } from 'playwright';

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const LANG_EXT: Record<string, string> = {
  'C++': '.cpp', 'C++11': '.cpp', 'C++14': '.cpp', 'C++17': '.cpp',
  'C++20': '.cpp', 'C++98': '.cpp',
  'C++11 (Clang)': '.cpp', 'C++14 (Clang)': '.cpp',
  'C++17 (Clang)': '.cpp', 'C++20 (Clang)': '.cpp',
  'C': '.c', 'C11': '.c', 'C99': '.c', 'C90': '.c', 'C2x': '.c',
  'Java': '.java', 'Java 11': '.java', 'Java 15': '.java',
  'Python': '.py', 'Python 3': '.py', 'PyPy3': '.py',
  'Rust': '.rs', 'Rust 2018': '.rs',
  'node.js': '.js', 'Text': '.txt',
  'Assembly (64bit)': '.asm', 'Assembly (32bit)': '.asm',
};

export function langToExt(language: string): string {
  // Strip " / 수정" suffix that BOJ appends to edited submissions
  const clean = language.replace(/\s*\/\s*수정$/, '').trim();
  return LANG_EXT[clean] ?? '.txt';
}

export function sanitizeFilename(name: string): string {
  // Replace path separators and other unsafe characters
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '_');  // Avoid hidden files / relative path tricks
}

/**
 * Navigate to a URL, handling Cloudflare's ERR_ABORTED redirects.
 * Falls back to waiting for the page to settle if goto throws.
 */
export async function safeGoto(
  page: Page,
  url: string,
  options?: { timeout?: number },
): Promise<Response | null> {
  const timeout = options?.timeout ?? 60_000;
  try {
    return await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ERR_ABORTED') || msg.includes('ERR_BLOCKED')) {
      // Cloudflare challenge redirect — wait for the page to settle
      await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      return null;
    }
    throw err;
  }
}

/**
 * Open a new tab, navigate to url, run callback, close tab.
 * Keeps the original tabs untouched — preserves login session.
 */
export async function withPage<T>(
  context: BrowserContext,
  url: string,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const page = await context.newPage();
  try {
    await safeGoto(page, url);
    return await fn(page);
  } finally {
    await page.close();
  }
}

export interface Logger {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

export function createLogger(prefix: string): Logger {
  const format = (level: string, message: string): string => {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] [${prefix}] ${message}`;
  };

  return {
    info(message: string, ...args: unknown[]) {
      console.log(format('INFO', message), ...args);
    },
    warn(message: string, ...args: unknown[]) {
      console.warn(format('WARN', message), ...args);
    },
    error(message: string, ...args: unknown[]) {
      console.error(format('ERROR', message), ...args);
    },
  };
}
