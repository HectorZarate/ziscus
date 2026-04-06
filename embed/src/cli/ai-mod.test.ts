import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAiModEnable, runAiModStatus, runAiModDisable } from "./ai-mod.js";

describe("ai-mod enable", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ziscus-aimod-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("errors when ziscus.config.json is missing", async () => {
    const result = await runAiModEnable({ dir, wranglerPath: "wrangler.toml", deploy: false });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("npx ziscus init");
  });

  it("appends [ai] binding to wrangler.toml", async () => {
    await writeFile(join(dir, "ziscus.config.json"), JSON.stringify({ endpoint: "https://e.com", ssg: "hugo", theme: "light" }));
    const wranglerPath = join(dir, "wrangler.toml");
    await writeFile(wranglerPath, 'name = "test"\nmain = "src/index.ts"\n');

    const result = await runAiModEnable({ dir, wranglerPath, deploy: false });
    expect(result.ok).toBe(true);

    const toml = await readFile(wranglerPath, "utf-8");
    expect(toml).toContain("[ai]");
    expect(toml).toContain('binding = "AI"');
  });

  it("skips if [ai] binding already exists", async () => {
    await writeFile(join(dir, "ziscus.config.json"), JSON.stringify({ endpoint: "https://e.com" }));
    const wranglerPath = join(dir, "wrangler.toml");
    await writeFile(wranglerPath, 'name = "test"\n\n[ai]\nbinding = "AI"\n');

    const result = await runAiModEnable({ dir, wranglerPath, deploy: false });
    expect(result.ok).toBe(true);
    expect(result.alreadyEnabled).toBe(true);
  });

  it("errors when wrangler.toml not found", async () => {
    await writeFile(join(dir, "ziscus.config.json"), JSON.stringify({ endpoint: "https://e.com" }));
    const result = await runAiModEnable({ dir, wranglerPath: join(dir, "nonexistent.toml"), deploy: false });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("wrangler.toml");
  });
});

describe("ai-mod disable", () => {
  it("returns instructions text", () => {
    const result = runAiModDisable();
    expect(result).toContain("[ai]");
    expect(result).toContain("wrangler deploy");
  });
});

describe("ai-mod status", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ pending: 1, approved: 10, rejected: 0, spam: 2 }), { status: 200 }),
    ));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches stats from endpoint", async () => {
    const result = await runAiModStatus("https://e.com", "secret123");
    expect(result.approved).toBe(10);
    expect(result.spam).toBe(2);
    expect(result.pending).toBe(1);
  });

  it("passes auth header", async () => {
    await runAiModStatus("https://e.com", "mysecret");
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].headers.Authorization).toBe("Bearer mysecret");
  });
});
