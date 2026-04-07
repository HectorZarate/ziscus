import { execSync as nodeExecSync } from "node:child_process";
import { randomBytes } from "node:crypto";

type ExecFn = (cmd: string, opts?: object) => Buffer;

/** Overridable for testing */
export let exec: ExecFn = (cmd, opts) => nodeExecSync(cmd, { stdio: ["pipe", "pipe", "pipe"], ...opts });

/** Replace exec for testing */
export function setExec(fn: ExecFn): void { exec = fn; }

export interface DeployContext {
  siteUrl: string;
  ssg: string;
  dbName: string;
  dbId: string;
  adminSecret: string;
  workerUrl: string;
  workerDir: string;
}

export function checkWranglerVersion(): void {
  let output: string;
  try {
    output = exec("wrangler --version").toString();
  } catch {
    throw new Error(
      "wrangler not found. Install it: npm install -g wrangler\n" +
      "Then authenticate: wrangler login",
    );
  }

  const match = output.match(/(\d+)\.\d+\.\d+/);
  if (!match) {
    throw new Error(`Could not parse wrangler version from: ${output.trim()}`);
  }

  const major = parseInt(match[1]!, 10);
  if (major < 4) {
    throw new Error(
      `wrangler ${match[0]} is too old. ziscus deploy requires >= 4.0.0.\n` +
      "Upgrade: npm install -g wrangler@latest",
    );
  }
}

export function checkWranglerAuth(): void {
  try {
    exec("wrangler whoami");
  } catch {
    throw new Error("Not authenticated with Cloudflare. Run: wrangler login");
  }
}

export function createD1Database(name: string): string {
  const output = exec(`wrangler d1 create ${name} --json`).toString();
  const parsed = JSON.parse(output) as { uuid: string };
  return parsed.uuid;
}

export function applySchema(dbName: string, schemaPath: string): void {
  exec(`wrangler d1 execute ${dbName} --remote --file=${schemaPath}`);
}

export function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

export function setWranglerSecret(name: string, value: string): void {
  exec(`echo "${value}" | wrangler secret put ${name}`, { shell: "/bin/sh" });
}

export function deployWorker(workerDir: string): string {
  const output = exec("wrangler deploy", { cwd: workerDir }).toString();
  const match = output.match(/https:\/\/[^\s]+\.workers\.dev/);
  return match ? match[0] : "";
}
