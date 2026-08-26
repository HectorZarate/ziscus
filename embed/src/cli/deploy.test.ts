import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkWranglerVersion,
  checkWranglerAuth,
  createD1Database,
  applySchema,
  generateSecret,
  setWranglerSecret,
  deployWorker,
  setExec,
  resolveWorkerDir,
  resolveSchemaPath,
  detectGitHubRepo,
  renderWranglerToml,
  writeDatabaseId,
  scaffoldWorker,
} from "./deploy.js";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockExec = vi.fn();

beforeEach(() => {
  mockExec.mockReset();
  setExec(mockExec as unknown as (cmd: string, opts?: object) => Buffer);
});

describe("checkWranglerVersion", () => {
  it("passes for wrangler 4.x", () => {
    mockExec.mockReturnValue(Buffer.from(" ⛅️ wrangler 4.80.0\n"));
    expect(() => checkWranglerVersion()).not.toThrow();
  });

  it("passes for wrangler 5.x", () => {
    mockExec.mockReturnValue(Buffer.from(" ⛅️ wrangler 5.0.0\n"));
    expect(() => checkWranglerVersion()).not.toThrow();
  });

  it("throws for wrangler 3.x", () => {
    mockExec.mockReturnValue(Buffer.from(" ⛅️ wrangler 3.99.0\n"));
    expect(() => checkWranglerVersion()).toThrow(/4\.0\.0/);
  });

  it("throws when wrangler is not installed", () => {
    mockExec.mockImplementation(() => { throw new Error("not found"); });
    expect(() => checkWranglerVersion()).toThrow(/not found/i);
  });
});

describe("checkWranglerAuth", () => {
  it("passes when wrangler whoami succeeds", () => {
    mockExec.mockReturnValue(Buffer.from("user@example.com\n"));
    expect(() => checkWranglerAuth()).not.toThrow();
  });

  it("throws when not logged in", () => {
    mockExec.mockImplementation(() => { throw new Error("not authenticated"); });
    expect(() => checkWranglerAuth()).toThrow(/wrangler login/);
  });
});

describe("createD1Database", () => {
  it("returns database_id from JSON output", () => {
    mockExec.mockReturnValue(Buffer.from(JSON.stringify({
      uuid: "abc-123-def",
      name: "ziscus-comments",
    })));
    const result = createD1Database("ziscus-comments");
    expect(result).toBe("abc-123-def");
  });

  it("throws on wrangler error", () => {
    mockExec.mockImplementation(() => { throw new Error("failed"); });
    expect(() => createD1Database("ziscus-comments")).toThrow();
  });
});

describe("applySchema", () => {
  it("calls wrangler d1 execute with schema file and --remote", () => {
    mockExec.mockReturnValue(Buffer.from(""));
    applySchema("ziscus-comments", "/tmp/schema.sql");
    expect(mockExec).toHaveBeenCalled();
    const cmd = mockExec.mock.calls[0][0] as string;
    expect(cmd).toContain("d1 execute");
    expect(cmd).toContain("ziscus-comments");
    expect(cmd).toContain("--remote");
  });
});

describe("generateSecret", () => {
  it("returns a 64-character hex string", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[a-f0-9]{64}$/);
  });

  it("generates unique values", () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a).not.toBe(b);
  });
});

describe("setWranglerSecret", () => {
  it("pipes secret to wrangler secret put", () => {
    mockExec.mockReturnValue(Buffer.from("Success\n"));
    setWranglerSecret("ADMIN_SECRET", "my-secret-value");
    expect(mockExec).toHaveBeenCalled();
    const cmd = mockExec.mock.calls[0][0] as string;
    expect(cmd).toContain("wrangler secret put");
    expect(cmd).toContain("ADMIN_SECRET");
  });
});

describe("deployWorker", () => {
  it("returns the deploy URL from wrangler output", () => {
    mockExec.mockReturnValue(Buffer.from(
      "Uploaded ziscus (5s)\nDeployed ziscus triggers\n  https://ziscus.hdz.workers.dev\n",
    ));
    const url = deployWorker("./worker");
    expect(url).toBe("https://ziscus.hdz.workers.dev");
  });

  it("returns empty string when no URL found", () => {
    mockExec.mockReturnValue(Buffer.from("Uploaded ziscus\n"));
    const url = deployWorker("./worker");
    expect(url).toBe("");
  });

  it("throws on deploy failure", () => {
    mockExec.mockImplementation(() => { throw new Error("deploy failed"); });
    expect(() => deployWorker("./worker")).toThrow();
  });
});

