import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Ensure the parent directory of a file path exists.
 */
async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

/**
 * Write data as formatted JSON (2-space indent).
 * Ensures parent directory exists before writing.
 */
export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureParentDir(filePath);
  const json = JSON.stringify(data, null, 2) + '\n';
  await writeFile(filePath, json, 'utf-8');
}

/**
 * Write HTML content to a file.
 * Ensures parent directory exists before writing.
 */
export async function writeHtml(filePath: string, html: string): Promise<void> {
  await ensureParentDir(filePath);
  await writeFile(filePath, html, 'utf-8');
}

/**
 * Write source code to a file.
 * Ensures parent directory exists before writing.
 */
export async function writeSourceCode(filePath: string, code: string): Promise<void> {
  await ensureParentDir(filePath);
  await writeFile(filePath, code, 'utf-8');
}
