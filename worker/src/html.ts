/**
 * HTML text escaping — the single source of truth for how comment text is
 * stored and rendered.
 *
 * Storage invariant: `author` and `body` are persisted HTML-escaped (see
 * submit.ts / admin-api.ts import). Every renderer therefore goes through
 * `escHtml(unescapeHtml(stored))` — idempotent, escapes exactly once, and stays
 * safe even if a row somehow bypassed the invariant.
 */

/** Escape the five HTML-significant characters and strip NUL bytes. Inverse: `unescapeHtml`. */
export function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\0/g, "");
}

/**
 * Exact inverse of `escHtml`. `&amp;` is decoded last so that a stored
 * `&amp;lt;` (a commenter who literally typed `&lt;`) becomes `&lt;`, not `<`.
 */
export function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
