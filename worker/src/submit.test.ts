/**
 * CSRF origin validation tests for handleSubmit.
 *
 * These tests exercise the ALLOWED_ORIGINS guard in isolation by calling
 * handleSubmit directly so we can supply a custom env without touching
 * the real wrangler.toml bindings.
 */

import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { handleSubmit } from "./submit.js";

// ---------------------------------------------------------------------------
// Minimal DB schema required by handleSubmit
// ---------------------------------------------------------------------------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  slug       TEXT NOT NULL,
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  ip_hash    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  approved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_comments_slug_status ON comments(slug, status, created_at);
CREATE TABLE IF NOT EXISTS rate_limits (
  ip_hash TEXT NOT NULL,
  window  TEXT NOT NULL,
  count   INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, window)
);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS banned_ips (
  ip_hash   TEXT PRIMARY KEY,
  reason    TEXT NOT NULL DEFAULT '',
  banned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS mod_log (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  action     TEXT NOT NULL,
  actor      TEXT NOT NULL DEFAULT 'admin',
  comment_id TEXT,
  slug       TEXT,
  reason     TEXT NOT NULL DEFAULT '',
  metadata   TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
`;

async function initDb() {
  for (const stmt of SCHEMA.split(";").filter((s) => s.trim())) {
    await env.DB.prepare(stmt).run();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal POST /submit request. Headers can be customised. */
function makeRequest(
  fields: { slug?: string; author?: string; body?: string } = {},
  headers: Record<string, string> = {},
): Request {
  const form = new FormData();
  form.set("slug", fields.slug ?? "test-post");
  form.set("author", fields.author ?? "Ada");
  form.set("body", fields.body ?? "Great article!");

  return new Request("https://test.example.com/submit", {
    method: "POST",
    body: form,
    headers,
  });
}

/** env with ALLOWED_ORIGINS set, AI removed for deterministic status. */
function envWithOrigins(allowedOrigins: string) {
  const e = {
    ...env,
    ALLOWED_ORIGINS: allowedOrigins,
    MODERATION: "off",
  } as typeof env;
  delete (e as unknown as Record<string, unknown>).AI_MOD;
  return e;
}

/** env with ALLOWED_ORIGINS explicitly absent (dev mode). */
function devEnv() {
  const e = {
    ...env,
    MODERATION: "off",
  } as typeof env;
  delete (e as unknown as Record<string, unknown>).AI_MOD;
  delete (e as unknown as Record<string, unknown>).ALLOWED_ORIGINS;
  return e;
}

// ---------------------------------------------------------------------------
// CSRF origin validation
// ---------------------------------------------------------------------------

describe("CSRF origin validation", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.prepare("DELETE FROM rate_limits").run();
    await env.DB.prepare("DELETE FROM meta").run();
    await env.DB.prepare("DELETE FROM banned_ips").run();
    await env.DB.prepare("DELETE FROM mod_log").run();
  });

  // --- When ALLOWED_ORIGINS is configured ---

  it("rejects request with no Origin header when ALLOWED_ORIGINS is set", async () => {
    const req = makeRequest(); // no Origin / Referer headers
    const res = await handleSubmit(req, envWithOrigins("example.com"));
    expect(res.status).toBe(403);
  });

  it("rejects request with no Referer header when ALLOWED_ORIGINS is set", async () => {
    // FormData fetches from SELF always inject some headers; calling handleSubmit
    // directly lets us guarantee neither Origin nor Referer is present.
    const req = makeRequest({}, {}); // explicit empty headers
    const res = await handleSubmit(req, envWithOrigins("mysite.com"));
    expect(res.status).toBe(403);
  });

  it("allows request with a matching Origin header", async () => {
    const req = makeRequest({}, { Origin: "https://example.com" });
    const res = await handleSubmit(req, envWithOrigins("example.com"));
    // 303 redirect = accepted; 403 = CSRF rejection
    expect(res.status).not.toBe(403);
  });

  it("allows request with a matching subdomain Origin", async () => {
    const req = makeRequest({}, { Origin: "https://sub.example.com" });
    const res = await handleSubmit(req, envWithOrigins("example.com"));
    expect(res.status).not.toBe(403);
  });

  it("rejects request with Origin from a non-allowed host", async () => {
    const req = makeRequest({}, { Origin: "https://evil.com" });
    const res = await handleSubmit(req, envWithOrigins("example.com"));
    expect(res.status).toBe(403);
  });

  it("falls back to Referer when Origin is absent and Referer matches", async () => {
    const req = makeRequest({}, { Referer: "https://example.com/some/page" });
    const res = await handleSubmit(req, envWithOrigins("example.com"));
    expect(res.status).not.toBe(403);
  });

  // --- Dev mode: ALLOWED_ORIGINS is not configured ---

  it("allows request with no Origin header when ALLOWED_ORIGINS is NOT set (dev mode)", async () => {
    const req = makeRequest(); // no Origin / Referer headers
    const res = await handleSubmit(req, devEnv());
    // Should NOT be 403 — dev mode with no ALLOWED_ORIGINS allows all origins
    expect(res.status).not.toBe(403);
  });

  it("allows request with any Origin when ALLOWED_ORIGINS is NOT set (dev mode)", async () => {
    const req = makeRequest({}, { Origin: "https://localhost:3000" });
    const res = await handleSubmit(req, devEnv());
    expect(res.status).not.toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Runtime-configurable limits
// ---------------------------------------------------------------------------

describe("runtime-configurable limits", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.prepare("DELETE FROM rate_limits").run();
    await env.DB.prepare("DELETE FROM meta").run();
    await env.DB.prepare("DELETE FROM banned_ips").run();
    await env.DB.prepare("DELETE FROM mod_log").run();
  });

  /** Build an env override with specified limit vars, no AI, no ALLOWED_ORIGINS. */
  function limitEnv(overrides: Record<string, string>) {
    const e = {
      ...env,
      MODERATION: "off",
      ...overrides,
    } as typeof env;
    delete (e as unknown as Record<string, unknown>).AI_MOD;
    delete (e as unknown as Record<string, unknown>).ALLOWED_ORIGINS;
    return e;
  }

  // --- MAX_BODY_LENGTH ---

  it("rejects body exceeding custom MAX_BODY_LENGTH", async () => {
    const longBody = "a".repeat(51); // exceeds limit of 50
    const req = makeRequest({ body: longBody });
    const res = await handleSubmit(req, limitEnv({ MAX_BODY_LENGTH: "50" }));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Comment too long");
  });

  it("accepts body within custom MAX_BODY_LENGTH", async () => {
    // Exactly 50 chars of real prose (passes structural filter, within limit)
    const okBody = "Great post, learned something new today. Thanks!!";
    const req = makeRequest({ body: okBody });
    const res = await handleSubmit(req, limitEnv({ MAX_BODY_LENGTH: "50" }));
    expect(res.status).not.toBe(400);
  });

  it("uses default MAX_BODY_LENGTH of 10000 when env var is absent", async () => {
    const longBody = "a".repeat(10001);
    const req = makeRequest({ body: longBody });
    const res = await handleSubmit(req, limitEnv({}));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Comment too long");
  });

  it("accepts 10000-char body when MAX_BODY_LENGTH is not set", async () => {
    // Build a 10000-char body out of repeated words so it passes structural filters
    const word = "valid comment text ";
    const okBody = word.repeat(Math.ceil(10000 / word.length)).slice(0, 10000);
    const req = makeRequest({ body: okBody });
    const res = await handleSubmit(req, limitEnv({}));
    expect(res.status).not.toBe(400);
  });

  // --- MIN_BODY_LENGTH ---

  it("rejects body shorter than custom MIN_BODY_LENGTH", async () => {
    const req = makeRequest({ body: "ab" }); // 2 chars, below limit of 5
    const res = await handleSubmit(req, limitEnv({ MIN_BODY_LENGTH: "5" }));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Comment too short");
  });

  it("uses default MIN_BODY_LENGTH of 2 when env var is absent", async () => {
    const req = makeRequest({ body: "ab" }); // exactly 2 chars = ok
    const res = await handleSubmit(req, limitEnv({}));
    expect(res.status).not.toBe(400);
  });

  it("rejects 1-char body under default MIN_BODY_LENGTH", async () => {
    const req = makeRequest({ body: "x" });
    const res = await handleSubmit(req, limitEnv({}));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Comment too short");
  });

  // --- MAX_AUTHOR_LENGTH ---

  it("rejects author exceeding custom MAX_AUTHOR_LENGTH", async () => {
    const longAuthor = "a".repeat(11); // exceeds limit of 10
    const req = makeRequest({ author: longAuthor });
    const res = await handleSubmit(req, limitEnv({ MAX_AUTHOR_LENGTH: "10" }));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Author name too long");
  });

  it("uses default MAX_AUTHOR_LENGTH of 100 when env var is absent", async () => {
    const longAuthor = "a".repeat(101);
    const req = makeRequest({ author: longAuthor });
    const res = await handleSubmit(req, limitEnv({}));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Author name too long");
  });

  // --- MAX_URLS_IN_BODY ---

  it("rejects body with more URLs than custom MAX_URLS_IN_BODY", async () => {
    const bodyWith2Urls = "see https://a.com and also https://b.com";
    const req = makeRequest({ body: bodyWith2Urls });
    const res = await handleSubmit(req, limitEnv({ MAX_URLS_IN_BODY: "1" }));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Too many URLs");
  });

  it("uses default MAX_URLS_IN_BODY of 3 when env var is absent", async () => {
    const bodyWith4Urls =
      "https://a.com https://b.com https://c.com https://d.com";
    const req = makeRequest({ body: bodyWith4Urls });
    const res = await handleSubmit(req, limitEnv({}));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Too many URLs");
  });

  // --- MAX_SLUG_LENGTH ---

  it("rejects slug exceeding custom MAX_SLUG_LENGTH", async () => {
    const longSlug = "a".repeat(11); // exceeds limit of 10
    const req = makeRequest({ slug: longSlug });
    const res = await handleSubmit(req, limitEnv({ MAX_SLUG_LENGTH: "10" }));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Slug too long");
  });

  it("uses default MAX_SLUG_LENGTH of 255 when env var is absent", async () => {
    const longSlug = "a".repeat(256);
    const req = makeRequest({ slug: longSlug });
    const res = await handleSubmit(req, limitEnv({}));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Slug too long");
  });

  it("accepts a 255-char slug under the default limit", async () => {
    const okSlug = "a".repeat(255);
    const req = makeRequest({ slug: okSlug });
    const res = await handleSubmit(req, limitEnv({}));
    // Slug regex rejects non-[a-z0-9-] but all 'a's are fine — should not 400 on length
    expect(await res.text()).not.toBe("Slug too long");
  });
});
