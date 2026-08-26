import type { Env, RebuildResult } from "./types.js";
import { logModAction } from "./mod-log.js";

/** meta.key holding the JSON-encoded outcome of the most recent dispatch attempt. */
export const LAST_REBUILD_RESULT_KEY = "last_rebuild_result";

/** Default debounce window: bulk approvals within 30s collapse into one rebuild. */
const DEFAULT_WINDOW_MS = 30_000;

export interface TriggerRebuildOptions {
  /** Debounce window in milliseconds. Default 30s. */
  windowMs?: number;
  /** Bypass the debounce window (used by POST /admin/rebuild). */
  force?: boolean;
  /** Who initiated the rebuild — recorded in mod_log. Default "system". */
  actor?: "system" | "admin";
}

/**
 * Claim the debounce window. Atomic compare-and-swap so concurrent Workers
 * that read the same stale timestamp can't all fire dispatches. Returns true
 * if this caller won the window.
 */
async function claimDebounceWindow(db: D1Database, now: number, windowMs: number): Promise<boolean> {
  const threshold = (now - windowMs).toString();
  const updated = await db
    .prepare(
      "UPDATE meta SET value = ? WHERE key = 'last_rebuild' AND CAST(value AS INTEGER) < CAST(? AS INTEGER)",
    )
    .bind(now.toString(), threshold)
    .run();
  if (updated.meta.changes > 0) return true;

  // No row yet (first rebuild ever) — INSERT OR IGNORE is atomic: exactly one caller wins.
  const inserted = await db
    .prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('last_rebuild', ?)")
    .bind(now.toString())
    .run();
  return inserted.meta.changes > 0;
}

/**
 * Give the window back after a failed dispatch so the very next approval
 * retries instead of waiting for `windowMs`. CAS on our own timestamp so we
 * never clobber a claim made by a later, successful caller.
 */
async function releaseDebounceWindow(db: D1Database, now: number): Promise<void> {
  await db
    .prepare("UPDATE meta SET value = '0' WHERE key = 'last_rebuild' AND value = ?")
    .bind(now.toString())
    .run();
}

async function recordResult(db: D1Database, result: RebuildResult): Promise<void> {
  await db
    .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
    .bind(LAST_REBUILD_RESULT_KEY, JSON.stringify(result))
    .run();
}

/** Outcome of the most recent dispatch attempt, or null if none has been recorded. */
export async function getLastRebuildResult(db: D1Database): Promise<RebuildResult | null> {
  const row = await db
    .prepare("SELECT value FROM meta WHERE key = ?")
    .bind(LAST_REBUILD_RESULT_KEY)
    .first<{ value: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as RebuildResult;
  } catch {
    return null;
  }
}

/** Extract a short, human-readable reason from a GitHub error response. */
async function describeGitHubError(res: Response): Promise<string> {
  const text = (await res.text().catch(() => "")).slice(0, 500);
  let message = text;
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === "string") message = parsed.message;
  } catch {
    // not JSON — keep the raw (truncated) body
  }
  return `GitHub ${res.status}${message ? `: ${message}` : ""}`;
}

/**
 * Trigger a GitHub `repository_dispatch` so the static site rebuilds `slug`.
 *
 * - Debounced (30s window, atomic CAS) so bulk approvals collapse into one run.
 * - **Never fails the caller** — a comment submission must succeed even if
 *   GitHub is down — but every attempt is observable: the outcome is written to
 *   `meta.last_rebuild_result` (surfaced on the dashboard and `/admin/stats`),
 *   real attempts are logged to `mod_log` as `rebuild_dispatched` /
 *   `rebuild_failed`, and failures go to `console.error` for `wrangler tail`.
 * - On failure the debounce window is released so the next approval retries.
 */
export async function triggerRebuild(
  db: D1Database,
  env: Env,
  slug: string,
  opts: TriggerRebuildOptions = {},
): Promise<RebuildResult> {
  const { windowMs = DEFAULT_WINDOW_MS, force = false, actor = "system" } = opts;
  const now = Date.now();
  const at = new Date(now).toISOString();

  if (!force) {
    const claimed = await claimDebounceWindow(db, now, windowMs);
    if (!claimed) return { dispatched: false, debounced: true, slug, at };
  }

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    // Dev / not-yet-wired deployments: record so the dashboard says "not configured",
    // but don't spam mod_log — nothing was actually attempted.
    const result: RebuildResult = {
      dispatched: false, debounced: false, slug, at,
      code: "not_configured",
      error: "GITHUB_TOKEN or GITHUB_REPO not configured",
    };
    await recordResult(db, result);
    return result;
  }

  let result: RebuildResult;
  try {
    const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `token ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "ziscus-comments",
      },
      body: JSON.stringify({ event_type: "rebuild-comments", client_payload: { slug } }),
    });
    if (res.status === 204) {
      result = { dispatched: true, debounced: false, slug, at, status: 204 };
    } else {
      result = {
        dispatched: false, debounced: false, slug, at,
        status: res.status,
        code: "github_rejected",
        error: await describeGitHubError(res),
      };
    }
  } catch (err) {
    result = {
      dispatched: false, debounced: false, slug, at,
      code: "network",
      error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (result.dispatched) {
    // A forced dispatch still counts as "just rebuilt" for subsequent debouncing.
    if (force) {
      await db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_rebuild', ?)").bind(now.toString()).run();
    }
  } else {
    console.error(`[ziscus] rebuild dispatch failed for slug "${slug}": ${result.error}`);
    if (!force) await releaseDebounceWindow(db, now);
  }

  await recordResult(db, result);
  await logModAction(db, result.dispatched ? "rebuild_dispatched" : "rebuild_failed", actor, {
    slug,
    reason: result.error ?? "",
    metadata: { status: result.status ?? null, code: result.code ?? null, forced: force },
  });

  return result;
}
