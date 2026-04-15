# Changelog

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
