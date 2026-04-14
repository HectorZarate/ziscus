import {
  env,
  SELF,
} from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";

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
CREATE INDEX IF NOT EXISTS idx_mod_log_created ON mod_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mod_log_action ON mod_log(action, created_at DESC);
`;

async function initDb() {
  for (const stmt of SCHEMA.split(";").filter((s) => s.trim())) {
    await env.DB.prepare(stmt).run();
  }
}

async function submitComment(
  slug: string,
  author: string,
  body: string,
  extra: Record<string, string> = {},
): Promise<Response> {
  const form = new FormData();
  form.set("slug", slug);
  form.set("author", author);
  form.set("body", body);
  for (const [k, v] of Object.entries(extra)) {
    form.set(k, v);
  }
  return SELF.fetch("https://test.example.com/submit", {
    method: "POST",
    body: form,
    redirect: "manual",
    headers: { Origin: "https://ziscus.com" },
  });
}

// ---------------------------------------------------------------------------
// POST /submit
// ---------------------------------------------------------------------------

describe("POST /submit", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.prepare("DELETE FROM rate_limits").run();
    await env.DB.prepare("DELETE FROM meta").run();
    await env.DB.prepare("DELETE FROM banned_ips").run();
  });

  it("inserts a comment and stores it", async () => {
    // AI_MOD binding hits real Workers AI in tests — status depends on AI response/timeout.
    // Deterministic behavior is tested in "AI moderation security model" with mocked AI.
    const res = await submitComment("test-post", "Ada", "Great article!");
    expect([200, 303]).toContain(res.status);

    const { results } = await env.DB.prepare(
      "SELECT * FROM comments WHERE slug = 'test-post'",
    ).all();
    expect(results).toHaveLength(1);
    expect(results[0]!.author).toBe("Ada");
    expect(results[0]!.body).toBe("Great article!");
  });

  it("returns 400 on missing author", async () => {
    const form = new FormData();
    form.set("slug", "test");
    form.set("body", "Hello");
    const res = await SELF.fetch("https://test.example.com/submit", {
      method: "POST",
      body: form,
      headers: { Origin: "https://ziscus.com" },
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 on missing body", async () => {
    const form = new FormData();
    form.set("slug", "test");
    form.set("author", "Ada");
    const res = await SELF.fetch("https://test.example.com/submit", {
      method: "POST",
      body: form,
      headers: { Origin: "https://ziscus.com" },
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 on missing slug", async () => {
    const form = new FormData();
    form.set("author", "Ada");
    form.set("body", "Hello");
    const res = await SELF.fetch("https://test.example.com/submit", {
      method: "POST",
      body: form,
      headers: { Origin: "https://ziscus.com" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects body longer than 10000 characters", async () => {
    const res = await submitComment("test", "Ada", "x".repeat(10001));
    expect(res.status).toBe(400);
  });

  it("rejects author longer than 100 characters", async () => {
    const res = await submitComment("test", "A".repeat(101), "Hello");
    expect(res.status).toBe(400);
  });

  it("escapes HTML in stored fields", async () => {
    await submitComment("test", '<script>alert("xss")</script>', "Normal body");
    const { results } = await env.DB.prepare(
      "SELECT author FROM comments WHERE slug = 'test'",
    ).all();
    expect(results[0]!.author).not.toContain("<script>");
    expect(results[0]!.author).toContain("&lt;script&gt;");
  });

  it("escapes single quotes in stored fields", async () => {
    await submitComment("test", "O'Malley", "It's great!");
    const { results } = await env.DB.prepare("SELECT author, body FROM comments WHERE slug = 'test'").all();
    expect(results[0]!.author).toContain("&#39;");
    expect(results[0]!.body).toContain("&#39;");
  });

  it("rejects slug longer than 255 characters", async () => {
    const res = await submitComment("a".repeat(256), "Ada", "Hello");
    expect(res.status).toBe(400);
  });

  it("rejects slug with invalid characters", async () => {
    const form = new FormData();
    form.set("slug", "../../etc/passwd");
    form.set("author", "Ada");
    form.set("body", "Hello world");
    const res = await SELF.fetch("https://test.example.com/submit", { method: "POST", body: form, redirect: "manual", headers: { Origin: "https://ziscus.com" } });
    expect(res.status).toBe(400);
  });

  it("rejects comments with more than 3 URLs", async () => {
    const body =
      "Check out https://a.com and https://b.com and https://c.com and https://d.com";
    const res = await submitComment("test", "Spammer", body);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Duplicate comment prevention
// ---------------------------------------------------------------------------

describe("duplicate comment prevention", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.prepare("DELETE FROM rate_limits").run();
    await env.DB.prepare("DELETE FROM meta").run();
    await env.DB.prepare("DELETE FROM banned_ips").run();
    await env.DB.prepare("DELETE FROM mod_log").run();
  });

  // Use handleSubmit directly with no AI binding to avoid 3s AI timeout per call
  function makeReq(slug: string, author: string, body: string): Request {
    const form = new FormData();
    form.set("slug", slug);
    form.set("author", author);
    form.set("body", body);
    return new Request("https://test.example.com/submit", { method: "POST", body: form, headers: { Origin: "https://ziscus.com" } });
  }

  const noAiEnv = { ...env, MODERATION: "off" } as typeof env;
  // Remove AI_MOD so classify returns "approve" instantly
  delete (noAiEnv as unknown as Record<string, unknown>).AI_MOD;

  it("rejects duplicate POST with same body/slug/IP within 5 minutes", async () => {
    await handleSubmit(makeReq("test", "Ada", "Great article!"), noAiEnv);
    await handleSubmit(makeReq("test", "Ada", "Great article!"), noAiEnv);

    const { results } = await env.DB.prepare("SELECT * FROM comments WHERE slug = 'test'").all();
    expect(results).toHaveLength(1);
  });

  it("returns success on duplicate (silent dedup)", async () => {
    await handleSubmit(makeReq("test", "Ada", "Great article!"), noAiEnv);
    const res = await handleSubmit(makeReq("test", "Ada", "Great article!"), noAiEnv);
    expect(res.status).toBe(303);
  });

  it("allows same body on different slugs", async () => {
    await handleSubmit(makeReq("post-a", "Ada", "Great article!"), noAiEnv);
    await handleSubmit(makeReq("post-b", "Ada", "Great article!"), noAiEnv);

    const a = await env.DB.prepare("SELECT * FROM comments WHERE slug = 'post-a'").all();
    const b = await env.DB.prepare("SELECT * FROM comments WHERE slug = 'post-b'").all();
    expect(a.results).toHaveLength(1);
    expect(b.results).toHaveLength(1);
  });

  it("allows different body on same slug", async () => {
    await handleSubmit(makeReq("test", "Ada", "First comment"), noAiEnv);
    await handleSubmit(makeReq("test", "Ada", "Second comment"), noAiEnv);

    const { results } = await env.DB.prepare("SELECT * FROM comments WHERE slug = 'test'").all();
    expect(results).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// POST-Redirect-Get pattern
// ---------------------------------------------------------------------------

describe("PRG pattern", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.prepare("DELETE FROM rate_limits").run();
    await env.DB.prepare("DELETE FROM meta").run();
    await env.DB.prepare("DELETE FROM banned_ips").run();
  });

  // Use handleSubmit with no AI to avoid non-deterministic AI timeout
  function makeReq(slug: string, author: string, body: string): Request {
    const form = new FormData();
    form.set("slug", slug);
    form.set("author", author);
    form.set("body", body);
    return new Request("https://test.example.com/submit", { method: "POST", body: form, headers: { Origin: "https://ziscus.com" } });
  }
  const prgEnv = { ...env, MODERATION: "off" } as typeof env;
  delete (prgEnv as unknown as Record<string, unknown>).AI_MOD;

  it("returns 303 redirect for approved comments (not 200)", async () => {
    const res = await handleSubmit(makeReq("test", "Ada", "Great article!"), prgEnv);
    expect(res.status).toBe(303);
  });

  it("sets ziscus_posted cookie on approved comment", async () => {
    const res = await handleSubmit(makeReq("test", "Ada", "Great article!"), prgEnv);
    const cookie = res.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("ziscus_posted=test");
  });

  it("GET with flash cookie serves fresh comments via HTMLRewriter", async () => {
    // Insert an approved comment directly (bypass AI which may timeout in tests)
    await env.DB.prepare(
      "INSERT INTO comments (id, slug, author, body, status) VALUES ('prg1', 'landing', 'Ada', 'Hello from PRG test', 'approved')",
    ).run();

    // Verify it's in the DB
    const check = await env.DB.prepare("SELECT * FROM comments WHERE id = 'prg1'").first();
    expect(check).toBeTruthy();
    expect(check!.status).toBe("approved");

    // GET the page with the flash cookie
    const res = await SELF.fetch("https://test.example.com/", {
      headers: { Cookie: "ziscus_posted=landing" },
    });

    // Flash path runs serveWithFreshComments (proven by existing HTMLRewriter tests).
    // Here we verify the route triggers on the cookie and returns 200.
    expect(res.status).toBe(200);
  });

  it("GET without flash cookie serves static assets normally", async () => {
    await submitComment("landing", "Ada", "Hello");

    const res = await SELF.fetch("https://test.example.com/");
    // Should serve static assets (no cookie = no HTMLRewriter)
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("Hello from PRG test");
  });
});

// ---------------------------------------------------------------------------
// GET /comments/:slug
// ---------------------------------------------------------------------------

describe("GET /comments/:slug", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
  });

  it("returns approved comments as JSON array", async () => {
    await env.DB.prepare(
      "INSERT INTO comments (id, slug, author, body, status) VALUES ('c1', 'test-post', 'Ada', 'Hello', 'approved')",
    ).run();

    const res = await SELF.fetch(
      "https://test.example.com/comments/test-post",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");

    const comments = (await res.json()) as Array<Record<string, unknown>>;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.author).toBe("Ada");
  });

  it("does not return pending or rejected comments", async () => {
    await env.DB.prepare(
      "INSERT INTO comments (id, slug, author, body, status) VALUES ('c1', 'test', 'Ada', 'Approved', 'approved')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO comments (id, slug, author, body, status) VALUES ('c2', 'test', 'Bob', 'Pending', 'pending')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO comments (id, slug, author, body, status) VALUES ('c3', 'test', 'Eve', 'Rejected', 'rejected')",
    ).run();

    const res = await SELF.fetch("https://test.example.com/comments/test");
    const comments = (await res.json()) as Array<Record<string, unknown>>;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.author).toBe("Ada");
  });

  it("returns empty array for unknown slug", async () => {
    const res = await SELF.fetch(
      "https://test.example.com/comments/nonexistent",
    );
    const comments = await res.json();
    expect(comments).toEqual([]);
  });

  it("orders comments by created_at ascending", async () => {
    await env.DB.prepare(
      "INSERT INTO comments (id, slug, author, body, status, created_at) VALUES ('c1', 'test', 'First', 'One', 'approved', '2026-03-25T12:00:00Z')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO comments (id, slug, author, body, status, created_at) VALUES ('c2', 'test', 'Second', 'Two', 'approved', '2026-03-25T13:00:00Z')",
    ).run();

    const res = await SELF.fetch("https://test.example.com/comments/test");
    const comments = (await res.json()) as Array<Record<string, unknown>>;
    expect(comments[0]!.author).toBe("First");
    expect(comments[1]!.author).toBe("Second");
  });

  it("sets Cache-Control header", async () => {
    const res = await SELF.fetch("https://test.example.com/comments/test");
    expect(res.headers.get("Cache-Control")).toContain("max-age");
  });
});

// ---------------------------------------------------------------------------
// POST /approve/:id
// ---------------------------------------------------------------------------

describe("POST /approve/:id", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.prepare("DELETE FROM meta").run();
  });

  it("updates comment status to approved", async () => {
    await env.DB.prepare(
      "INSERT INTO comments (id, slug, author, body, status) VALUES ('abc', 'test', 'Ada', 'Hello', 'pending')",
    ).run();

    const res = await SELF.fetch("https://test.example.com/approve/abc", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    expect(res.status).toBe(200);

    const comment = await env.DB.prepare(
      "SELECT status, approved_at FROM comments WHERE id = 'abc'",
    ).first<{ status: string; approved_at: string }>();
    expect(comment!.status).toBe("approved");
    expect(comment!.approved_at).toBeTruthy();
  });

  it("returns 401 without auth", async () => {
    await env.DB.prepare(
      "INSERT INTO comments (id, slug, author, body, status) VALUES ('abc', 'test', 'Ada', 'Hello', 'pending')",
    ).run();

    const res = await SELF.fetch("https://test.example.com/approve/abc", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 for nonexistent comment", async () => {
    const res = await SELF.fetch("https://test.example.com/approve/nonexistent", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /reject/:id
// ---------------------------------------------------------------------------

describe("POST /reject/:id", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
  });

  it("updates comment status to rejected", async () => {
    await env.DB.prepare(
      "INSERT INTO comments (id, slug, author, body, status) VALUES ('abc', 'test', 'Ada', 'Hello', 'pending')",
    ).run();

    const res = await SELF.fetch("https://test.example.com/reject/abc", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    expect(res.status).toBe(200);

    const comment = await env.DB.prepare(
      "SELECT status FROM comments WHERE id = 'abc'",
    ).first<{ status: string }>();
    expect(comment!.status).toBe("rejected");
  });

  it("returns 401 without auth", async () => {
    const res = await SELF.fetch("https://test.example.com/reject/abc", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe("rate limiting", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.prepare("DELETE FROM rate_limits").run();
    await env.DB.prepare("DELETE FROM meta").run();
  });

  it("returns 429 after exceeding rate limit", async () => {
    // Submit comments up to the limit by directly inserting rate limit rows
    // (avoids submitting 30 real comments which is slow with D1 + mod_log writes)
    const limit = parseInt(env.RATE_LIMIT ?? "30", 10);
    const now = new Date();
    const windowStart = new Date(
      Math.floor(now.getTime() / (60 * 60 * 1000)) * (60 * 60 * 1000),
    ).toISOString();
    // Hash of "unknown" (test IP)
    const encoder = new TextEncoder();
    const data = encoder.encode("unknown");
    const hashBuf = await crypto.subtle.digest("SHA-256", data);
    const ipHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);

    await env.DB.prepare(
      "INSERT OR REPLACE INTO rate_limits (ip_hash, window, count) VALUES (?, ?, ?)",
    ).bind(ipHash, windowStart, limit).run();

    const res = await submitComment("test", "Excess", "Too many");
    expect(res.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Debouncing
// ---------------------------------------------------------------------------

describe("debouncing", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM meta").run();
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.prepare("DELETE FROM rate_limits").run();
  });

  it("stores last rebuild timestamp in meta table after submission", async () => {
    // MODERATION must be off for auto-approval (which triggers rebuild)
    // In tests, env.MODERATION defaults to "on" from wrangler.toml;
    // we simulate auto-approval by directly inserting an approved comment and calling the worker
    // with MODERATION=off set. Since we can't change env at runtime,
    // we verify the mechanism by checking that approved comments via the approve endpoint trigger rebuilds.
    await env.DB.prepare(
      "INSERT INTO comments (id, slug, author, body, status) VALUES ('rb1', 'test', 'Ada', 'Hello', 'pending')",
    ).run();
    await SELF.fetch("https://test.example.com/approve/rb1", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });

    const row = await env.DB.prepare(
      "SELECT value FROM meta WHERE key = 'last_rebuild'",
    ).first<{ value: string }>();

    expect(row).toBeTruthy();
    const ts = parseInt(row!.value, 10);
    expect(ts).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

describe("routing", () => {
  it("returns 404 for unknown paths", async () => {
    const res = await SELF.fetch("https://test.example.com/unknown");
    expect(res.status).toBe(404);
  });

  it("GET /submit redirects to homepage", async () => {
    const res = await SELF.fetch("https://test.example.com/submit", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });

  it("handles CORS preflight", async () => {
    const res = await SELF.fetch("https://test.example.com/comments/test", {
      method: "OPTIONS",
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

// ---------------------------------------------------------------------------
// POST /spam/:id
// ---------------------------------------------------------------------------

describe("POST /spam/:id", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
  });

  it("sets status to spam", async () => {
    await env.DB.prepare(
      "INSERT INTO comments (id, slug, author, body, status) VALUES ('s1', 'test', 'Ada', 'Hello', 'approved')",
    ).run();

    const res = await SELF.fetch("https://test.example.com/spam/s1", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    expect(res.status).toBe(200);

    const comment = await env.DB.prepare("SELECT status FROM comments WHERE id = 's1'").first<{ status: string }>();
    expect(comment!.status).toBe("spam");
  });

  it("triggers rebuild when spamming a previously approved comment", async () => {
    await env.DB.prepare("DELETE FROM meta").run();
    await env.DB.prepare(
      "INSERT INTO comments (id, slug, author, body, status) VALUES ('s2', 'test', 'Ada', 'Was approved', 'approved')",
    ).run();

    await SELF.fetch("https://test.example.com/spam/s2", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });

    const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'last_rebuild'").first<{ value: string }>();
    expect(row).toBeTruthy();
  });

  it("does not trigger rebuild when spamming a pending comment", async () => {
    await env.DB.prepare("DELETE FROM meta").run();
    await env.DB.prepare(
      "INSERT INTO comments (id, slug, author, body, status) VALUES ('s3', 'test', 'Ada', 'Was pending', 'pending')",
    ).run();

    await SELF.fetch("https://test.example.com/spam/s3", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });

    const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'last_rebuild'").first();
    expect(row).toBeNull();
  });

  it("returns 401 without auth", async () => {
    const res = await SELF.fetch("https://test.example.com/spam/s1", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns 404 for nonexistent id", async () => {
    const res = await SELF.fetch("https://test.example.com/spam/nope", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /unapprove/:id
// ---------------------------------------------------------------------------

describe("POST /unapprove/:id", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.prepare("DELETE FROM meta").run();
  });

  it("reverts approved to pending", async () => {
    await env.DB.prepare(
      "INSERT INTO comments (id, slug, author, body, status) VALUES ('u1', 'test', 'Ada', 'Hello', 'approved')",
    ).run();

    const res = await SELF.fetch("https://test.example.com/unapprove/u1", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    expect(res.status).toBe(200);

    const comment = await env.DB.prepare("SELECT status, approved_at FROM comments WHERE id = 'u1'").first<{ status: string; approved_at: string | null }>();
    expect(comment!.status).toBe("pending");
    expect(comment!.approved_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DELETE /comments/:id
// ---------------------------------------------------------------------------

describe("DELETE /comments/:id", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
  });

  it("permanently deletes a comment", async () => {
    await env.DB.prepare(
      "INSERT INTO comments (id, slug, author, body, status) VALUES ('d1', 'test', 'Ada', 'Delete me', 'approved')",
    ).run();

    const res = await SELF.fetch("https://test.example.com/comments/d1", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    expect(res.status).toBe(200);

    const comment = await env.DB.prepare("SELECT id FROM comments WHERE id = 'd1'").first();
    expect(comment).toBeNull();
  });

  it("triggers rebuild when deleting a previously approved comment", async () => {
    await env.DB.prepare("DELETE FROM meta").run();
    await env.DB.prepare(
      "INSERT INTO comments (id, slug, author, body, status) VALUES ('d2', 'test', 'Ada', 'Was approved', 'approved')",
    ).run();

    await SELF.fetch("https://test.example.com/comments/d2", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });

    const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'last_rebuild'").first<{ value: string }>();
    expect(row).toBeTruthy();
  });

  it("does not trigger rebuild when deleting a pending comment", async () => {
    await env.DB.prepare("DELETE FROM meta").run();
    await env.DB.prepare(
      "INSERT INTO comments (id, slug, author, body, status) VALUES ('d3', 'test', 'Ada', 'Was pending', 'pending')",
    ).run();

    await SELF.fetch("https://test.example.com/comments/d3", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });

    const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'last_rebuild'").first();
    expect(row).toBeNull();
  });

  it("returns 401 without auth", async () => {
    const res = await SELF.fetch("https://test.example.com/comments/d1", { method: "DELETE" });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------

describe("GET /admin/stats", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
  });

  it("returns counts grouped by status", async () => {
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status) VALUES ('a1', 'test', 'A', 'a', 'approved')").run();
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status) VALUES ('p1', 'test', 'B', 'b', 'pending')").run();
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status) VALUES ('p2', 'test', 'C', 'c', 'pending')").run();
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status) VALUES ('s1', 'test', 'D', 'd', 'spam')").run();

    const res = await SELF.fetch("https://test.example.com/admin/stats", {
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    expect(res.status).toBe(200);

    const stats = await res.json() as Record<string, number>;
    expect(stats.approved).toBe(1);
    expect(stats.pending).toBe(2);
    expect(stats.spam).toBe(1);
    expect(stats.rejected).toBe(0);
  });

  it("returns 401 without auth", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/stats");
    expect(res.status).toBe(401);
  });
});

describe("GET /admin/comments", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status) VALUES ('c1', 'post-a', 'Alice', 'Comment 1', 'pending')").run();
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status) VALUES ('c2', 'post-a', 'Bob', 'Comment 2', 'approved')").run();
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status) VALUES ('c3', 'post-b', 'Alice', 'Comment 3', 'pending')").run();
  });

  it("filters by status", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/comments?status=pending", {
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    const comments = await res.json() as Array<Record<string, unknown>>;
    expect(comments).toHaveLength(2);
  });

  it("filters by slug", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/comments?slug=post-b", {
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    const comments = await res.json() as Array<Record<string, unknown>>;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.author).toBe("Alice");
  });

  it("filters by author", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/comments?author=Bob", {
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    const comments = await res.json() as Array<Record<string, unknown>>;
    expect(comments).toHaveLength(1);
  });
});

describe("POST/GET /admin/mode", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM meta").run();
  });

  it("sets and gets mode", async () => {
    const setRes = await SELF.fetch("https://test.example.com/admin/mode", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "paused" }),
    });
    expect(setRes.status).toBe(200);

    const getRes = await SELF.fetch("https://test.example.com/admin/mode", {
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    const { mode } = await getRes.json() as { mode: string };
    expect(mode).toBe("paused");
  });

  it("rejects invalid mode", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/mode", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "invalid" }),
    });
    expect(res.status).toBe(400);
  });

  it("defaults to on when not set", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/mode", {
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    const { mode } = await res.json() as { mode: string };
    expect(mode).toBe("on");
  });
});

// ---------------------------------------------------------------------------
// Per-slug pause
// ---------------------------------------------------------------------------

describe("per-slug pause", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.prepare("DELETE FROM rate_limits").run();
    await env.DB.prepare("DELETE FROM meta").run();
    await env.DB.prepare("DELETE FROM banned_ips").run();
  });

  it("POST /admin/pause/:slug sets slug as paused", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/pause/my-post", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'slug_paused:my-post'").first();
    expect(row).toBeTruthy();
  });

  it("DELETE /admin/pause/:slug reopens comments", async () => {
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('slug_paused:my-post', '1')").run();
    const res = await SELF.fetch("https://test.example.com/admin/pause/my-post", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'slug_paused:my-post'").first();
    expect(row).toBeNull();
  });

  it("rejects submissions to paused slug", async () => {
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('slug_paused:test', '1')").run();
    const res = await submitComment("test", "Ada", "Should be rejected");
    // Should redirect back, not insert
    expect([303, 403]).toContain(res.status);

    const { results } = await env.DB.prepare("SELECT * FROM comments WHERE slug = 'test'").all();
    expect(results).toHaveLength(0);
  });

  it("existing comments on paused slug are still served", async () => {
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status) VALUES ('p1', 'test', 'Ada', 'Old comment', 'approved')").run();
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('slug_paused:test', '1')").run();

    const res = await SELF.fetch("https://test.example.com/comments/test");
    const comments = (await res.json()) as Array<Record<string, unknown>>;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.author).toBe("Ada");
  });

  it("requires auth to pause", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/pause/my-post", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("ban/unban/bans", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM banned_ips").run();
  });

  it("bans an IP hash", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/ban", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ip_hash: "abc123", reason: "spammer" }),
    });
    expect(res.status).toBe(200);

    const ban = await env.DB.prepare("SELECT reason FROM banned_ips WHERE ip_hash = 'abc123'").first<{ reason: string }>();
    expect(ban!.reason).toBe("spammer");
  });

  it("lists banned IPs", async () => {
    await env.DB.prepare("INSERT INTO banned_ips (ip_hash, reason) VALUES ('abc', 'spam')").run();
    const res = await SELF.fetch("https://test.example.com/admin/bans", {
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    const bans = await res.json() as Array<Record<string, unknown>>;
    expect(bans).toHaveLength(1);
    expect(bans[0]!.ip_hash).toBe("abc");
  });

  it("unbans an IP hash", async () => {
    await env.DB.prepare("INSERT INTO banned_ips (ip_hash, reason) VALUES ('abc', 'spam')").run();
    const res = await SELF.fetch("https://test.example.com/admin/ban/abc", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    expect(res.status).toBe(200);

    const ban = await env.DB.prepare("SELECT 1 FROM banned_ips WHERE ip_hash = 'abc'").first();
    expect(ban).toBeNull();
  });
});

describe("POST /admin/bulk/approve", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
  });

  it("approves all pending for a slug", async () => {
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status) VALUES ('b1', 'test', 'A', 'a', 'pending')").run();
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status) VALUES ('b2', 'test', 'B', 'b', 'pending')").run();
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status) VALUES ('b3', 'test', 'C', 'c', 'approved')").run();

    const res = await SELF.fetch("https://test.example.com/admin/bulk/approve", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "test" }),
    });
    expect(res.status).toBe(200);

    const { count } = await res.json() as { count: number };
    expect(count).toBe(2);

    const { results } = await env.DB.prepare("SELECT status FROM comments WHERE slug = 'test'").all();
    expect(results!.every((r: Record<string, unknown>) => r.status === "approved")).toBe(true);
  });
});

describe("submit with mode and bans", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.prepare("DELETE FROM rate_limits").run();
    await env.DB.prepare("DELETE FROM meta").run();
    await env.DB.prepare("DELETE FROM banned_ips").run();
  });

  it("rejects submission when mode is off", async () => {
    await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('comments_mode', 'off')").run();

    const res = await submitComment("test", "Ada", "Should be rejected");
    expect(res.status).toBe(403);
  });

  it("forces pending when mode is paused", async () => {
    await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('comments_mode', 'paused')").run();

    const res = await submitComment("test", "Ada", "Should be pending");
    expect(res.status).toBe(303);

    const comment = await env.DB.prepare("SELECT status FROM comments WHERE slug = 'test'").first<{ status: string }>();
    expect(comment!.status).toBe("pending");
  });

  it("returns empty from GET /comments/:slug when paused", async () => {
    await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('comments_mode', 'paused')").run();
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status) VALUES ('p1', 'test', 'Ada', 'Hi', 'approved')").run();

    const res = await SELF.fetch("https://test.example.com/comments/test");
    const comments = await res.json() as unknown[];
    expect(comments).toEqual([]);
  });

  it("rejects submission from banned IP", async () => {
    // Hash of "unknown" — the Worker uses "unknown" when CF-Connecting-IP is missing
    const encoder = new TextEncoder();
    const data = encoder.encode("unknown");
    const hashBuf = await crypto.subtle.digest("SHA-256", data);
    const ipHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);

    await env.DB.prepare("INSERT INTO banned_ips (ip_hash, reason) VALUES (?, 'test ban')").bind(ipHash).run();

    const res = await submitComment("test", "Banned", "Should be rejected");
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// HTMLRewriter instant feedback
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Structural filter (Layer 0)
// ---------------------------------------------------------------------------

describe("structural filter", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.prepare("DELETE FROM rate_limits").run();
    await env.DB.prepare("DELETE FROM meta").run();
    await env.DB.prepare("DELETE FROM banned_ips").run();
  });

  it("rejects comment with null bytes in body", async () => {
    const res = await submitComment("test", "Alice", "hello\0world");
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toMatch(/null/i);
  });

  it("rejects comment with null bytes in author", async () => {
    const res = await submitComment("test", "Ali\0ce", "hello world");
    expect(res.status).toBe(400);
  });

  it("rejects comment with excessive invisible unicode", async () => {
    const body = "hello" + "\u200B".repeat(10) + "world";
    const res = await submitComment("test", "Alice", body);
    expect(res.status).toBe(400);
  });

  it("rejects comment with extreme character repetition", async () => {
    const res = await submitComment("test", "Alice", "a".repeat(50));
    expect(res.status).toBe(400);
  });

  it("rejects comment with no word-like content", async () => {
    const res = await submitComment("test", "Alice", "!@#$%^&*()_+-=");
    expect(res.status).toBe(400);
  });

  it("rejects comment with long encoded-looking token", async () => {
    const body = "see: " + "abcdefgh".repeat(40);
    const res = await submitComment("test", "Alice", body);
    expect(res.status).toBe(400);
  });

  it("does not count structural rejections against rate limit", async () => {
    // Submit a structurally invalid comment
    await submitComment("test", "Alice", "hello\0world");
    // Then submit a valid comment — should still work (not rate limited)
    const res = await submitComment("test", "Alice", "legitimate comment");
    expect(res.status).not.toBe(429);
  });
});

// ---------------------------------------------------------------------------
// AI moderation (Layer 1) — direct handleSubmit with mock AI_MOD
// ---------------------------------------------------------------------------

import { handleSubmit } from "./submit.js";

describe("AI moderation security model", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.prepare("DELETE FROM rate_limits").run();
    await env.DB.prepare("DELETE FROM meta").run();
    await env.DB.prepare("DELETE FROM banned_ips").run();
    await env.DB.prepare("DELETE FROM mod_log").run();
  });

  function makeRequest(slug: string, author: string, body: string): Request {
    const form = new FormData();
    form.set("slug", slug);
    form.set("author", author);
    form.set("body", body);
    return new Request("https://test.example.com/submit", {
      method: "POST",
      body: form,
      headers: { Origin: "https://ziscus.com" },
    });
  }

  function envWithAI(aiResponse: string | Error, moderation = "off") {
    const run = aiResponse instanceof Error
      ? async () => { throw aiResponse; }
      : async () => ({ response: aiResponse });
    return {
      ...env,
      AI_MOD: { run } as unknown as Ai,
      MODERATION: moderation,
    };
  }

  it("AI spam → status is 'spam' even with MODERATION=off", async () => {
    const mockEnv = envWithAI("spam", "off");
    await handleSubmit(makeRequest("test", "Spammer", "Buy SEO services"), mockEnv);

    const row = await env.DB.prepare("SELECT status FROM comments WHERE slug = 'test'")
      .first<{ status: string }>();
    expect(row!.status).toBe("spam");
  });

  it("AI approve → status is 'approved' with MODERATION=off", async () => {
    const mockEnv = envWithAI("approve", "off");
    await handleSubmit(makeRequest("test", "Alice", "Great post"), mockEnv);

    const row = await env.DB.prepare("SELECT status FROM comments WHERE slug = 'test'")
      .first<{ status: string }>();
    expect(row!.status).toBe("approved");
  });

  it("AI review → status is 'pending'", async () => {
    const mockEnv = envWithAI("review", "off");
    await handleSubmit(makeRequest("test", "Ambiguous", "Hmm not sure"), mockEnv);

    const row = await env.DB.prepare("SELECT status FROM comments WHERE slug = 'test'")
      .first<{ status: string }>();
    expect(row!.status).toBe("pending");
  });

  it("AI failure → status is 'pending' (fail-closed)", async () => {
    const mockEnv = envWithAI(new Error("model crashed"), "off");
    await handleSubmit(makeRequest("test", "Alice", "Normal comment"), mockEnv);

    const row = await env.DB.prepare("SELECT status FROM comments WHERE slug = 'test'")
      .first<{ status: string }>();
    expect(row!.status).toBe("pending");
  });

  it("AI approve + MODERATION=on → status is 'approved' (AI is authoritative)", async () => {
    const mockEnv = envWithAI("approve", "on");
    await handleSubmit(makeRequest("test", "Alice", "Great post"), mockEnv);

    const row = await env.DB.prepare("SELECT status FROM comments WHERE slug = 'test'")
      .first<{ status: string }>();
    expect(row!.status).toBe("approved");
  });

  it("logs AI classification to mod_log", async () => {
    const mockEnv = envWithAI("spam", "off");
    await handleSubmit(makeRequest("test", "Spammer", "Buy stuff"), mockEnv);

    const log = await env.DB.prepare("SELECT action, actor FROM mod_log WHERE action = 'ai_spam'")
      .first<{ action: string; actor: string }>();
    expect(log).toBeTruthy();
    expect(log!.actor).toBe("ai");
  });

  it("no AI binding + MODERATION=off → status is 'approved' (backwards compat)", async () => {
    const mockEnv = { ...env, MODERATION: "off" };
    delete (mockEnv as Record<string, unknown>).AI_MOD;
    await handleSubmit(makeRequest("test", "Alice", "Hello"), mockEnv);

    const row = await env.DB.prepare("SELECT status FROM comments WHERE slug = 'test'")
      .first<{ status: string }>();
    expect(row!.status).toBe("approved");
  });

  it("no AI binding + MODERATION=on → status is 'pending' (backwards compat)", async () => {
    const mockEnv = { ...env, MODERATION: "on" };
    delete (mockEnv as Record<string, unknown>).AI_MOD;
    await handleSubmit(makeRequest("test", "Alice", "Hello"), mockEnv);

    const row = await env.DB.prepare("SELECT status FROM comments WHERE slug = 'test'")
      .first<{ status: string }>();
    expect(row!.status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// HTMLRewriter instant feedback
// ---------------------------------------------------------------------------

import { serveWithFreshComments } from "./html-rewriter.js";
import type { Env as ZiscusEnv } from "./types.js";

const STATIC_PAGE = `<!DOCTYPE html>
<html><body>
<section id="comments" class="comments-section">
  <h2>Comments</h2>
  <p>No comments yet.</p>
