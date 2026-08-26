import { env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { triggerRebuild, getLastRebuildResult } from "./debounce.js";
import type { Env } from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mod_log (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  action TEXT NOT NULL, actor TEXT NOT NULL DEFAULT 'admin',
  comment_id TEXT, slug TEXT, reason TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
`;

async function initDb() {
  for (const stmt of SCHEMA.split(";").filter((s) => s.trim())) {
    await env.DB.prepare(stmt).run();
  }
  await env.DB.prepare("DELETE FROM meta").run();
  await env.DB.prepare("DELETE FROM mod_log").run();
}

/** Env with GitHub wired up (the real test env has GITHUB_REPO from wrangler.toml but no token). */
const ghEnv = (): Env => ({ ...env, GITHUB_TOKEN: "ghp_test", GITHUB_REPO: "acme/site" }) as Env;
const unconfiguredEnv = (): Env => ({ ...env, GITHUB_TOKEN: undefined, GITHUB_REPO: undefined }) as Env;

function interceptDispatch() {
  return fetchMock
    .get("https://api.github.com")
    .intercept({ path: "/repos/acme/site/dispatches", method: "POST" });
}

async function modLog() {
  const { results } = await env.DB
    .prepare("SELECT action, actor, slug, reason, metadata FROM mod_log ORDER BY rowid")
    .all<{ action: string; actor: string; slug: string; reason: string; metadata: string }>();
  return results ?? [];
}

async function lastRebuildTs() {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'last_rebuild'").first<{ value: string }>();
  return row?.value ?? null;
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(initDb);
afterEach(() => fetchMock.assertNoPendingInterceptors());

describe("triggerRebuild", () => {
  it("dispatches to GitHub and records success in meta and mod_log", async () => {
    interceptDispatch().reply(204);

    const result = await triggerRebuild(env.DB, ghEnv(), "landing");

    expect(result).toMatchObject({ dispatched: true, debounced: false, slug: "landing", status: 204 });
    expect(result.error).toBeUndefined();
    expect(await getLastRebuildResult(env.DB)).toMatchObject({ dispatched: true, slug: "landing" });

    const log = await modLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "rebuild_dispatched", actor: "system", slug: "landing" });
    expect(JSON.parse(log[0]!.metadata)).toMatchObject({ status: 204, forced: false });
  });

  it("sends the repository_dispatch payload GitHub expects", async () => {
    let captured: { headers: Record<string, string>; body: string } | null = null;
    interceptDispatch().reply(204, (opts) => {
      captured = { headers: opts.headers as Record<string, string>, body: String(opts.body) };
      return "";
    });

    await triggerRebuild(env.DB, ghEnv(), "post-a");

    expect(captured).not.toBeNull();
    expect(JSON.parse(captured!.body)).toEqual({ event_type: "rebuild-comments", client_payload: { slug: "post-a" } });
    expect(captured!.headers["authorization"] ?? captured!.headers["Authorization"]).toBe("token ghp_test");
  });

  it("records a GitHub rejection with status + message and logs rebuild_failed", async () => {
    interceptDispatch().reply(401, JSON.stringify({ message: "Bad credentials" }), {
      headers: { "Content-Type": "application/json" },
    });

    const result = await triggerRebuild(env.DB, ghEnv(), "landing");

    expect(result).toMatchObject({
      dispatched: false, debounced: false, slug: "landing",
      status: 401, code: "github_rejected", error: "GitHub 401: Bad credentials",
    });
    expect(await getLastRebuildResult(env.DB)).toMatchObject({ dispatched: false, status: 401 });

    const log = await modLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "rebuild_failed", actor: "system", slug: "landing", reason: "GitHub 401: Bad credentials" });
    expect(JSON.parse(log[0]!.metadata)).toMatchObject({ status: 401, code: "github_rejected" });
  });

  it("releases the debounce window after a failure so the next approval retries immediately", async () => {
    interceptDispatch().reply(401, "Unauthorized");
    const first = await triggerRebuild(env.DB, ghEnv(), "landing");
    expect(first.dispatched).toBe(false);
    expect(await lastRebuildTs()).toBe("0");

    interceptDispatch().reply(204);
    const second = await triggerRebuild(env.DB, ghEnv(), "landing");
    expect(second).toMatchObject({ dispatched: true, debounced: false });
  });

  it("debounces a second call inside the window without touching GitHub", async () => {
    interceptDispatch().reply(204);
    const first = await triggerRebuild(env.DB, ghEnv(), "landing");
    expect(first.dispatched).toBe(true);

    // No interceptor registered — a real request here would fail the afterEach / net-connect guard.
    const second = await triggerRebuild(env.DB, ghEnv(), "landing");
    expect(second).toMatchObject({ dispatched: false, debounced: true });
    expect(await modLog()).toHaveLength(1);
  });

  it("force bypasses the debounce window, claims it on success, and is attributed to the admin", async () => {
    interceptDispatch().reply(204);
    await triggerRebuild(env.DB, ghEnv(), "landing");

    interceptDispatch().reply(204);
    const forced = await triggerRebuild(env.DB, ghEnv(), "all", { force: true, actor: "admin" });
    expect(forced).toMatchObject({ dispatched: true, debounced: false, slug: "all" });

    const ts = parseInt((await lastRebuildTs()) ?? "0", 10);
    expect(ts).toBeGreaterThan(0);

    const log = await modLog();
    expect(log[1]).toMatchObject({ action: "rebuild_dispatched", actor: "admin", slug: "all" });
    expect(JSON.parse(log[1]!.metadata)).toMatchObject({ forced: true });
  });

  it("records not_configured (without mod_log noise) when GitHub is not wired up", async () => {
    const result = await triggerRebuild(env.DB, unconfiguredEnv(), "landing");

    expect(result).toMatchObject({ dispatched: false, debounced: false, code: "not_configured" });
    expect(result.error).toContain("not configured");
    expect(await getLastRebuildResult(env.DB)).toMatchObject({ code: "not_configured" });
    expect(await modLog()).toHaveLength(0);
    // The window is still claimed — the existing "stores last rebuild timestamp" contract holds.
    expect(parseInt((await lastRebuildTs()) ?? "0", 10)).toBeGreaterThan(0);
  });

  it("records network errors without throwing", async () => {
    interceptDispatch().replyWithError(new Error("ECONNRESET"));

    const result = await triggerRebuild(env.DB, ghEnv(), "landing");

    expect(result).toMatchObject({ dispatched: false, code: "network" });
    expect(result.error).toContain("ECONNRESET");
    expect((await modLog())[0]).toMatchObject({ action: "rebuild_failed" });
    expect(await lastRebuildTs()).toBe("0");
  });
});

describe("getLastRebuildResult", () => {
  it("returns null when nothing has been recorded", async () => {
    expect(await getLastRebuildResult(env.DB)).toBeNull();
  });

  it("returns null (not a throw) when the stored value is corrupt", async () => {
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('last_rebuild_result', 'not json')").run();
    expect(await getLastRebuildResult(env.DB)).toBeNull();
  });
});
