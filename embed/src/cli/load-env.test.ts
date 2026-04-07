import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "./load-env.js";

describe("loadEnvFile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ziscus-env-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    // Clean up any env vars we set
    delete process.env.TEST_VAR_A;
    delete process.env.TEST_VAR_B;
  });

  it("loads key=value pairs into process.env", async () => {
    await writeFile(join(dir, ".env"), "TEST_VAR_A=hello\nTEST_VAR_B=world\n");
    loadEnvFile(join(dir, ".env"));
    expect(process.env.TEST_VAR_A).toBe("hello");
    expect(process.env.TEST_VAR_B).toBe("world");
  });

  it("does not override existing env vars", async () => {
    process.env.TEST_VAR_A = "existing";
    await writeFile(join(dir, ".env"), "TEST_VAR_A=overwritten\n");
    loadEnvFile(join(dir, ".env"));
    expect(process.env.TEST_VAR_A).toBe("existing");
  });

  it("skips blank lines and comments", async () => {
    await writeFile(join(dir, ".env"), "# comment\n\nTEST_VAR_A=yes\n\n# another\n");
    loadEnvFile(join(dir, ".env"));
    expect(process.env.TEST_VAR_A).toBe("yes");
  });

  it("handles values containing equals signs", async () => {
    await writeFile(join(dir, ".env"), "TEST_VAR_A=abc=def=ghi\n");
    loadEnvFile(join(dir, ".env"));
    expect(process.env.TEST_VAR_A).toBe("abc=def=ghi");
  });

  it("silently does nothing when .env file is missing", () => {
    expect(() => loadEnvFile(join(dir, ".env"))).not.toThrow();
  });
});
