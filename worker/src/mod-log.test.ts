import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { logModAction } from "./mod-log.js";

const SCHEMA = `
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

async function initModLog() {
  for (const stmt of SCHEMA.split(";").filter((s) => s.trim())) {
    await env.DB.prepare(stmt).run();
  }
}

describe("logModAction", () => {
  beforeEach(async () => {
    await initModLog();
    await env.DB.prepare("DELETE FROM mod_log").run();
  });

  it("inserts a row into mod_log", async () => {
    await logModAction(env.DB, "approve", "admin", { commentId: "abc123" });
    const { results } = await env.DB.prepare("SELECT * FROM mod_log").all();
    expect(results).toHaveLength(1);
    expect(results[0]!.action).toBe("approve");
    expect(results[0]!.actor).toBe("admin");
    expect(results[0]!.comment_id).toBe("abc123");
  });

  it("stores metadata as JSON string", async () => {
    await logModAction(env.DB, "ai_spam", "ai", {
      commentId: "def456",
      slug: "landing",
      metadata: { model: "llama-3.1-8b", latency_ms: 306 },
    });
    const row = await env.DB.prepare("SELECT metadata FROM mod_log").first<{ metadata: string }>();
    const meta = JSON.parse(row!.metadata);
    expect(meta.model).toBe("llama-3.1-8b");
    expect(meta.latency_ms).toBe(306);
  });

  it("stores reason", async () => {
    await logModAction(env.DB, "ban", "admin", { reason: "repeat spammer" });
    const row = await env.DB.prepare("SELECT reason FROM mod_log").first<{ reason: string }>();
    expect(row!.reason).toBe("repeat spammer");
  });

  it("handles missing optional fields", async () => {
    await logModAction(env.DB, "mode_change", "admin");
    const row = await env.DB.prepare("SELECT * FROM mod_log").first<Record<string, unknown>>();
    expect(row!.comment_id).toBeNull();
    expect(row!.slug).toBeNull();
    expect(row!.reason).toBe("");
    expect(row!.metadata).toBe("{}");
  });

  it("sets created_at automatically", async () => {
    await logModAction(env.DB, "approve", "admin");
    const row = await env.DB.prepare("SELECT created_at FROM mod_log").first<{ created_at: string }>();
    expect(row!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("GET /admin/mod-log", () => {
  beforeEach(async () => {
    await initModLog();
    await env.DB.prepare("DELETE FROM mod_log").run();
    // Insert test entries
    await env.DB.prepare(
      "INSERT INTO mod_log (id, action, actor, comment_id, slug, metadata) VALUES ('l1', 'ai_spam', 'ai', 'c1', 'landing', '{\"model\":\"llama\"}')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO mod_log (id, action, actor, comment_id, slug) VALUES ('l2', 'approve', 'admin', 'c1', 'landing')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO mod_log (id, action, actor, slug) VALUES ('l3', 'ai_approve', 'ai', 'about')",
    ).run();
  });

  it("returns all log entries", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/mod-log", {
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    expect(res.status).toBe(200);
    const entries = await res.json() as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(3);
  });

  it("requires auth", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/mod-log");
    expect(res.status).toBe(401);
  });

  it("filters by action", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/mod-log?action=ai_spam", {
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    const entries = await res.json() as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe("ai_spam");
  });

  it("filters by actor", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/mod-log?actor=admin", {
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    const entries = await res.json() as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe("approve");
  });

  it("filters by slug", async () => {
    const res = await SELF.fetch("https://test.example.com/admin/mod-log?slug=about", {
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    const entries = await res.json() as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.slug).toBe("about");
  });
});
