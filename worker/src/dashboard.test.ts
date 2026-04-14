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

  it("returns HTML with token auth", async () => {
    const res = await SELF.fetch(`https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("returns 401 without token", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/dashboard");
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong token", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/dashboard?token=wrong");
    expect(res.status).toBe(401);
  });

  it("includes comment counts", async () => {
    const res = await SELF.fetch(`https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}`);
    const html = await res.text();
    expect(html).toContain("3"); // approved
    expect(html).toContain("1"); // spam
    expect(html).toContain("1"); // pending
  });

  it("includes top pages by comment count", async () => {
    const res = await SELF.fetch(`https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}`);
    const html = await res.text();
    expect(html).toContain("post-a");
    expect(html).toContain("post-b");
  });

  it("includes recent spam with full body", async () => {
    const res = await SELF.fetch(`https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}`);
    const html = await res.text();
    expect(html).toContain("Recent spam");
    expect(html).toContain("Spammer");
    expect(html).toContain("Buy stuff");
  });

  it("includes pending queue", async () => {
    const res = await SELF.fetch(`https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}`);
    const html = await res.text();
    expect(html).toContain("Pending");
    expect(html).toContain("Review me");
  });

  it("shows current settings", async () => {
    const res = await SELF.fetch(`https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}`);
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
    const res = await SELF.fetch(`https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}`);
    const html = await res.text();
    // Must NOT expose token in onclick JavaScript
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("fetch('/approve");
    // Must use form POST instead
    expect(html).toContain('<form method="POST"');
    expect(html).toContain("action-btn");
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
        `https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}&page=1`
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
        `https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}&page=2`
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
        `https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}&page=1`
      );
      const html = await res.text();
      expect(html).toMatch(/Page 1 of 2/);
    });

    it("shows Showing N results count", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}&page=1`
      );
      const html = await res.text();
      expect(html).toMatch(/Showing 20 of 25/);
    });

    it("shows next link on page 1 that preserves token", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}&page=1`
      );
      const html = await res.text();
      expect(html).toContain(`page=2`);
      expect(html).toContain(`token=${env.ADMIN_SECRET}`);
    });

    it("shows prev link on page 2", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}&page=2`
      );
      const html = await res.text();
      expect(html).toContain(`page=1`);
    });

    it("does not show prev link on page 1", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}&page=1`
      );
      const html = await res.text();
      // page=1 prev link should not appear (no ?page=0)
      expect(html).not.toContain("page=0");
    });

    it("does not show next link on last page", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}&page=2`
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
        `https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}`
      );
      const html = await res.text();
      expect(html).toContain('<form method="GET"');
      expect(html).toContain('name="q"');
    });

    it("q=hello filters by body text", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}&q=hello`
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Hello world");
      expect(html).not.toContain("Goodbye world");
      expect(html).not.toContain("Some text");
    });

    it("q=searchableauthor filters by author (case-insensitive)", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}&q=searchableauthor`
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("SearchableAuthor");
      expect(html).not.toContain("Alice");
      expect(html).not.toContain("Bob");
    });

    it("q= with no match shows empty state", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}&q=zzznomatch`
      );
      const html = await res.text();
      expect(html).toContain("No pending comments");
    });

    it("search form preserves q value in input", async () => {
      const res = await SELF.fetch(
        `https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}&q=hello`
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
        `https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}&q=world&page=1`
      );
      const html = await res.text();
      expect(html).toContain("q=world");
      expect(html).toContain("page=2");
    });
  });
});
