#!/usr/bin/env node
import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInit } from "./cli/init.js";
import { runFetch, extractSlugsFromSitemap } from "./cli/fetch.js";
import { runAiModEnable, runAiModDisable, runAiModStatus } from "./cli/ai-mod.js";
import { runExport } from "./cli/export.js";
import { runModLog } from "./cli/mod-log.js";
import { loadEnvFile } from "./cli/load-env.js";
import {
  checkWranglerVersion,
  checkWranglerAuth,
  createD1Database,
  applySchema,
  generateSecret,
  setWranglerSecret,
  deployWorker,
} from "./cli/deploy.js";

// Auto-load .env from project root (does not override existing vars)
loadEnvFile(resolve(process.cwd(), ".env"));

const program = new Command()
  .name("ziscus")
  .description("Zero-JavaScript anonymous comment system")
  .version("0.3.0"); // Keep in sync with package.json version

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
  .command("deploy")
  .description("Deploy the ziscus Worker to Cloudflare (creates D1 database, sets secrets, deploys)")
  .option("--ssg <name>", "Static site generator (hugo, astro, eleventy, jekyll, nextjs)")
  .option("--site-url <url>", "Your site URL (e.g. https://myblog.com)")
  .option("--db-name <name>", "D1 database name", "ziscus-comments")
  .option("--worker-dir <path>", "Path to worker directory", "./worker")
  .action(async (opts) => {
    console.log("Deploying ziscus...\n");

    // Step 1: Check wrangler
    try {
      checkWranglerVersion();
      console.log("✓ wrangler found");
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }

    try {
      checkWranglerAuth();
      console.log("✓ Authenticated with Cloudflare");
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }

    // Step 2: Gather inputs
    let { ssg, siteUrl, dbName, workerDir } = opts;
    const validSSGs = ["hugo", "astro", "eleventy", "jekyll", "nextjs"];

    if (!ssg || !siteUrl) {
      const rl = createInterface({ input: stdin, output: stdout });
      if (!siteUrl) siteUrl = await rl.question("Site URL (e.g. https://myblog.com): ");
      if (!ssg) ssg = await rl.question("SSG (hugo / astro / eleventy / jekyll / nextjs): ");
      rl.close();
    }

    if (!validSSGs.includes(ssg)) {
      console.error(`Unknown SSG: "${ssg}". Must be one of: ${validSSGs.join(", ")}`);
      process.exit(1);
    }

    // Step 3: Create D1 database
    let dbId: string;
    try {
      console.log(`\nCreating D1 database "${dbName}"...`);
      dbId = createD1Database(dbName);
      console.log(`✓ D1 database created (${dbId.slice(0, 8)}...)`);
    } catch (err) {
      console.error(`Failed to create D1 database. Run manually: wrangler d1 create ${dbName}`);
      process.exit(1);
    }

    // Step 4: Apply schema
    const schemaPath = `${workerDir}/src/schema.sql`;
    try {
      console.log("Applying database schema...");
      applySchema(dbName, schemaPath);
      console.log("✓ Schema applied");
    } catch (err) {
      console.error(`Schema failed. Run manually: wrangler d1 execute ${dbName} --remote --file=${schemaPath}`);
      process.exit(1);
    }

    // Step 5: Generate and set admin secret
    const adminSecret = generateSecret();
    try {
      console.log("Setting admin secret...");
      setWranglerSecret("ADMIN_SECRET", adminSecret);
      console.log("✓ Admin secret set");
    } catch (err) {
      console.error("Failed to set secret. Run manually: wrangler secret put ADMIN_SECRET");
      process.exit(1);
    }

    // Step 6: Deploy worker
    let workerUrl = "";
    try {
      console.log("Deploying Worker...");
      workerUrl = deployWorker(workerDir);
      console.log(`✓ Worker deployed${workerUrl ? ` → ${workerUrl}` : ""}`);
    } catch (err) {
      console.error(`Deploy failed. Run manually: cd ${workerDir} && wrangler deploy`);
      process.exit(1);
    }

    // Step 7: Save .env
    const { writeFile: writeF } = await import("node:fs/promises");
    const envContent = `ZISCUS_ADMIN_SECRET=${adminSecret}\n`;
    await writeF(".env", envContent);
    console.log("✓ Admin secret saved to .env");

    // Step 8: Run init for SSG
    const endpoint = siteUrl.replace(/\/$/, "");
    try {
      await runInit({ endpoint, ssg, theme: "light", dir: "." });
      console.log(`✓ SSG templates generated for ${ssg}`);
    } catch (err) {
      console.error(`Init failed. Run manually: npx ziscus init --endpoint ${endpoint} --ssg ${ssg}`);
    }

    console.log(`\n${"─".repeat(50)}`);
    console.log("Done. Comments are live.");
    console.log(`  Worker:  ${workerUrl || "(check wrangler output)"}`);
    console.log(`  Secret:  saved to .env`);
    console.log(`  AI mod:  npx ziscus ai-mod enable`);
    console.log(`\nBack up your admin secret somewhere safe.`);
    console.log(`Cloudflare secrets are write-only — you cannot retrieve them later.`);
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

program
  .command("export")
  .description("Export all comments, mod log, bans, and settings to JSON files")
  .option("--output <dir>", "Output directory", "backups")
  .option("--format <fmt>", "Output format: json or csv", "json")
  .option("--endpoint <url>", "Worker endpoint (reads from ziscus.config.json if not set)")
  .action(async (opts) => {
    const secret = process.env.ZISCUS_ADMIN_SECRET;
    if (!secret) {
      console.error("Error: Set ZISCUS_ADMIN_SECRET in .env or environment.");
      process.exit(1);
    }

    let endpoint = opts.endpoint;
    if (!endpoint) {
      try {
        const config = JSON.parse(await readFile("ziscus.config.json", "utf-8"));
        endpoint = config.endpoint;
      } catch {
        console.error("Error: No --endpoint and no ziscus.config.json. Run `npx ziscus init` first.");
        process.exit(1);
      }
    }

    await runExport({ endpoint, secret, outputDir: opts.output, format: opts.format });
    console.log(`✓ Exported to ${opts.output}/`);
  });

program
  .command("import")
  .description("Restore comments from a backup directory")
  .requiredOption("--from <dir>", "Directory containing backup JSON files")
  .option("--endpoint <url>", "Worker endpoint")
  .action(async (opts) => {
    const secret = process.env.ZISCUS_ADMIN_SECRET;
    if (!secret) {
      console.error("Error: Set ZISCUS_ADMIN_SECRET in .env or environment.");
      process.exit(1);
    }

    let endpoint = opts.endpoint;
    if (!endpoint) {
      try {
        const config = JSON.parse(await readFile("ziscus.config.json", "utf-8"));
        endpoint = config.endpoint;
      } catch {
        console.error("Error: No --endpoint and no ziscus.config.json. Run `npx ziscus init` first.");
        process.exit(1);
      }
    }

    const comments = JSON.parse(await readFile(`${opts.from}/comments.json`, "utf-8"));
    const bans = JSON.parse(await readFile(`${opts.from}/banned-ips.json`, "utf-8"));
    let modLog: unknown[] = [];
    try { modLog = JSON.parse(await readFile(`${opts.from}/mod-log.json`, "utf-8")); } catch { /* optional */ }

    const res = await fetch(`${endpoint}/admin/import`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ comments, bans, modLog }),
    });

    if (!res.ok) {
      console.error(`Error: Import failed (${res.status}): ${await res.text()}`);
      process.exit(1);
    }

    const result = await res.json() as { comments: number; bans: number; modLog: number };
    console.log(`✓ Imported ${result.comments} comments, ${result.bans} bans, ${result.modLog} mod log entries`);
  });

