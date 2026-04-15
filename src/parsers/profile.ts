import type { Page } from 'playwright';
import type { UserProfile } from '../types/index.js';

/**
 * Extract profile data from a BOJ user page (/user/{handle}).
 *
 * Actual BOJ page structure (as of 2026-04):
 *   - Stats table: <table#statics> with rows: 등수, 맞은 문제, etc.
 *   - Solved count: <span#u-solved>
 *   - Tier badge: <img.solvedac-tier> (alt text = tier name)
 *   - Status message: <div.user-description> or similar
 */
export async function parseProfilePage(
  page: Page,
  handle: string,
): Promise<UserProfile> {
  const data = (await page.evaluate(`
    (() => {
      // Solved count from #u-solved
      const solvedEl = document.getElementById('u-solved');
      const solvedCount = solvedEl ? parseInt(solvedEl.textContent || '0', 10) : undefined;

      // Rank from #statics table — first row's td
      let rank;
      const statsTable = document.getElementById('statics');
      if (statsTable) {
        const rows = statsTable.querySelectorAll('tr');
        for (const row of rows) {
          const th = row.querySelector('th');
          const td = row.querySelector('td');
          if (th && td && th.textContent.includes('등수')) {
            const parsed = parseInt(td.textContent.trim(), 10);
            if (!isNaN(parsed)) rank = parsed;
            break;
          }
        }
      }

      // Tier from solvedac-tier badge image alt text
      let tier;
      const tierImg = document.querySelector('img.solvedac-tier');
      if (tierImg) {
        tier = tierImg.getAttribute('alt') || undefined;
      }

      // Bio / status message
      let bio;
      const bioEl = document.querySelector('.user-description, .u-status-message, .introbox');
      if (bioEl) {
        bio = bioEl.textContent.trim() || undefined;
      }

      // Profile image
      let profileImageUrl;
      const imgEl = document.querySelector('.user-profile img, .profile-image img');
      if (imgEl) {
        profileImageUrl = imgEl.getAttribute('src') || undefined;
      }

      return { solvedCount, rank, tier, bio, profileImageUrl };
    })()
  `)) as { solvedCount?: number; rank?: number; tier?: string; bio?: string; profileImageUrl?: string };

  return {
    handle,
    tier: data.tier,
    rank: data.rank,
    solvedCount: data.solvedCount,
    bio: data.bio,
    profileImageUrl: data.profileImageUrl,
    fetchedAt: new Date().toISOString(),
  };
}
