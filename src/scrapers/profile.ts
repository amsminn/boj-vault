import { join } from 'node:path';
import type { BrowserContext } from 'playwright';
import type { BackupConfig } from '../types/index.js';
import { parseProfilePage } from '../parsers/profile.js';
import { writeJson } from '../writers/json-writer.js';
import { ensureDir, createLogger, withPage } from '../core/utils.js';

export async function scrapeProfile(
  context: BrowserContext,
  config: BackupConfig,
): Promise<void> {
  const log = createLogger('profile');

  const profileDir = join(config.outputDir, 'profile');
  const screenshotDir = join(profileDir, 'screenshots');
  await ensureDir(screenshotDir);

  // Navigate to user profile page in a new tab
  const profileUrl = `https://www.acmicpc.net/user/${config.user}`;
  log.info(`프로필 페이지 이동: ${profileUrl}`);

  const profile = await withPage(context, profileUrl, async (page) => {
    // Wait for page content to load
    try {
      await page.locator('#statis, body').first().waitFor({
        state: 'visible',
        timeout: 15_000,
      });
    } catch {
      log.warn('프로필 페이지 로딩 타임아웃 — 현재 상태로 계속 진행합니다');
    }

    // Parse profile data
    const profile = await parseProfilePage(page, config.user);
    log.info(
      `프로필 파싱 완료: ${profile.handle} (solved: ${profile.solvedCount ?? 'N/A'})`,
    );

    // Take a screenshot of the profile page
    const profileScreenshot = join(screenshotDir, 'profile.png');
    await page.screenshot({ path: profileScreenshot, fullPage: true });
    log.info(`프로필 스크린샷 저장: ${profileScreenshot}`);

    return profile;
  });

  // Save profile JSON
  const profileJsonPath = join(profileDir, 'profile.json');
  await writeJson(profileJsonPath, profile);
  log.info(`프로필 저장: ${profileJsonPath}`);

  // Take a screenshot of the language stats page
  const langUrl = `https://www.acmicpc.net/user/language/${config.user}`;
  await withPage(context, langUrl, async (page) => {
    await page.waitForLoadState('networkidle').catch(() => {});
    const langScreenshot = join(screenshotDir, 'language.png');
    await page.screenshot({ path: langScreenshot, fullPage: true });
    log.info(`언어 통계 스크린샷 저장: ${langScreenshot}`);
  }).catch((err) => {
    log.warn(
      `언어 통계 페이지 접근 실패: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  log.info('프로필 백업 완료');
}
