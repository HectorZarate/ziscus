import { readFile, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";

export interface EnableOptions {
  dir: string;
  wranglerPath: string;
  deploy: boolean;
}

export interface EnableResult {
  ok: boolean;
  error?: string;
  alreadyEnabled?: boolean;
}

export async function runAiModEnable(options: EnableOptions): Promise<EnableResult> {
  const { dir, wranglerPath, deploy } = options;

  // Check ziscus.config.json exists
  try {
    await access(`${dir}/ziscus.config.json`, constants.R_OK);
  } catch {
    return { ok: false, error: "No ziscus.config.json found. Run `npx ziscus init` first." };
  }

  // Check wrangler.toml exists
  try {
    await access(wranglerPath, constants.R_OK);
  } catch {
    return { ok: false, error: `wrangler.toml not found at ${wranglerPath}` };
  }

  // Read and check if [ai] already present
  const toml = await readFile(wranglerPath, "utf-8");
  if (toml.includes("[ai]")) {
    return { ok: true, alreadyEnabled: true };
  }

  // Append [ai] binding
  const binding = '\n[ai]\nbinding = "AI"\n';
  await writeFile(wranglerPath, toml + binding);

  return { ok: true };
}

export function runAiModDisable(): string {
  return `To disable AI moderation, remove or comment out the [ai] section from your worker/wrangler.toml:

  # [ai]
  # binding = "AI"

Then redeploy: cd worker && wrangler deploy

Comments will use your MODERATION setting instead.`;
}

export async function runAiModStatus(
  endpoint: string,
  secret: string,
): Promise<{ pending: number; approved: number; rejected: number; spam: number }> {
  const res = await fetch(`${endpoint}/admin/stats`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  return res.json() as Promise<{ pending: number; approved: number; rejected: number; spam: number }>;
}
