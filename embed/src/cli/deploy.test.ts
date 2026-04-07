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
} from "./deploy.js";

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
