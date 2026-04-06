#!/usr/bin/env node
import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFile } from "node:fs/promises";
import { runInit } from "./cli/init.js";
import { runFetch, extractSlugsFromSitemap } from "./cli/fetch.js";

const program = new Command()
  .name("ziscus")
  .description("Zero-JavaScript anonymous comment system")
  .version("0.1.0"); // Keep in sync with package.json version

program
  .command("init")
  .description("Set up ziscus for your static site")
  .option("--endpoint <url>", "Worker endpoint URL")
  .option("--ssg <name>", "Static site generator (hugo, astro, eleventy, jekyll, nextjs)")
  .option("--theme <name>", "Theme (light, dark, terminal)", "light")
  .action(async (opts) => {
    let { endpoint, ssg, theme } = opts;

    if (!endpoint || !ssg) {
      const rl = createInterface({ input: stdin, output: stdout });
      if (!endpoint) endpoint = await rl.question("Worker endpoint URL: ");
      if (!ssg) ssg = await rl.question("SSG (hugo / astro / eleventy / jekyll / nextjs): ");
      if (!theme || theme === "light") {
        const t = await rl.question("Theme (light / dark / terminal) [light]: ");
        if (t) theme = t;
      }
      rl.close();
    }

    const validSSGs = ["hugo", "astro", "eleventy", "jekyll", "nextjs"];
    if (!validSSGs.includes(ssg)) {
      console.error(`Unknown SSG: "${ssg}". Must be one of: ${validSSGs.join(", ")}`);
      process.exit(1);
    }

    await runInit({ endpoint, ssg, theme, dir: "." });
    console.log(`\n✓ ziscus initialized for ${ssg} with ${theme} theme`);
    console.log(`✓ Created ziscus.config.json`);
    console.log(`\nSee the generated files for usage instructions.`);
  });

program
  .command("fetch")
  .description("Fetch comments from the API and write JSON data files")
  .option("--slug <slug>", "Fetch comments for a single slug")
  .option("--all", "Fetch comments for all slugs")
  .option("--sitemap <url>", "Sitemap URL to extract slugs from")
  .option("--output <dir>", "Output directory for JSON files", "data/comments")
  .option("--endpoint <url>", "Worker endpoint (reads from ziscus.config.json if not set)")
  .action(async (opts) => {
    let endpoint = opts.endpoint;
    if (!endpoint) {
      try {
        const config = JSON.parse(await readFile("ziscus.config.json", "utf-8"));
        endpoint = config.endpoint;
      } catch {
        console.error("No --endpoint provided and no ziscus.config.json found.");
        process.exit(1);
      }
    }

    if (opts.slug) {
      await runFetch({ endpoint, slug: opts.slug, outputDir: opts.output });
      console.log(`✓ Fetched comments for "${opts.slug}" → ${opts.output}/${opts.slug}.json`);
    } else if (opts.all && opts.sitemap) {
      const res = await fetch(opts.sitemap);
      const xml = await res.text();
      const slugs = extractSlugsFromSitemap(xml);
      for (const slug of slugs) {
        await runFetch({ endpoint, slug, outputDir: opts.output });
      }
      console.log(`✓ Fetched comments for ${slugs.length} pages → ${opts.output}/`);
    } else {
      console.error("Provide --slug <slug> or --all --sitemap <url>");
      process.exit(1);
    }
  });

program.parse();