program
  .command("mod-log")
  .description("View the moderation log")
  .option("--action <action>", "Filter by action (ai_spam, ai_approve, approve, reject, spam, delete)")
  .option("--actor <actor>", "Filter by actor (ai, admin)")
  .option("--slug <slug>", "Filter by page slug")
  .option("--limit <n>", "Number of entries to show", "20")
  .option("--endpoint <url>", "Worker endpoint")
  .action(async (opts) => {
    const secret = process.env.ZISCUS_ADMIN_SECRET;
    if (!secret) {
      console.error("Error: Set ZISCUS_ADMIN_SECRET in .env or environment.");
      process.exit(1);
    }

    let endpoint = opts.endpoint;
    if (!endpoint) {
      try {
        const config = JSON.parse(await readFile("ziscus.config.json", "utf-8"));
        endpoint = config.endpoint;
      } catch {
        console.error("Error: No --endpoint and no ziscus.config.json. Run `npx ziscus init` first.");
        process.exit(1);
      }
    }

    const lines = await runModLog({
      endpoint,
      secret,
      action: opts.action,
      actor: opts.actor,
      slug: opts.slug,
      limit: parseInt(opts.limit, 10),
    });

    if (lines.length === 0) {
      console.log("No mod log entries found.");
      return;
    }

    console.log("Timestamp             Actor  Action         Slug       Latency  Comment");
    console.log("─".repeat(100));
    for (const line of lines) {
      console.log(line);
    }
  });

