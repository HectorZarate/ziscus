import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFetch, extractSlugsFromSitemap } from "./fetch.js";

const MOCK_COMMENTS = [
  { id: "c1", slug: "my-post", author: "Alice", body: "Great!", status: "approved", created_at: "2026-04-05T12:00:00Z" },
];

describe("runFetch", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ziscus-fetch-"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(MOCK_COMMENTS), { status: 200 }),
    ));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("fetches comments for a slug and writes JSON", async () => {
    await runFetch({ endpoint: "https://comments.example.com", slug: "my-post", outputDir: join(dir, "data", "comments") });
    const data = JSON.parse(await readFile(join(dir, "data", "comments", "my-post.json"), "utf-8"));
    expect(data).toHaveLength(1);
    expect(data[0].author).toBe("Alice");
  });

  it("creates output directory if it doesn't exist", async () => {
    await runFetch({ endpoint: "https://comments.example.com", slug: "new-post", outputDir: join(dir, "deep", "nested", "dir") });
    const data = JSON.parse(await readFile(join(dir, "deep", "nested", "dir", "new-post.json"), "utf-8"));
    expect(data).toHaveLength(1);
  });

  it("calls the correct API endpoint", async () => {
    await runFetch({ endpoint: "https://comments.example.com", slug: "test-slug", outputDir: join(dir, "out") });
    expect(fetch).toHaveBeenCalledWith("https://comments.example.com/comments/test-slug", expect.anything());
  });

  it("writes empty array when no comments", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("[]", { status: 200 }),
    ));
    await runFetch({ endpoint: "https://e.com", slug: "empty", outputDir: join(dir, "out") });
    const data = JSON.parse(await readFile(join(dir, "out", "empty.json"), "utf-8"));
    expect(data).toEqual([]);
  });
});

describe("extractSlugsFromSitemap", () => {
  it("extracts URLs from sitemap XML", () => {
    const xml = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://mysite.com/posts/hello-world/</loc></url>
  <url><loc>https://mysite.com/posts/second-post/</loc></url>
  <url><loc>https://mysite.com/about/</loc></url>
</urlset>`;
    const slugs = extractSlugsFromSitemap(xml);
    expect(slugs).toContain("hello-world");
    expect(slugs).toContain("second-post");
    expect(slugs).toContain("about");
  });

  it("extracts slug from the last path segment", () => {
    const xml = `<urlset><url><loc>https://example.com/blog/my-post/</loc></url></urlset>`;
    const slugs = extractSlugsFromSitemap(xml);
    expect(slugs).toEqual(["my-post"]);
  });

  it("returns empty array for empty sitemap", () => {
    const xml = `<urlset></urlset>`;
    expect(extractSlugsFromSitemap(xml)).toEqual([]);
  });
});
