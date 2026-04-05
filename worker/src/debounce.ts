import type { Env } from "./types.js";

/**
 * Trigger a GitHub repository_dispatch to rebuild the page for a slug.
 * Debounces: skips if a rebuild was triggered in the last `windowMs` milliseconds.
 * Returns true if dispatch was fired, false if debounced.
 *
 * Uses an atomic compare-and-swap to prevent concurrent Workers from
 * all firing dispatches when they read the same stale timestamp.
 */
export async function triggerRebuild(
  db: D1Database,
  env: Env,
  slug: string,
  windowMs: number = 30000,
): Promise<boolean> {
  const now = Date.now();
  const threshold = (now - windowMs).toString();

  // Atomic: only update if the current value is older than the debounce window.
  // If another Worker already updated it, this returns 0 rows changed.
  const result = await db
    .prepare(
      "UPDATE meta SET value = ? WHERE key = 'last_rebuild' AND CAST(value AS INTEGER) < CAST(? AS INTEGER)",
    )
    .bind(now.toString(), threshold)
    .run();

  let shouldDispatch = result.meta.changes > 0;

  // If no row existed yet (first ever rebuild), insert it
  if (!shouldDispatch) {
    const existing = await db
      .prepare("SELECT value FROM meta WHERE key = 'last_rebuild'")
      .first<{ value: string }>();

    if (!existing) {
      // First rebuild ever — insert and dispatch
      await db
        .prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('last_rebuild', ?)")
        .bind(now.toString())
        .run();
      shouldDispatch = true;
    }
    // Otherwise: row exists but is recent → debounced, skip
  }

  if (!shouldDispatch) {
    return false;
  }

  // Fire GitHub repository_dispatch
  if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
    try {
      await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization: `token ${env.GITHUB_TOKEN}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "ziscus-comments",
          },
          body: JSON.stringify({
            event_type: "rebuild-comments",
            client_payload: { slug },
          }),
        },
      );
    } catch {
      // Best effort — don't fail the comment submission
    }
  }

  return true;
}