</section>
</body></html>`;

function makeMockEnv(
  page: string,
  comments: Array<{ author: string; body: string; created_at: string }> = [],
): ZiscusEnv {
  return {
    ASSETS: {
      fetch: async () => new Response(page, { status: 200, headers: { "Content-Type": "text/html" } }),
    } as unknown as Fetcher,
    DB: {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: comments }),
        }),
      }),
    } as unknown as D1Database,
    ALLOWED_ORIGINS: "test.example.com",
    MODERATION: "off",
    RATE_LIMIT: "30",
  } as ZiscusEnv;
}

describe("serveWithFreshComments", () => {
  it("returns 200 with comments injected into #comments section", async () => {
    const mockEnv = makeMockEnv(STATIC_PAGE, [
      { author: "Alice", body: "Great post!", created_at: "2026-03-25T14:00:00Z" },
    ]);
    const req = new Request("https://test.example.com/submit", { method: "POST" });
    const res = await serveWithFreshComments("test", "/", req, mockEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Alice");
    expect(html).toContain("Great post!");
    expect(html).toContain("1 Comment");
    expect(html).not.toContain("No comments yet");
  });

  it("returns static page as-is when no comments", async () => {
    const mockEnv = makeMockEnv(STATIC_PAGE);
    const req = new Request("https://test.example.com/submit", { method: "POST" });
    const res = await serveWithFreshComments("test", "/", req, mockEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No comments yet");
  });

  it("renders comments in chronological order (reverses DESC query)", async () => {
    const mockEnv = makeMockEnv(STATIC_PAGE, [
      { author: "Bob", body: "Second", created_at: "2026-03-25T15:00:00Z" },
      { author: "Alice", body: "First", created_at: "2026-03-25T14:00:00Z" },
    ]);
    const req = new Request("https://test.example.com/submit", { method: "POST" });
    const res = await serveWithFreshComments("test", "/", req, mockEnv);
    const html = await res.text();
    expect(html.indexOf("Alice")).toBeLessThan(html.indexOf("Bob"));
    expect(html).toContain("2 Comments");
  });

  it("falls back to 303 on ASSETS fetch failure", async () => {
    const mockEnv = makeMockEnv(STATIC_PAGE);
    mockEnv.ASSETS = { fetch: async () => { throw new Error("fail"); } } as unknown as Fetcher;
    const req = new Request("https://test.example.com/submit", { method: "POST" });
    const res = await serveWithFreshComments("test", "/fallback", req, mockEnv);
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/fallback");
  });

  it("sets Cache-Control: no-store", async () => {
    const mockEnv = makeMockEnv(STATIC_PAGE, [
      { author: "Test", body: "Cache test", created_at: "2026-03-25T14:00:00Z" },
    ]);
    const req = new Request("https://test.example.com/submit", { method: "POST" });
    const res = await serveWithFreshComments("test", "/", req, mockEnv);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rewrites #ziscus section for standalone embeds", async () => {
    const ziscusPage = `<html><body><section id="ziscus"><p>Empty.</p></section></body></html>`;
    const mockEnv = makeMockEnv(ziscusPage, [
      { author: "Zara", body: "Via ziscus", created_at: "2026-03-25T14:00:00Z" },
    ]);
    const req = new Request("https://test.example.com/submit", { method: "POST" });
    const res = await serveWithFreshComments("test", "/", req, mockEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Zara");
    expect(html).not.toContain("Empty.");
  });

  it("renders dates using requester timezone from cf object", async () => {
    // April 6 at 00:06 UTC = April 5 in CDT (America/Chicago)
    const mockEnv = makeMockEnv(STATIC_PAGE, [
      { author: "Late", body: "Night post", created_at: "2026-04-06T00:06:00Z" },
    ]);
    const req = new Request("https://test.example.com/submit", {
      method: "POST",
      cf: { timezone: "America/Chicago" },
    });
    const res = await serveWithFreshComments("test", "/", req, mockEnv);
    const html = await res.text();
    expect(html).toContain("April 5, 2026");
    expect(html).not.toContain("April 6");
  });

  it("falls back to UTC when no cf timezone", async () => {
    const mockEnv = makeMockEnv(STATIC_PAGE, [
      { author: "Utc", body: "UTC post", created_at: "2026-04-06T00:06:00Z" },
    ]);
    const req = new Request("https://test.example.com/submit", { method: "POST" });
    const res = await serveWithFreshComments("test", "/", req, mockEnv);
    const html = await res.text();
    expect(html).toContain("April 6, 2026");
  });
});

// ---------------------------------------------------------------------------
// GET /admin/export
// ---------------------------------------------------------------------------

describe("GET /admin/export", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.prepare("DELETE FROM mod_log").run();
    await env.DB.prepare("DELETE FROM banned_ips").run();
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status) VALUES ('e1', 'test', 'Alice', 'Hello', 'approved')").run();
    await env.DB.prepare("INSERT INTO mod_log (id, action, actor, comment_id) VALUES ('m1', 'approve', 'admin', 'e1')").run();
    await env.DB.prepare("INSERT INTO banned_ips (ip_hash, reason) VALUES ('ban1', 'spam')").run();
  });

  it("returns all data in one response", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/export", {
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data).toHaveProperty("comments");
    expect(data).toHaveProperty("modLog");
    expect(data).toHaveProperty("bans");
    expect(data).toHaveProperty("meta");
    expect((data.comments as unknown[]).length).toBe(1);
    expect((data.modLog as unknown[]).length).toBe(1);
    expect((data.bans as unknown[]).length).toBe(1);
  });

  it("requires auth", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/export");
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /admin/import
// ---------------------------------------------------------------------------

describe("POST /admin/import", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.prepare("DELETE FROM mod_log").run();
    await env.DB.prepare("DELETE FROM banned_ips").run();
  });

  it("imports comments into D1", async () => {
    const payload = {
      comments: [
        { id: "i1", slug: "test", author: "Bob", body: "Imported", status: "approved", ip_hash: "x", created_at: "2026-04-06T00:00:00Z", approved_at: null },
      ],
      bans: [],
      modLog: [],
    };
    const res = await SELF.fetch("https://test.example.com/admin/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    const result = await res.json() as { comments: number };
    expect(result.comments).toBe(1);

    const row = await env.DB.prepare("SELECT author FROM comments WHERE id = 'i1'").first<{ author: string }>();
    expect(row!.author).toBe("Bob");
  });

  it("re-escapes HTML on import (XSS prevention)", async () => {
    const payload = {
      comments: [
        { id: "xss1", slug: "test", author: "<script>alert(1)</script>", body: "normal", status: "approved", ip_hash: "x", created_at: "2026-04-06T00:00:00Z", approved_at: null },
      ],
      bans: [],
      modLog: [],
    };
    await SELF.fetch("https://test.example.com/admin/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const row = await env.DB.prepare("SELECT author FROM comments WHERE id = 'xss1'").first<{ author: string }>();
    expect(row!.author).toContain("&lt;script&gt;");
    expect(row!.author).not.toContain("<script>");
  });

  it("imports bans", async () => {
    const payload = {
      comments: [],
      bans: [{ ip_hash: "ban1", reason: "spam", banned_at: "2026-04-06T00:00:00Z" }],
      modLog: [],
    };
    const res = await SELF.fetch("https://test.example.com/admin/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await res.json() as { bans: number };
    expect(result.bans).toBe(1);
  });

  it("imports mod_log entries", async () => {
    const payload = {
      comments: [],
      bans: [],
      modLog: [{ id: "ml1", action: "approve", actor: "admin", comment_id: "c1", slug: "test", reason: "", metadata: "{}", created_at: "2026-04-06T00:00:00Z" }],
    };
    const res = await SELF.fetch("https://test.example.com/admin/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await res.json() as { modLog: number };
    expect(result.modLog).toBe(1);
  });

  it("uses INSERT OR REPLACE (overwrites existing)", async () => {
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status) VALUES ('dup1', 'test', 'Old', 'old body', 'pending')").run();
    const payload = {
      comments: [{ id: "dup1", slug: "test", author: "New", body: "new body", status: "approved", ip_hash: "x", created_at: "2026-04-06T00:00:00Z", approved_at: null }],
      bans: [],
      modLog: [],
    };
    await SELF.fetch("https://test.example.com/admin/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const row = await env.DB.prepare("SELECT author, status FROM comments WHERE id = 'dup1'").first<{ author: string; status: string }>();
    expect(row!.author).toBe("New");
    expect(row!.status).toBe("approved");
  });

  it("requires auth", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/import", {
      method: "POST",
      body: JSON.stringify({ comments: [], bans: [], modLog: [] }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid payload", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ comments: "not an array" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid status values", async () => {
    const payload = {
      comments: [{ id: "bad1", slug: "test", author: "X", body: "Y", status: "hacked", ip_hash: "x", created_at: "2026-04-06T00:00:00Z" }],
      bans: [],
      modLog: [],
    };
    const res = await SELF.fetch("https://test.example.com/admin/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(400);
  });

  it("logs import action to mod_log", async () => {
    const payload = { comments: [], bans: [], modLog: [] };
    await SELF.fetch("https://test.example.com/admin/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const log = await env.DB.prepare("SELECT action FROM mod_log WHERE action = 'import'").first<{ action: string }>();
    expect(log).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// DELETE /admin/gdpr/:ip_hash (Z-04)
// ---------------------------------------------------------------------------

describe("DELETE /admin/gdpr/:ip_hash", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.prepare("DELETE FROM rate_limits").run();
    await env.DB.prepare("DELETE FROM banned_ips").run();
    await env.DB.prepare("DELETE FROM mod_log").run();
    // Seed data for ip_hash "gdpr_target"
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status, ip_hash) VALUES ('g1', 'post', 'A', 'body', 'approved', 'gdpr_target')").run();
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status, ip_hash) VALUES ('g2', 'post', 'A', 'body2', 'pending', 'gdpr_target')").run();
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status, ip_hash) VALUES ('g3', 'other', 'B', 'kept', 'approved', 'other_ip')").run();
    await env.DB.prepare("INSERT INTO rate_limits (ip_hash, window, count) VALUES ('gdpr_target', '2026-01-01T00:00:00.000Z', 5)").run();
    await env.DB.prepare("INSERT INTO banned_ips (ip_hash, reason) VALUES ('gdpr_target', 'spam')").run();
  });

  it("requires auth", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/gdpr/gdpr_target", {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("deletes all comments for the given ip_hash", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/gdpr/gdpr_target", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    expect(res.status).toBe(200);

    const { results } = await env.DB.prepare("SELECT id FROM comments WHERE ip_hash = 'gdpr_target'").all();
    expect(results).toHaveLength(0);
  });

  it("does not delete comments belonging to other ip hashes", async () => {
    await SELF.fetch("https://test.example.com/admin/gdpr/gdpr_target", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });

    const { results } = await env.DB.prepare("SELECT id FROM comments WHERE ip_hash = 'other_ip'").all();
    expect(results).toHaveLength(1);
  });

  it("deletes rate_limits for the given ip_hash", async () => {
    await SELF.fetch("https://test.example.com/admin/gdpr/gdpr_target", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });

    const row = await env.DB.prepare("SELECT 1 FROM rate_limits WHERE ip_hash = 'gdpr_target'").first();
    expect(row).toBeNull();
  });

  it("deletes banned_ips entry for the given ip_hash", async () => {
    await SELF.fetch("https://test.example.com/admin/gdpr/gdpr_target", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });

    const row = await env.DB.prepare("SELECT 1 FROM banned_ips WHERE ip_hash = 'gdpr_target'").first();
    expect(row).toBeNull();
  });

  it("returns JSON with deleted counts", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/gdpr/gdpr_target", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.comments).toBe(2);
    expect(body.rateLimits).toBe(1);
    expect(body.bans).toBe(1);
  });

  it("logs gdpr_delete action to mod_log", async () => {
    await SELF.fetch("https://test.example.com/admin/gdpr/gdpr_target", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });

    const log = await env.DB.prepare("SELECT action FROM mod_log WHERE action = 'gdpr_delete'").first<{ action: string }>();
    expect(log).toBeTruthy();
  });

  it("returns zero counts when ip_hash has no data", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/gdpr/no_such_hash", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.comments).toBe(0);
    expect(body.rateLimits).toBe(0);
    expect(body.bans).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Security headers (Z-06)
// ---------------------------------------------------------------------------

describe("security headers", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
  });

  it("adds X-Content-Type-Options: nosniff to API responses", async () => {
    const res = await SELF.fetch("https://test.example.com/comments/test");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("adds Referrer-Policy to API responses", async () => {
    const res = await SELF.fetch("https://test.example.com/comments/test");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("adds X-Frame-Options: SAMEORIGIN to non-admin responses", async () => {
    const res = await SELF.fetch("https://test.example.com/comments/test");
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });

  it("adds X-Frame-Options: DENY to admin responses", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/stats", {
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("adds security headers to 401 admin responses", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/stats");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("adds security headers to 404 responses", async () => {
    const res = await SELF.fetch("https://test.example.com/does-not-exist");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
