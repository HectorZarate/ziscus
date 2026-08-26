import { execSync as nodeExecSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

export function setWranglerSecret(name: string, value: string, cwd: string = "."): void {
  exec(`echo "${value}" | wrangler secret put ${name}`, { shell: "/bin/sh", cwd });
}

/**
 * Where the Worker config lives. Explicit `--worker-dir` wins; a cloned-repo
 * layout (`worker/wrangler.toml`) is honoured; otherwise the project root —
 * the dependency model, where `worker.ts` re-exports `ziscus/worker`.
 */
export function resolveWorkerDir(explicit?: string): string {
  if (explicit) return explicit;
  if (existsSync(join("worker", "wrangler.toml"))) return "worker";
  return ".";
}

/** The D1 schema: a cloned repo's copy if present, else the one shipped in this package. */
export function resolveSchemaPath(workerDir: string): string {
  const local = join(workerDir, "src", "schema.sql");
  if (existsSync(local)) return local;
  return fileURLToPath(new URL("./schema.sql", import.meta.url));
}

/** `owner/repo` from the git remote, for the GITHUB_REPO var. Null if not a GitHub remote. */
export function detectGitHubRepo(): string | null {
  try {
    const url = exec("git remote get-url origin").toString().trim();
    const m = url.match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

export interface ScaffoldOptions {
  /** Worker name on Cloudflare. */
  name: string;
  dbName: string;
  dbId: string;
  /** Hostname allowed to POST /submit (CSRF check). */
  siteHost: string;
  /** owner/repo that receives rebuild dispatches. */
  githubRepo: string;
}

export function renderWranglerToml(o: ScaffoldOptions): string {
  return `name = "${o.name}"
main = "worker.ts"
compatibility_date = "2025-09-27"

[[d1_databases]]
binding = "DB"
database_name = "${o.dbName}"
database_id = "${o.dbId}"

[vars]
ALLOWED_ORIGINS = "${o.siteHost}"   # comma-separated hosts allowed to POST /submit
MODERATION = "off"                  # "on" holds new comments for review
RATE_LIMIT = "30"                   # comments per IP per hour
GITHUB_REPO = "${o.githubRepo}"     # receives repository_dispatch rebuild triggers

# Optional: serve your static site from this Worker. Enables the instant
# "see your own comment" preview. Point \`directory\` at your build output.
# [assets]
# directory = "_site"
# binding = "ASSETS"
# run_worker_first = true

# Optional: AI spam filtering — \`npx ziscus ai-mod enable\` adds this.
# [ai]
# binding = "AI_MOD"

# Secrets (\`wrangler secret put\`): ADMIN_SECRET, GITHUB_TOKEN
`;
}

/** Point the first `database_id = "..."` in a wrangler.toml at `dbId`. Returns false if none found. */
export function writeDatabaseId(tomlPath: string, dbId: string): boolean {
  const s = readFileSync(tomlPath, "utf8");
  const next = s.replace(/^(\s*database_id\s*=\s*)"[^"]*"/m, `$1"${dbId}"`);
  if (next === s) return false;
  writeFileSync(tomlPath, next);
  return true;
}

/**
 * Make `dir` deployable: write wrangler.toml if missing (else just set its
 * database_id), and a one-line worker.ts unless a Worker entry already exists.
 * Returns the files it created.
 */
export function scaffoldWorker(dir: string, o: ScaffoldOptions): string[] {
  const created: string[] = [];
  const toml = join(dir, "wrangler.toml");
  if (existsSync(toml)) {
    writeDatabaseId(toml, o.dbId);
  } else {
    writeFileSync(toml, renderWranglerToml(o));
    created.push(toml);
  }
  const entry = join(dir, "worker.ts");
  if (!existsSync(entry) && !existsSync(join(dir, "src", "index.ts"))) {
    writeFileSync(entry, 'export { default } from "ziscus/worker";\n');
    created.push(entry);
  }
  return created;
}

export function deployWorker(workerDir: string): string {
  const output = exec("wrangler deploy", { cwd: workerDir }).toString();
  const match = output.match(/https:\/\/[^\s]+\.workers\.dev/);
  return match ? match[0] : "";
}
