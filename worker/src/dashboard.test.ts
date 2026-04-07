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

  it("includes spam catch rate", async () => {
    const res = await SELF.fetch(`https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}`);
    const html = await res.text();
    // 2 ai_spam out of 4 total ai actions = 50%
    expect(html).toContain("50%");
  });

  it("includes pending queue", async () => {
    const res = await SELF.fetch(`https://test.example.com/admin/dashboard?token=${env.ADMIN_SECRET}`);
    const html = await res.text();
    expect(html).toContain("Pending");
    expect(html).toContain("Review me");
  });

  it("also accepts Bearer token auth", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/dashboard", {
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    expect(res.status).toBe(200);
  });
});
