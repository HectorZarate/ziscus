# Changelog

## 0.6.0 — 2026-06-29

### Security
- **Header-only admin auth**: the admin secret is no longer accepted as a `?token=` query parameter anywhere — auth is `Authorization: Bearer <ADMIN_SECRET>` only. The secret never appears in a URL, so it can't leak via browser history, proxy/CDN logs, `Referer`, or a search index. (Reverses the 0.5.0 query-param token support.) In a browser, set the header with a request-header extension; `npx ziscus dashboard` prints the exact header.
- **Admin pages excluded from indexes**: all `/admin/*` responses now send `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, and `Cache-Control: no-store`; the dashboard also carries a `<meta name="robots" content="noindex, nofollow">`.

### Fixes
- **Comments stuck in pending (P0)**: the spam classifier had been pointed at a reasoning model (`gemma-4-26b-a4b-it`) incompatible with the `max_tokens: 5` one-word prompt, so every comment fell through to `review` → `pending` and never published. Moved to `@cf/meta/llama-3.1-8b-instruct-fast`.
- **Instant comment preview restored**: the wrangler 4.87 upgrade silently dropped the `serve_directly = false` assets option, so Cloudflare served `GET /` statically and bypassed the Worker — killing the flash-cookie HTMLRewriter that shows a commenter their own comment immediately. Replaced with `run_worker_first = true`.

### Improvements
- 228 tests (up from 203)

## 0.5.0 — 2026-04-14

### Security
- **CSRF fix**: requests with no Origin/Referer header now rejected when ALLOWED_ORIGINS is configured (previously bypassed the check entirely)
- **Dashboard token**: admin action buttons use form POST instead of inline JavaScript — token no longer visible in page source or DevTools
- **Security headers**: X-Content-Type-Options, X-Frame-Options, Referrer-Policy on all Worker-handled responses
- **Auth**: `requireAuth` now accepts query-param tokens (consistent with dashboard auth)

### Features
- **Dashboard pagination**: 20 pending comments per page with prev/next navigation, zero JavaScript
- **Dashboard search**: filter pending comments by body or author text via GET form
- **GDPR deletion**: `DELETE /admin/gdpr/:ip_hash` removes all comments, rate limits, and bans for an IP hash
- **Runtime-configurable limits**: MAX_BODY_LENGTH, MAX_AUTHOR_LENGTH, MIN_BODY_LENGTH, MAX_URLS_IN_BODY, MAX_SLUG_LENGTH via environment variables (defaults unchanged)

### Improvements
- Dashboard action buttons redirect back to dashboard after approve/spam/reject (303 redirect)
- 203 tests (up from 161)

## 0.4.0

Initial public release.
