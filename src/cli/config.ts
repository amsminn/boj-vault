import type { BackupConfig } from '../types/index.js';

export interface CliOptions {
  user: string;
  cdpPort: number;
  output: string;
  delay: number;
  only?: string;
  resume: boolean;
  limit?: string;
}

export function resolveConfig(opts: CliOptions): BackupConfig {
  return {
    user: opts.user,
    cdpPort: opts.cdpPort ?? 9222,
    outputDir: opts.output ?? './output',
    delay: opts.delay ?? 4,
    only: opts.only,
    resume: opts.resume ?? false,
    limit: opts.limit ? Number(opts.limit) : undefined,
  };
}
