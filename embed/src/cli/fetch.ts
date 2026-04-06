import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface FetchOptions {
  endpoint: string;
  slug: string;
  outputDir: string;
}

/** Fetch approved comments for a slug and write to a JSON file. */
export async function runFetch(options: FetchOptions): Promise<void> {
  const { endpoint, slug, outputDir } = options;

  const res = await fetch(`${endpoint}/comments/${slug}`, {
    signal: AbortSignal.timeout(10000),
  });

  const comments = res.ok ? await res.json() : [];

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, `${slug}.json`),
    JSON.stringify(comments, null, 2) + "\n",
  );
}

/** Extract page slugs from a sitemap XML string. */
export function extractSlugsFromSitemap(xml: string): string[] {
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
  return urls
    .map((url) => {
      const path = new URL(url).pathname.replace(/\/+$/, "");
      const segments = path.split("/").filter(Boolean);
      return segments[segments.length - 1] ?? "";
    })
    .filter(Boolean);
}
