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

  it("inserts a comment and redirects to /_fresh/<slug>", async () => {
    const res = await submitComment("test-post", "Ada", "Great article!");
    expect(res.status).toBe(303);
    const location = res.headers.get("Location")!;
    expect(location).toContain("/_fresh/test-post");

    const { results } = await env.DB.prepare(
      "SELECT * FROM comments WHERE slug = 'test-post'",
    ).all();
    expect(results).toHaveLength(1);
    expect(results[0]!.author).toBe("Ada");
    expect(results[0]!.body).toBe("Great article!");
  });

  it("redirect goes to /_fresh/<slug> for instant feedback", async () => {
    const res = await submitComment("my-page", "Bob", "Nice work!");
    expect(res.status).toBe(303);
    const location = res.headers.get("Location")!;
    expect(location).toContain("/_fresh/my-page");
  });

  it("returns 400 on missing author", async () => {
    const form = new FormData();
    form.set("slug", "test");
    form.set("body", "Hello");
    const res = await SELF.fetch("https://test.example.com/submit", {
      method: "POST",
      body: form,
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
    const res = await SELF.fetch("https://test.example.com/submit", { method: "POST", body: form, redirect: "manual" });
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
    const limit = parseInt(env.RATE_LIMIT ?? "30", 10);
    for (let i = 0; i < limit; i++) {
      const res = await submitComment("test", `User-${i}`, `Comment ${i}`);
      expect(res.status === 303 || res.status === 200).toBe(true);
    }

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

  it("returns 405 for GET /submit", async () => {
    const res = await SELF.fetch("https://test.example.com/submit");
    expect(res.status).toBe(405);
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
});
