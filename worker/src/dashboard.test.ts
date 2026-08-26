import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  slug TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', ip_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  approved_at TEXT
);
CREATE TABLE IF NOT EXISTS mod_log (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  action TEXT NOT NULL, actor TEXT NOT NULL DEFAULT 'admin',
  comment_id TEXT, slug TEXT, reason TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS banned_ips (ip_hash TEXT PRIMARY KEY, reason TEXT NOT NULL DEFAULT '', banned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
`;

async function initDb() {
  for (const stmt of SCHEMA.split(";").filter((s) => s.trim())) {
    await env.DB.prepare(stmt).run();
  }
}

const ADMIN_AUTH = { headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` } };

describe("GET /admin/dashboard", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.prepare("DELETE FROM mod_log").run();

    // Seed data
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status) VALUES ('c1', 'post-a', 'Alice', 'Great post', 'approved')").run();
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status) VALUES ('c2', 'post-a', 'Bob', 'Thanks', 'approved')").run();
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status) VALUES ('c3', 'post-b', 'Eve', 'Nice', 'approved')").run();
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status) VALUES ('c4', 'post-a', 'Spammer', 'Buy stuff', 'spam')").run();
    await env.DB.prepare("INSERT INTO comments (id, slug, author, body, status) VALUES ('c5', 'post-b', 'Pending', 'Review me', 'pending')").run();

    await env.DB.prepare("INSERT INTO mod_log (id, action, actor, slug) VALUES ('m1', 'ai_spam', 'ai', 'post-a')").run();
    await env.DB.prepare("INSERT INTO mod_log (id, action, actor, slug) VALUES ('m2', 'ai_approve', 'ai', 'post-a')").run();
    await env.DB.prepare("INSERT INTO mod_log (id, action, actor, slug) VALUES ('m3', 'ai_approve', 'ai', 'post-b')").run();
    await env.DB.prepare("INSERT INTO mod_log (id, action, actor, slug) VALUES ('m4', 'ai_spam', 'ai', 'post-b')").run();
  });

  it("returns HTML with Bearer auth", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/dashboard", ADMIN_AUTH);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("returns 401 without token", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/dashboard");
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong token", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/dashboard", {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects query-string token (header-only auth)", async () => {
    const res = await SELF.fetch(`https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}`);
    expect(res.status).toBe(401);
  });

  it("never embeds the secret in dashboard HTML", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/dashboard", ADMIN_AUTH);
    const html = await res.text();
    expect(html).not.toContain("token=");
    expect(html).not.toContain(env.ADMIN_SECRET);
  });

  it("includes comment counts in stat widgets", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/dashboard", ADMIN_AUTH);
    const html = await res.text();
    expect(html).toContain('<div class="stat-value">3</div><div class="stat-label">Approved</div>');
    expect(html).toContain('<div class="stat-value">1</div><div class="stat-label">Pending</div>');
    expect(html).toContain('<div class="stat-value">1</div><div class="stat-label">Spam blocked</div>');
  });

  it("includes top pages by comment count", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/dashboard", ADMIN_AUTH);
    const html = await res.text();
    expect(html).toContain("post-a");
    expect(html).toContain("post-b");
  });

  it("includes recent spam with full body", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/dashboard", ADMIN_AUTH);
    const html = await res.text();
    expect(html).toContain("Recent spam");
    expect(html).toContain("Spammer");
    expect(html).toContain("Buy stuff");
  });

  it("includes pending queue", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/dashboard", ADMIN_AUTH);
    const html = await res.text();
    expect(html).toContain("Pending");
    expect(html).toContain("Review me");
  });

  it("shows current settings", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/dashboard", ADMIN_AUTH);
    const html = await res.text();
    expect(html).toContain("Comments");
    expect(html).toContain("AI Mod");
    expect(html).toContain("Moderation");
  });

  it("also accepts Bearer token auth", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/dashboard", {
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    expect(res.status).toBe(200);
  });

  it("action buttons use form POST, not inline JavaScript with token", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/dashboard", ADMIN_AUTH);
    const html = await res.text();
    // Must NOT expose token in onclick JavaScript
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("fetch('/approve");
    // Must use form POST instead
    expect(html).toContain('<form method="POST"');
    expect(html).toContain("action-btn");
    // Must never leak the secret or a token query param into the HTML
    expect(html).not.toContain("token=");
    expect(html).not.toContain(env.ADMIN_SECRET);
  });

  describe("pagination", () => {
    beforeEach(async () => {
      await env.DB.prepare("DELETE FROM comments").run();
      // Insert 25 pending comments with distinct timestamps so ORDER BY created_at DESC is deterministic.
      // Row i gets timestamp 2025-01-01T00:00:iZ, so Author25 is newest (appears first on page 1),
      // Author6 is 20th newest (last on page 1), and Author1-5 are on page 2.
      for (let i = 1; i <= 25; i++) {
        const ts = `2025-01-01T00:00:${String(i).padStart(2, "0")}Z`;
        await env.DB.prepare(
          "INSERT INTO comments (id, slug, author, body, status, created_at) VALUES (?, 'post-x', ?, ?, 'pending', ?)"
        )
          .bind(`pid${String(i).padStart(2, "0")}`, `Author${i}`, `Comment body number ${i}`, ts)
          .run();
      }
    });

    it("page=1 shows first 20 pending comments (newest first)", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?page=1`,
        ADMIN_AUTH
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      // Authors 6-25 are the 20 newest (page 1); Authors 1-5 are oldest (page 2)
      expect(html).toContain("Author25");
      expect(html).toContain("Author6");
      expect(html).not.toContain("Author5");
    });

    it("page=2 shows oldest 5 comments (different from page 1)", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?page=2`,
        ADMIN_AUTH
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      // Authors 1-5 are the 5 oldest and appear on page 2
      expect(html).toContain("Author5");
      expect(html).toContain("Author1");
      expect(html).not.toContain("Author25");
    });

    it("shows Page X of Y indicator", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?page=1`,
        ADMIN_AUTH
      );
      const html = await res.text();
      expect(html).toMatch(/Page 1 of 2/);
    });

    it("shows Showing N results count", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?page=1`,
        ADMIN_AUTH
      );
      const html = await res.text();
      expect(html).toMatch(/Showing 20 of 25/);
    });

    it("shows next link on page 1 (no token in URL)", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?page=1`,
        ADMIN_AUTH
      );
      const html = await res.text();
      expect(html).toContain(`page=2`);
      expect(html).not.toContain("token=");
    });

    it("shows prev link on page 2", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?page=2`,
        ADMIN_AUTH
      );
      const html = await res.text();
      expect(html).toContain(`page=1`);
    });

    it("does not show prev link on page 1", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?page=1`,
        ADMIN_AUTH
      );
      const html = await res.text();
      // page=1 prev link should not appear (no ?page=0)
      expect(html).not.toContain("page=0");
    });

    it("does not show next link on last page", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?page=2`,
        ADMIN_AUTH
      );
      const html = await res.text();
      expect(html).not.toContain("page=3");
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      await env.DB.prepare("DELETE FROM comments").run();
      await env.DB.prepare(
        "INSERT INTO comments (id, slug, author, body, status) VALUES ('s1', 'post-a', 'Alice', 'Hello world', 'pending')"
      ).run();
      await env.DB.prepare(
        "INSERT INTO comments (id, slug, author, body, status) VALUES ('s2', 'post-a', 'Bob', 'Goodbye world', 'pending')"
      ).run();
      await env.DB.prepare(
        "INSERT INTO comments (id, slug, author, body, status) VALUES ('s3', 'post-b', 'SearchableAuthor', 'Some text', 'pending')"
      ).run();
    });

    it("renders a search form with GET method", async () => {
      const res = await SELF.fetch(
        "https://test.example.com/admin/dashboard",
        ADMIN_AUTH
      );
      const html = await res.text();
      expect(html).toContain('<form method="GET"');
      expect(html).toContain('name="q"');
    });

    it("q=hello filters by body text", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?q=hello`,
        ADMIN_AUTH
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Hello world");
      expect(html).not.toContain("Goodbye world");
      expect(html).not.toContain("Some text");
    });

    it("q=searchableauthor filters by author (case-insensitive)", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?q=searchableauthor`,
        ADMIN_AUTH
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("SearchableAuthor");
      expect(html).not.toContain("Alice");
      expect(html).not.toContain("Bob");
    });

    it("q= with no match shows empty state", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?q=zzznomatch`,
        ADMIN_AUTH
      );
      const html = await res.text();
      expect(html).toContain("No pending comments");
    });

    it("search form preserves q value in input", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?q=hello`,
        ADMIN_AUTH
      );
      const html = await res.text();
      expect(html).toContain('value="hello"');
    });

    it("prev/next links preserve the q param", async () => {
      // Insert 25 pending items matching 'world' so pagination kicks in
      await env.DB.prepare("DELETE FROM comments").run();
      for (let i = 1; i <= 25; i++) {
        await env.DB.prepare(
          "INSERT INTO comments (id, slug, author, body, status) VALUES (?, 'post-x', ?, ?, 'pending')"
        )
          .bind(`sq${String(i).padStart(2, "0")}`, `AuthorW${i}`, `world comment ${i}`)
          .run();
      }
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?q=world&page=1`,
        ADMIN_AUTH
      );
      const html = await res.text();
      expect(html).toContain("q=world");
      expect(html).toContain("page=2");
    });
  });
});

describe("dashboard rebuild pipeline card", () => {
  beforeEach(async () => {
    await initDb();
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.prepare("DELETE FROM meta").run();
  });

  async function dashboardHtml(): Promise<string> {
    const res = await SELF.fetch("https://test.example.com/admin/dashboard", ADMIN_AUTH);
    expect(res.status).toBe(200);
    return res.text();
  }

  it("shows 'never run' before any dispatch attempt, with a rebuild-now button", async () => {
    const html = await dashboardHtml();
    expect(html).toContain("Rebuild pipeline");
    expect(html).toContain("never run");
    expect(html).toContain('action="/admin/rebuild"');
  });

  it("shows the failure reason when the last dispatch was rejected", async () => {
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('last_rebuild_result', ?)").bind(JSON.stringify({
      dispatched: false, debounced: false, slug: "landing", at: "2026-08-26T17:03:00.000Z",
      status: 401, code: "github_rejected", error: "GitHub 401: Bad credentials",
    })).run();
    const html = await dashboardHtml();
    expect(html).toContain(">failed<");
    expect(html).toContain("GitHub 401: Bad credentials");
    expect(html).toContain("2026-08-26 17:03 UTC");
  });

  it("shows ok after a successful dispatch", async () => {
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('last_rebuild_result', ?)").bind(JSON.stringify({
      dispatched: true, debounced: false, slug: "landing", at: "2026-08-26T17:03:00.000Z", status: 204,
    })).run();
    const html = await dashboardHtml();
    expect(html).toContain(">ok<");
    expect(html).toContain("dispatched 2026-08-26 17:03 UTC");
  });

  it("shows not configured when GitHub is not wired up", async () => {
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('last_rebuild_result', ?)").bind(JSON.stringify({
      dispatched: false, debounced: false, slug: "landing", at: "2026-08-26T17:03:00.000Z",
      code: "not_configured", error: "GITHUB_TOKEN or GITHUB_REPO not configured",
    })).run();
    const html = await dashboardHtml();
    expect(html).toContain(">not configured<");
  });

  it("renders stored (already-escaped) comment text exactly once", async () => {
    await env.DB.prepare(
      "INSERT INTO comments (id, slug, author, body, status) VALUES ('e1', 'post-a', 'Bob &quot;B&quot;', 'Tom &amp; Jerry &lt;3', 'pending')",
    ).run();
    const html = await dashboardHtml();
    expect(html).toContain("Bob &quot;B&quot;");
    expect(html).toContain("Tom &amp; Jerry &lt;3");
    expect(html).not.toContain("&amp;quot;");
    expect(html).not.toContain("&amp;amp;");
    expect(html).not.toContain("<3");
  });
});
