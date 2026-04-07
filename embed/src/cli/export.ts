import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ExportOptions {
  endpoint: string;
  secret: string;
  outputDir: string;
  format?: "json" | "csv";
}

interface ExportData {
  comments: Record<string, unknown>[];
  modLog: Record<string, unknown>[];
  bans: Record<string, unknown>[];
  meta: Record<string, unknown>;
}

export async function runExport(options: ExportOptions): Promise<void> {
  const { endpoint, secret, outputDir, format = "json" } = options;

  const res = await fetch(`${endpoint}/admin/export`, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Authentication failed (401). Check your ZISCUS_ADMIN_SECRET.");
    }
    throw new Error(`Export failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as ExportData;

  await mkdir(outputDir, { recursive: true });

  if (format === "csv") {
    await writeFile(join(outputDir, "comments.csv"), toCsv(data.comments));
    await writeFile(join(outputDir, "mod-log.csv"), toCsv(data.modLog));
  } else {
    await writeFile(join(outputDir, "comments.json"), JSON.stringify(data.comments, null, 2) + "\n");
    await writeFile(join(outputDir, "mod-log.json"), JSON.stringify(data.modLog, null, 2) + "\n");
  }

  await writeFile(join(outputDir, "banned-ips.json"), JSON.stringify(data.bans, null, 2) + "\n");
  await writeFile(join(outputDir, "meta.json"), JSON.stringify(data.meta, null, 2) + "\n");
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(String(row[h] ?? ""))).join(","));
  }
  return lines.join("\n") + "\n";
}

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
