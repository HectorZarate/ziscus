import { readFileSync } from "node:fs";

/**
 * Load a .env file into process.env. Does not override existing vars.
 * Silently does nothing if the file is missing.
 */
export function loadEnvFile(path: string): void {
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return;
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
