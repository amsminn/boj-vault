# Problem-list HTML fixtures

Captured from BOJ for integration-testing pagination.

- `authored-page1.html` — page 1 of `/problemset?sort=no_asc&author=baekjoon&author_type=1&page=1`; contains `id="next_page"`.
- `authored-last.html` — last page (5) of the same list; does NOT contain `id="next_page"` (has `id="prev_page"` only).

These are raw snapshots used only to assert that `parseProblemList` and `hasNextPage`
behave correctly against real BOJ markup. Regenerate if BOJ changes its list layout.

## Important URL-scheme note

BOJ's `/problem/author/{user}/{category}` URL **does not accept** a `?page=N` query
parameter — it always returns page 1, and its pagination `<ul>` actually points to
`/problemset?sort=no_asc&author={user}&author_type={category}&page=N`. The true
paginated endpoint is the `/problemset` URL, which is why the fixtures were captured
from that URL (not `/problem/author/...`). Scrapers (`reviewed.ts`, `authored.ts`) use
the `/problemset?...` URL scheme so pagination actually works.

## Regenerating

Try `curl -sL -A "Mozilla/5.0"` first — at time of capture, BOJ's problem-list pages
served the real HTML to curl. If BOJ later gates these pages behind a Cloudflare
challenge, the curl output will contain challenge markup instead of the problem table;
in that case regenerate via Playwright headful mode + `page.content()` against an
authenticated session, since the runtime scraper also runs in a Playwright context.
