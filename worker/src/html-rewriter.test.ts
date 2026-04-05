import { describe, it, expect } from "vitest";
import { serveWithFreshComments } from "./html-rewriter.js";
import type { Env } from "./types.js";

const STATIC_PAGE = `<!DOCTYPE html>
<html><body>
<section id="comments" class="comments-section">
  <h2>Comments</h2>
  <p>No comments yet.</p>
</section>
<form class="comment-form">
  <input name="slug" value="test">
</form>
</body></html>`;

function makeMockEnv(comments: Array<{ author: string; body: string; created_at: string }> = []): Env {
  return {
    ASSETS: {
      fetch: async () => new Response(STATIC_PAGE, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
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
    RATE_LIMIT: "5",
  } as Env;
}

function makeRequest(url = "https://test.example.com/submit"): Request {
  return new Request(url, { method: "POST" });
}

describe("serveWithFreshComments", () => {
  it("returns 200 with rewritten HTML containing comments", async () => {
    const env = makeMockEnv([
      { author: "Alice", body: "Great post!", created_at: "2026-03-25T14:00:00Z" },
    ]);
    const res = await serveWithFreshComments("test", "https://test.example.com/", makeRequest(), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Alice");
    expect(html).toContain("Great post!");
    expect(html).toContain("1 Comment");
  });

  it("returns 200 with static page when no comments exist", async () => {
    const env = makeMockEnv([]);
    const res = await serveWithFreshComments("test", "https://test.example.com/", makeRequest(), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No comments yet");
  });

  it("returns 200 with multiple comments in chronological order", async () => {
    const env = makeMockEnv([
      { author: "Bob", body: "Second", created_at: "2026-03-25T15:00:00Z" },
      { author: "Alice", body: "First", created_at: "2026-03-25T14:00:00Z" },
    ]);
    const res = await serveWithFreshComments("test", "/", makeRequest(), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    // DESC query reversed to chronological: Alice first, Bob second
    const alicePos = html.indexOf("Alice");
    const bobPos = html.indexOf("Bob");
    expect(alicePos).toBeLessThan(bobPos);
    expect(html).toContain("2 Comments");
  });

  it("falls back to 303 redirect when ASSETS fetch fails", async () => {
    const env = makeMockEnv();
    env.ASSETS = {
      fetch: async () => { throw new Error("network error"); },
    } as unknown as Fetcher;
    const res = await serveWithFreshComments("test", "https://test.example.com/", makeRequest(), env);
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("https://test.example.com/");
  });

  it("falls back to 303 when ASSETS returns non-200", async () => {
    const env = makeMockEnv();
    env.ASSETS = {
      fetch: async () => new Response("Not found", { status: 404 }),
    } as unknown as Fetcher;
    const res = await serveWithFreshComments("test", "/fallback", makeRequest(), env);
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/fallback");
  });

  it("handles relative redirect URLs", async () => {
    const env = makeMockEnv([
      { author: "Test", body: "Works", created_at: "2026-03-25T14:00:00Z" },
    ]);
    const res = await serveWithFreshComments("test", "/", makeRequest(), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Test");
  });

  it("sets Cache-Control: no-store on success", async () => {
    const env = makeMockEnv([
      { author: "Test", body: "Works", created_at: "2026-03-25T14:00:00Z" },
    ]);
    const res = await serveWithFreshComments("test", "/", makeRequest(), env);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("works with #ziscus section ID too", async () => {
    const ziscusPage = `<html><body><section id="ziscus"><p>No comments.</p></section></body></html>`;
    const env = makeMockEnv([
      { author: "Zara", body: "Via ziscus ID", created_at: "2026-03-25T14:00:00Z" },
    ]);
    env.ASSETS = {
      fetch: async () => new Response(ziscusPage, { status: 200 }),
    } as unknown as Fetcher;
    const res = await serveWithFreshComments("test", "/", makeRequest(), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Zara");
    expect(html).toContain("Via ziscus ID");
  });
});
