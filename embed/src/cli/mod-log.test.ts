import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runModLog, formatModLogEntry, type ModLogEntry, type CommentInfo } from "./mod-log.js";

const SAMPLE_ENTRIES: ModLogEntry[] = [
  {
    id: "aaa",
    action: "ai_spam",
    actor: "ai",
    comment_id: "c1",
    slug: "landing",
    reason: "",
    metadata: '{"model":"@cf/meta/llama-3.1-8b-instruct","latency_ms":171}',
    created_at: "2026-04-07T11:38:36Z",
  },
  {
    id: "bbb",
    action: "approve",
    actor: "admin",
    comment_id: "c2",
    slug: "landing",
    reason: "",
    metadata: "{}",
    created_at: "2026-04-07T10:00:00Z",
  },
  {
    id: "ccc",
    action: "ai_approve",
    actor: "ai",
    comment_id: "c3",
    slug: "about",
    reason: "",
    metadata: '{"model":"@cf/meta/llama-3.1-8b-instruct","latency_ms":64}',
    created_at: "2026-04-07T09:00:00Z",
  },
];

const SAMPLE_COMMENTS: CommentInfo[] = [
  { id: "c1", author: "SEO Spammer", body: "Buy our amazing SEO services today!", status: "spam" },
  { id: "c2", author: "Alice", body: "Great article, thanks for sharing!", status: "approved" },
  { id: "c3", author: "devops_dan", body: "Does D1 handle connection pooling?", status: "approved" },
];

describe("formatModLogEntry", () => {
  const commentMap = new Map(SAMPLE_COMMENTS.map((c) => [c.id, c]));

  it("includes comment author and body when comment map provided", () => {
    const line = formatModLogEntry(SAMPLE_ENTRIES[0]!, commentMap);
    expect(line).toContain("SEO Spammer");
    expect(line).toContain("Buy our amazing SEO");
  });

  it("truncates long comment bodies", () => {
    const longComment: CommentInfo = { id: "c1", author: "X", body: "a".repeat(200), status: "spam" };
    const map = new Map([["c1", longComment]]);
    const line = formatModLogEntry(SAMPLE_ENTRIES[0]!, map);
    expect(line.length).toBeLessThan(300);
  });

  it("shows comment_id prefix when comment not found in map", () => {
    const emptyMap = new Map<string, CommentInfo>();
    const line = formatModLogEntry(SAMPLE_ENTRIES[0]!, emptyMap);
    expect(line).toContain("c1");
    expect(line).not.toContain("SEO Spammer");
  });

  it("formats an AI spam entry with latency", () => {
    const line = formatModLogEntry(SAMPLE_ENTRIES[0]!, commentMap);
    expect(line).toContain("ai_spam");
    expect(line).toContain("ai");
    expect(line).toContain("171ms");
  });

  it("formats an admin action without latency", () => {
    const line = formatModLogEntry(SAMPLE_ENTRIES[1]!, commentMap);
    expect(line).toContain("approve");
    expect(line).toContain("admin");
    expect(line).toContain("Alice");
  });

  it("includes the timestamp", () => {
    const line = formatModLogEntry(SAMPLE_ENTRIES[0]!, commentMap);
    expect(line).toContain("2026-04-07");
  });

  it("handles entries with no comment_id", () => {
    const entry: ModLogEntry = { ...SAMPLE_ENTRIES[0]!, comment_id: null };
    const line = formatModLogEntry(entry, commentMap);
    expect(line).toContain("ai_spam");
  });
});

describe("runModLog", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/admin/mod-log")) {
          return Promise.resolve(new Response(JSON.stringify(SAMPLE_ENTRIES), { status: 200 }));
        }
        if (url.includes("/admin/comments")) {
          return Promise.resolve(new Response(JSON.stringify(SAMPLE_COMMENTS), { status: 200 }));
        }
        return Promise.resolve(new Response("Not found", { status: 404 }));
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches both mod log and comments", async () => {
    await runModLog({ endpoint: "https://e.com", secret: "s123" });
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    const urls = calls.map((c: unknown[]) => c[0] as string);
    expect(urls.some((u) => u.includes("/admin/mod-log"))).toBe(true);
    expect(urls.some((u) => u.includes("/admin/comments"))).toBe(true);
  });

  it("passes filter params as query string", async () => {
    await runModLog({ endpoint: "https://e.com", secret: "s", action: "ai_spam", actor: "ai", slug: "landing", limit: 10 });
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    const logUrl = calls.find((c: unknown[]) => (c[0] as string).includes("/admin/mod-log"))![0] as string;
    expect(logUrl).toContain("action=ai_spam");
    expect(logUrl).toContain("actor=ai");
    expect(logUrl).toContain("slug=landing");
    expect(logUrl).toContain("limit=10");
  });

  it("returns formatted entries with comment details", async () => {
    const result = await runModLog({ endpoint: "https://e.com", secret: "s" });
    expect(result).toHaveLength(3);
    expect(result[0]).toContain("SEO Spammer");
    expect(result[1]).toContain("Alice");
    expect(result[2]).toContain("devops_dan");
  });

  it("returns empty array when no entries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]", { status: 200 })));
    const result = await runModLog({ endpoint: "https://e.com", secret: "s" });
    expect(result).toEqual([]);
  });
});