const aiMod = program
  .command("ai-mod")
  .description("Manage AI-powered spam classification");

aiMod
  .command("enable")
  .description("Add Workers AI spam classification to your Worker")
  .option("--wrangler <path>", "Path to wrangler.toml", "./worker/wrangler.toml")
  .option("--no-deploy", "Skip deployment after adding binding")
  .action(async (opts) => {
    const result = await runAiModEnable({
      dir: ".",
      wranglerPath: opts.wrangler,
      deploy: opts.deploy !== false,
    });

    if (!result.ok) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }

    if (result.alreadyEnabled) {
      console.log("AI moderation is already enabled ([ai] binding found).");
      return;
    }

    console.log("✓ Added [ai] binding to wrangler.toml");
    console.log("\nNote: Workers AI free tier supports ~3,000 classifications/day.");
    console.log("For higher volume: Workers Paid ($5/mo). Without AI: unlimited, no cost.");
    console.log("\nDeploy your worker to activate: cd worker && wrangler deploy");
  });

aiMod
  .command("disable")
  .description("Instructions to remove AI classification")
  .action(() => {
    console.log(runAiModDisable());
  });

aiMod
  .command("status")
  .description("Show AI moderation state and comment stats")
  .action(async () => {
    const secret = process.env.ZISCUS_ADMIN_SECRET;
    if (!secret) {
      console.error("Error: Set ZISCUS_ADMIN_SECRET env var. Example: ZISCUS_ADMIN_SECRET=xxx npx ziscus ai-mod status");
      process.exit(1);
    }

    let endpoint: string;
    try {
      const config = JSON.parse(await readFile("ziscus.config.json", "utf-8"));
      endpoint = config.endpoint;
    } catch {
      console.error("Error: No ziscus.config.json found. Run `npx ziscus init` first.");
      process.exit(1);
    }

    const stats = await runAiModStatus(endpoint, secret);
    console.log(`Comments: ${stats.approved} approved, ${stats.spam} spam, ${stats.pending} pending`);
  });

aiMod
  .command("test")
  .description("Verify AI classification is working")
  .action(async () => {
    const secret = process.env.ZISCUS_ADMIN_SECRET;
    if (!secret) {
      console.error("Error: Set ZISCUS_ADMIN_SECRET env var.");
      process.exit(1);
    }

    let endpoint: string;
    try {
      const config = JSON.parse(await readFile("ziscus.config.json", "utf-8"));
      endpoint = config.endpoint;
    } catch {
      console.error("Error: No ziscus.config.json found. Run `npx ziscus init` first.");
      process.exit(1);
    }

    const cases = [
      { author: "Spammer", body: "Buy cheap SEO services now!", expected: "spam" },
      { author: "Reader", body: "Great article, thanks for sharing!", expected: "approve" },
    ];

    for (const c of cases) {
      const start = Date.now();
      const res = await fetch(`${endpoint}/admin/classify`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ author: c.author, body: c.body }),
      });
      const { classification } = await res.json() as { classification: string };
      const ms = Date.now() - start;
      const icon = classification === c.expected ? "✓" : "✗";
      console.log(`  ${icon} "${c.body.slice(0, 30)}..." → ${classification} (${ms}ms)`);
    }
    console.log("\nAI moderation is working.");
  });

program.parse();
