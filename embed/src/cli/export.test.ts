import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExport } from "./export.js";

const MOCK_EXPORT = {
  comments: [
    { id: "c1", slug: "landing", author: "hdz", body: "hello", status: "approved", ip_hash: "abc", created_at: "2026-04-06T01:00:00Z", approved_at: null },
    { id: "c2", slug: "landing", author: "spam", body: "buy seo", status: "spam", ip_hash: "def", created_at: "2026-04-06T02:00:00Z", approved_at: null },
  ],
  modLog: [
    { id: "l1", action: "ai_approve", actor: "ai", comment_id: "c1", slug: "landing", reason: "", metadata: "{}", created_at: "2026-04-06T01:00:00Z" },
  ],
  bans: [{ ip_hash: "abc123", reason: "spam", banned_at: "2026-04-06T01:00:00Z" }],
  meta: { mode: "off" },
};

describe("runExport", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ziscus-export-"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(MOCK_EXPORT), { status: 200 }),
    ));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("writes comments.json", async () => {
    await runExport({ endpoint: "https://e.com", secret: "s", outputDir: dir });
    const data = JSON.parse(await readFile(join(dir, "comments.json"), "utf-8"));
    expect(data).toHaveLength(2);
    expect(data[0].author).toBe("hdz");
  });

  it("writes mod-log.json", async () => {
    await runExport({ endpoint: "https://e.com", secret: "s", outputDir: dir });
    const data = JSON.parse(await readFile(join(dir, "mod-log.json"), "utf-8"));
    expect(data).toHaveLength(1);
    expect(data[0].action).toBe("ai_approve");
  });

  it("writes banned-ips.json", async () => {
    await runExport({ endpoint: "https://e.com", secret: "s", outputDir: dir });
    const data = JSON.parse(await readFile(join(dir, "banned-ips.json"), "utf-8"));
    expect(data).toHaveLength(1);
  });

  it("writes meta.json", async () => {
    await runExport({ endpoint: "https://e.com", secret: "s", outputDir: dir });
    const data = JSON.parse(await readFile(join(dir, "meta.json"), "utf-8"));
    expect(data.mode).toBe("off");
  });

  it("creates output directory if missing", async () => {
    const nested = join(dir, "deep", "backups");
    await runExport({ endpoint: "https://e.com", secret: "s", outputDir: nested });
    const data = JSON.parse(await readFile(join(nested, "comments.json"), "utf-8"));
    expect(data).toHaveLength(2);
  });

  it("passes auth header", async () => {
    await runExport({ endpoint: "https://e.com", secret: "mysecret", outputDir: dir });
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].headers.Authorization).toBe("Bearer mysecret");
  });

  it("calls /admin/export endpoint", async () => {
    await runExport({ endpoint: "https://e.com", secret: "s", outputDir: dir });
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://e.com/admin/export");
  });

  it("writes CSV when format is csv", async () => {
    await runExport({ endpoint: "https://e.com", secret: "s", outputDir: dir, format: "csv" });
    const csv = await readFile(join(dir, "comments.csv"), "utf-8");
    expect(csv).toContain("id,slug,author");
    expect(csv).toContain("hdz");
  });

  it("handles auth failure with clear error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    ));
    await expect(runExport({ endpoint: "https://e.com", secret: "bad", outputDir: dir }))
      .rejects.toThrow(/401|auth|secret/i);
  });
});
