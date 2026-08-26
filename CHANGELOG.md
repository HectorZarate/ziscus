# Changelog

## 0.7.0 — 2026-08-26

### Fixes
- **Comments invisible on ziscus.com for 8 weeks (P0)**: two compounding failures. (1) The Worker's `GITHUB_TOKEN` stopped being accepted in early July, and `triggerRebuild` neither checked GitHub's response nor logged the failure, so every `repository_dispatch` after June 29 was silently dropped — 13 approved comments never left D1. (2) The rebuild workflow committed the baked HTML to git but never redeployed the Worker, and ziscus.com serves the site from the Worker's static assets, so even a successful bake only reached visitors on the next manual `wrangler deploy`. The flash-cookie path reads D1 live, which is why a commenter saw everything right after posting while everyone else saw the June 29 bake.
- **Double-escaped comment text**: the Worker stores `author`/`body` HTML-escaped and every renderer escaped again, so a quote rendered as `&amp;quot;` on the baked page, in the dashboard, and in the flash preview. `fetchComments()` now decodes the API's entities so the embed renderer escapes exactly once; the Worker's dashboard and flash renderer render stored text through `escHtml(unescapeHtml(…))`.

### Features
- **Rebuild pipeline is observable**: every dispatch attempt is recorded in `meta.last_rebuild_result`, logged to `mod_log` as `rebuild_dispatched` / `rebuild_failed` (with GitHub's status and message), and printed to `console.error` for `wrangler tail`. A failed dispatch releases the debounce window so the next approval retries immediately.
- **`POST /admin/rebuild`** forces a dispatch (bypassing the debounce) and returns GitHub's verdict — 200 on success, 502 with GitHub's message when rejected, 503 when `GITHUB_TOKEN`/`GITHUB_REPO` aren't configured.
- **`npx ziscus rebuild [slug]`** CLI wrapper for the above; exits non-zero and tells you to rotate the token on 401/403/404.
- **Dashboard "Rebuild pipeline" card** with the last outcome and a *rebuild now* button; `GET /admin/stats` gained a `rebuild` field.
- **Workflow**: deploys the Worker after each bake (`cloudflare/wrangler-action`), runs daily as a safety net, supports manual `workflow_dispatch`, and serializes runs with a concurrency group. Fails loudly if `CLOUDFLARE_API_TOKEN` is missing instead of silently leaving the site stale.

### Security
- **Backups no longer publish commenter IPs**: `ziscus export --redact-ip` strips every `ip_hash` (an unsalted 64-bit prefix of SHA-256 over the raw IP — reversible in seconds over IPv4) from comments, bans, and mod-log reasons, and the rebuild workflow uses it. The workflow's export step had never actually run before 2026-08-26 (its secret was never set); the one unredacted `backups/` commit it produced was removed.

### Packaging
- **The Worker ships in the npm package**: `export { default } from "ziscus/worker"` is a complete Worker, and `ziscus/schema.sql` (`node_modules/ziscus/dist/schema.sql`) is the D1 schema. Nobody needs to clone this repo any more. Types resolve via an optional `@cloudflare/workers-types` peer.
- **`npx ziscus deploy` works in a fresh site repo**: without a `worker/` directory it writes `wrangler.toml` (with the freshly created `database_id`, `ALLOWED_ORIGINS` from `--site-url`, `GITHUB_REPO` from the git remote) and a one-line `worker.ts`, applies the schema shipped in the package, and sets the secret in the right directory. Previously it deployed whatever `worker/wrangler.toml` said — i.e. the maintainer's own database id.
- **ziscus.com moved out**: the landing site and its rebuild workflow now live in a private repo that consumes `ziscus` and `rsslobster` from npm. `worker/wrangler.toml` here is dev/test config with a fixture site.

### Housekeeping
- `site/lobster.json` (contains a long-rotated admin secret) is untracked and gitignored — rsslobster treats it as a private file.
- Escaping helpers consolidated in `worker/src/html.ts`; CLI `--version` now matches `package.json`.
- 372 tests (worker 250, embed 122; up from 228 + 91).

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
