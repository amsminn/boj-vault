# Board HTML fixtures

Captured from BOJ for integration-testing the board scraper.

- `search-author.html` — `/board/search/all/author/amsminn` snapshot. Must contain:
  - At least one row authored by `amsminn`
  - At least one pinned-notice row authored by someone else (startlink/ryute)
  - At least one category cell linking to `/problem/{N}` (for the problemId extraction test)
- `post.html` — `/board/view/{id}` snapshot of a post with a non-zero comment count.

Regenerate if BOJ changes its board layout. Try curl first; if it returns a
Cloudflare challenge page, fall back to Playwright against a logged-in session.
