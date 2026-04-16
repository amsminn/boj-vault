import { writeFile, mkdir, rename } from 'node:fs/promises';
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
 *
 * When `atomic` is true, writes to a temporary file first and then renames it
 * into place. This prevents partial/corrupt files when the process is
 * interrupted (e.g. SIGINT) mid-write.
 */
export async function writeJson(
  filePath: string,
  data: unknown,
  { atomic = false }: { atomic?: boolean } = {},
): Promise<void> {
  await ensureParentDir(filePath);
  const json = JSON.stringify(data, null, 2) + '\n';

  if (atomic) {
    const tmp = filePath + '.tmp';
    await writeFile(tmp, json, 'utf-8');
    await rename(tmp, filePath);
  } else {
    await writeFile(filePath, json, 'utf-8');
  }
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
