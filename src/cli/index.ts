#!/usr/bin/env node

import { Command, Option } from 'commander';
import { resolveConfig } from './config.js';
import { Display } from './display.js';
import { runBackup } from '../index.js';

const display = new Display();

const program = new Command();

program
  .name('boj-vault')
  .description('백준 온라인 저지 개인 데이터 백업 도구')
  .version('0.1.0');

program
  .command('backup')
  .description('백준 데이터 백업 실행')
  .requiredOption('--user <handle>', 'BOJ 사용자 아이디')
  .option('--cdp-port <port>', 'Chrome CDP 포트', '9222')
  .option('--output <dir>', '출력 디렉토리', './output')
  .option('--delay <seconds>', '요청 간 딜레이 (초)', '4')
  .addOption(
    new Option('--only <category>', '특정 카테고리만 백업')
      .choices(['submissions', 'authored', 'reviewed', 'solved', 'profile', 'corrected', 'dataadded', 'board']),
  )
  .option('--resume', '중단된 백업 재개', false)
  .option('--limit <count>', '카테고리별 최대 수집 개수')
  .action(async (opts) => {
    try {
      const config = resolveConfig({
        user: opts.user,
        cdpPort: Number(opts.cdpPort),
        output: opts.output,
        delay: Number(opts.delay),
        only: opts.only,
        resume: opts.resume,
        limit: opts.limit,
      });

      console.log();
      console.log('╔══════════════════════════════════════╗');
      console.log('║          boj-vault v0.1.0            ║');
      console.log('╚══════════════════════════════════════╝');
      console.log();
      console.log(`  사용자:       ${config.user}`);
      console.log(`  CDP 포트:     ${config.cdpPort}`);
      console.log(`  출력 경로:    ${config.outputDir}`);
      console.log(`  요청 딜레이:  ${config.delay}초`);
      if (config.only) {
        console.log(`  대상:         ${config.only}`);
      }
      if (config.resume) {
        console.log(`  모드:         이어서 백업`);
      }
      console.log();

      await runBackup(config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      display.error(message);
      process.exit(1);
    }
  });

program.parse();