describe("dependency-model scaffolding", () => {
  const OPTS = { name: "ziscus-comments", dbName: "ziscus-comments", dbId: "1111-2222", siteHost: "myblog.com", githubRepo: "me/blog" };
  let dir: string;
  let cwd: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ziscus-deploy-"));
    cwd = process.cwd();
    process.chdir(dir);
  });
  afterEach(async () => {
    process.chdir(cwd);
    await rm(dir, { recursive: true, force: true });
  });

  it("resolveWorkerDir: explicit > cloned worker/ > project root", async () => {
    expect(resolveWorkerDir("custom")).toBe("custom");
    expect(resolveWorkerDir()).toBe(".");
    await mkdir("worker"); await writeFile("worker/wrangler.toml", "");
    expect(resolveWorkerDir()).toBe("worker");
  });

  it("resolveSchemaPath: cloned repo copy, else the schema shipped in the package", async () => {
    expect(resolveSchemaPath(".")).toMatch(/schema\.sql$/);
    await mkdir("worker/src", { recursive: true }); await writeFile("worker/src/schema.sql", "");
    expect(resolveSchemaPath("worker")).toBe(join("worker", "src", "schema.sql"));
  });

  it("detectGitHubRepo parses ssh and https remotes, null otherwise", () => {
    mockExec.mockReturnValue(Buffer.from("git@github.com:me/blog.git\n"));
    expect(detectGitHubRepo()).toBe("me/blog");
    mockExec.mockReturnValue(Buffer.from("https://github.com/me/blog\n"));
    expect(detectGitHubRepo()).toBe("me/blog");
    mockExec.mockReturnValue(Buffer.from("https://gitlab.com/me/blog.git\n"));
    expect(detectGitHubRepo()).toBeNull();
    mockExec.mockImplementation(() => { throw new Error("not a git repo"); });
    expect(detectGitHubRepo()).toBeNull();
  });

  it("renderWranglerToml wires the Worker to ziscus/worker with the created database", () => {
    const toml = renderWranglerToml(OPTS);
    expect(toml).toContain('main = "worker.ts"');
    expect(toml).toContain('database_id = "1111-2222"');
    expect(toml).toContain('ALLOWED_ORIGINS = "myblog.com"');
    expect(toml).toContain('GITHUB_REPO = "me/blog"');
    expect(toml).toContain("# [assets]");
  });

  it("writeDatabaseId replaces the first database_id and reports whether it did", async () => {
    await writeFile("wrangler.toml", 'name = "x"\n[[d1_databases]]\nbinding = "DB"\ndatabase_id = "REPLACE_ME"\n');
    expect(writeDatabaseId("wrangler.toml", "abc")).toBe(true);
    expect(await readFile("wrangler.toml", "utf8")).toContain('database_id = "abc"');
    await writeFile("no-id.toml", 'name = "x"\n');
    expect(writeDatabaseId("no-id.toml", "abc")).toBe(false);
  });

  it("scaffoldWorker creates wrangler.toml + worker.ts in an empty project", async () => {
    const created = scaffoldWorker(".", OPTS);
    expect(created.sort()).toEqual(["worker.ts", "wrangler.toml"]);
    expect(await readFile("worker.ts", "utf8")).toBe('export { default } from "ziscus/worker";\n');
    expect(await readFile("wrangler.toml", "utf8")).toContain('database_id = "1111-2222"');
  });

  it("scaffoldWorker only patches database_id when wrangler.toml exists, and never overwrites an entry", async () => {
    await writeFile("wrangler.toml", 'name = "mine"\nmain = "src/index.ts"\ndatabase_id = "old"\n');
    await mkdir("src"); await writeFile("src/index.ts", "// mine");
    const created = scaffoldWorker(".", OPTS);
    expect(created).toEqual([]);
    const toml = await readFile("wrangler.toml", "utf8");
    expect(toml).toContain('name = "mine"');
    expect(toml).toContain('database_id = "1111-2222"');
    expect(await readFile("src/index.ts", "utf8")).toBe("// mine");
  });
});
