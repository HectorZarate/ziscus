import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchComments } from "./fetch.js";
import { renderComment } from "./render.js";

/** A row exactly as the Worker returns it: author/body already HTML-escaped. */
const ESCAPED_ROW = {
  id: "c1",
  slug: "landing",
  author: "bobby tables&quot;",
  body: "Tom &amp; Jerry &lt;3 &#39;ok&#39; &gt; all",
  status: "approved",
  created_at: "2026-04-05T12:00:00Z",
};

function stubFetch(body: string, status = 200) {
  const mock = vi.fn().mockResolvedValue(new Response(body, { status }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchComments", () => {
  it("requests GET /comments/:slug on the endpoint", async () => {
    stubFetch("[]");
    await fetchComments("landing", "https://api.example.com");
    expect(fetch).toHaveBeenCalledWith("https://api.example.com/comments/landing", expect.anything());
  });

  it("decodes HTML entities in author and body to plain text", async () => {
    stubFetch(JSON.stringify([ESCAPED_ROW]));
    const [c] = await fetchComments("landing", "https://api.example.com");
    expect(c?.author).toBe(`bobby tables"`);
    expect(c?.body).toBe(`Tom & Jerry <3 'ok' > all`);
  });

  it("maps created_at to createdAt and unknown status to pending", async () => {
    stubFetch(JSON.stringify([{ ...ESCAPED_ROW, status: "weird" }]));
    const [c] = await fetchComments("landing", "https://api.example.com");
    expect(c?.createdAt).toBe("2026-04-05T12:00:00Z");
    expect(c?.status).toBe("pending");
  });

  it("returns [] on a non-ok response", async () => {
    stubFetch("Not Found", 404);
    expect(await fetchComments("landing", "https://api.example.com")).toEqual([]);
  });

  it("returns [] when the JSON body is not an array", async () => {
    stubFetch(JSON.stringify({ error: "nope" }));
    expect(await fetchComments("landing", "https://api.example.com")).toEqual([]);
  });

  it("returns [] when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await fetchComments("landing", "https://api.example.com")).toEqual([]);
    expect(error).toHaveBeenCalledOnce();
  });

  it("round-trips: API-escaped text renders with each entity exactly once", async () => {
    stubFetch(JSON.stringify([ESCAPED_ROW]));
    const [c] = await fetchComments("landing", "https://api.example.com");
    const html = renderComment(c!);
    expect(html).toContain("bobby tables&quot;");
    expect(html).toContain("Tom &amp; Jerry &lt;3 &#39;ok&#39; &gt; all");
    expect(html).not.toContain("&amp;quot;");
    expect(html).not.toContain("&amp;amp;");
    expect(html).not.toContain("&amp;lt;");
  });
});
