import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runListComments, formatComment, type AdminComment } from "./comments.js";

const SAMPLE_COMMENTS: AdminComment[] = [
  { id: "c1", slug: "landing", author: "Spammer", body: "Buy our SEO services today!\nContact me for a proposal.", status: "spam", created_at: "2026-04-07T11:00:00Z" },
  { id: "c2", slug: "landing", author: "hdz", body: "hello ziscus", status: "approved", created_at: "2026-04-06T01:00:00Z" },
  { id: "c3", slug: "post-a", author: "DMD", body: "Hi", status: "approved", created_at: "2026-04-08T09:00:00Z" },
];

describe("formatComment", () => {
  it("includes author, status, slug, and full body", () => {
    const output = formatComment(SAMPLE_COMMENTS[0]!);
    expect(output).toContain("Spammer");
    expect(output).toContain("spam");
    expect(output).toContain("landing");
    expect(output).toContain("Buy our SEO services today!");
    expect(output).toContain("Contact me for a proposal.");
  });

  it("includes timestamp", () => {
    const output = formatComment(SAMPLE_COMMENTS[0]!);
    expect(output).toContain("2026-04-07");
  });

  it("includes comment ID", () => {
    const output = formatComment(SAMPLE_COMMENTS[0]!);
    expect(output).toContain("c1");
  });
});

describe("runListComments", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_COMMENTS), { status: 200 }),
    ));
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("fetches comments from admin endpoint", async () => {
    await runListComments({ endpoint: "https://e.com", secret: "s" });
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("/admin/comments");
  });

  it("passes status filter", async () => {
    await runListComments({ endpoint: "https://e.com", secret: "s", status: "spam" });
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("status=spam");
  });

  it("returns formatted comments", async () => {
    const result = await runListComments({ endpoint: "https://e.com", secret: "s" });
    expect(result).toHaveLength(3);
    expect(result[0]).toContain("Spammer");
  });

  it("returns empty array when no comments", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]", { status: 200 })));
    const result = await runListComments({ endpoint: "https://e.com", secret: "s" });
    expect(result).toEqual([]);
  });
});
