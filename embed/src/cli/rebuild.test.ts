import { describe, it, expect, afterEach, vi } from "vitest";
import { runRebuild } from "./rebuild.js";

const OK_200 = { ok: true, dispatched: true, slug: "landing", status: 204 };
const GH_502 = { ok: false, dispatched: false, slug: "landing", status: 401, error: "GitHub 401: Bad credentials" };
const CFG_503 = { ok: false, dispatched: false, slug: "landing", error: "GITHUB_TOKEN or GITHUB_REPO not configured" };

function stubFetch(body: string | object, status: number) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const mock = vi.fn().mockResolvedValue(new Response(text, { status }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

function lastRequest(): { url: string; init: RequestInit } {
  const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
  return { url, init };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runRebuild", () => {
  describe("request", () => {
    it("POSTs JSON to <endpoint>/admin/rebuild with the Bearer secret", async () => {
      stubFetch(OK_200, 200);
      await runRebuild({ endpoint: "https://e.com", secret: "s3cret", slug: "landing" });
      const { url, init } = lastRequest();
      expect(url).toBe("https://e.com/admin/rebuild");
      expect(url.endsWith("/admin/rebuild")).toBe(true);
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({
        Authorization: "Bearer s3cret",
        "Content-Type": "application/json",
      });
    });

    it("includes slug in the JSON body when given", async () => {
      stubFetch(OK_200, 200);
      await runRebuild({ endpoint: "https://e.com", secret: "s", slug: "landing" });
      expect(JSON.parse(lastRequest().init.body as string)).toEqual({ slug: "landing" });
    });

    it("omits the slug key when not given", async () => {
      stubFetch(OK_200, 200);
      await runRebuild({ endpoint: "https://e.com", secret: "s" });
      const body = JSON.parse(lastRequest().init.body as string);
      expect(body).toEqual({});
      expect("slug" in body).toBe(false);
    });

    it("tolerates a trailing slash on the endpoint", async () => {
      stubFetch(OK_200, 200);
      await runRebuild({ endpoint: "https://e.com/", secret: "s" });
      expect(lastRequest().url).toBe("https://e.com/admin/rebuild");
    });
  });

  describe("response mapping", () => {
    it("maps the 200 dispatched shape", async () => {
      stubFetch(OK_200, 200);
      const out = await runRebuild({ endpoint: "https://e.com", secret: "s", slug: "landing" });
      expect(out).toEqual({ ok: true, dispatched: true, slug: "landing", status: 204, httpStatus: 200 });
    });

    it("maps the 502 GitHub-rejected shape", async () => {
      stubFetch(GH_502, 502);
      const out = await runRebuild({ endpoint: "https://e.com", secret: "s", slug: "landing" });
      expect(out).toEqual({
        ok: false,
        dispatched: false,
        slug: "landing",
        status: 401,
        error: "GitHub 401: Bad credentials",
        httpStatus: 502,
      });
    });

    it("maps the 503 not-configured shape (no GitHub status)", async () => {
      stubFetch(CFG_503, 503);
      const out = await runRebuild({ endpoint: "https://e.com", secret: "s", slug: "landing" });
      expect(out).toEqual({
        ok: false,
        dispatched: false,
        slug: "landing",
        error: "GITHUB_TOKEN or GITHUB_REPO not configured",
        httpStatus: 503,
      });
      expect(out.status).toBeUndefined();
    });

    it("returns ok:false with httpStatus 401 for a plain-text Unauthorized body, without throwing", async () => {
      stubFetch("Unauthorized", 401);
      const out = await runRebuild({ endpoint: "https://e.com", secret: "wrong" });
      expect(out).toEqual({ ok: false, dispatched: false, httpStatus: 401, error: "Unauthorized" });
    });

    it("falls back to \"Unauthorized\" when a 401 has an empty body", async () => {
      stubFetch("", 401);
      const out = await runRebuild({ endpoint: "https://e.com", secret: "wrong" });
      expect(out.error).toBe("Unauthorized");
      expect(out.httpStatus).toBe(401);
    });

    it("returns ok:false with the response text for a non-JSON body on another status", async () => {
      stubFetch("<html>Bad Gateway</html>", 502);
      const out = await runRebuild({ endpoint: "https://e.com", secret: "s" });
      expect(out).toEqual({ ok: false, dispatched: false, httpStatus: 502, error: "<html>Bad Gateway</html>" });
    });

    it("does not treat a JSON array as an outcome object", async () => {
      stubFetch([], 200);
      const out = await runRebuild({ endpoint: "https://e.com", secret: "s" });
      expect(out.ok).toBe(false);
      expect(out.dispatched).toBe(false);
      expect(out.httpStatus).toBe(200);
    });

    it("lets genuine network errors propagate", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
      await expect(runRebuild({ endpoint: "https://e.com", secret: "s" })).rejects.toThrow("fetch failed");
    });
  });
});
