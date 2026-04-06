import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "./init.js";

describe("runInit", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ziscus-init-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates ziscus.config.json with endpoint and theme", async () => {
    await runInit({ endpoint: "https://comments.example.com", ssg: "hugo", theme: "light", dir });
    const config = JSON.parse(await readFile(join(dir, "ziscus.config.json"), "utf-8"));
    expect(config.endpoint).toBe("https://comments.example.com");
    expect(config.ssg).toBe("hugo");
    expect(config.theme).toBe("light");
  });

  it("creates Hugo partial at layouts/partials/ziscus.html", async () => {
    await runInit({ endpoint: "https://comments.example.com", ssg: "hugo", theme: "light", dir });
    const partial = await readFile(join(dir, "layouts", "partials", "ziscus.html"), "utf-8");
    expect(partial).toContain(".Site.Params.ziscus.endpoint");
    expect(partial).toContain("ziscus-form");
    expect(partial).toContain("--zc-text");
  });

  it("creates GitHub Actions workflow", async () => {
    await runInit({ endpoint: "https://comments.example.com", ssg: "hugo", theme: "light", dir });
    const workflow = await readFile(join(dir, ".github", "workflows", "rebuild-comments.yml"), "utf-8");
    expect(workflow).toContain("repository_dispatch");
    expect(workflow).toContain("rebuild-comments");
    expect(workflow).toContain("hugo");
  });

  it("creates Astro component at src/components/Ziscus.astro", async () => {
    await runInit({ endpoint: "https://comments.example.com", ssg: "astro", theme: "dark", dir });
    const component = await readFile(join(dir, "src", "components", "Ziscus.astro"), "utf-8");
    expect(component).toContain("fetchComments");
    expect(component).toContain("ziscus-form");
    expect(component).toContain("--zc-text: #e0e0e0");
  });

  it("creates Jekyll include at _includes/ziscus.html", async () => {
    await runInit({ endpoint: "https://comments.example.com", ssg: "jekyll", theme: "light", dir });
    const include = await readFile(join(dir, "_includes", "ziscus.html"), "utf-8");
    expect(include).toContain("site.data.comments");
    expect(include).toContain("site.ziscus.endpoint");
  });

  it("creates 11ty include at _includes/ziscus.njk", async () => {
    await runInit({ endpoint: "https://comments.example.com", ssg: "eleventy", theme: "terminal", dir });
    const include = await readFile(join(dir, "_includes", "ziscus.njk"), "utf-8");
    expect(include).toContain("slugComments");
    expect(include).toContain("--zc-text: #FFB000");
  });

  it("creates Next.js component at components/Ziscus.tsx", async () => {
    await runInit({ endpoint: "https://comments.example.com", ssg: "nextjs", theme: "light", dir });
    const component = await readFile(join(dir, "components", "Ziscus.tsx"), "utf-8");
    expect(component).toContain("fetchComments");
    expect(component).toContain("dangerouslySetInnerHTML");
  });

  it("inlines theme CSS into the template", async () => {
    await runInit({ endpoint: "https://comments.example.com", ssg: "hugo", theme: "terminal", dir });
    const partial = await readFile(join(dir, "layouts", "partials", "ziscus.html"), "utf-8");
    expect(partial).toContain("--zc-text: #FFB000");
    expect(partial).toContain("--zc-bg: #0D0D0D");
    expect(partial).not.toContain("ZISCUS_THEME_CSS");
  });

  it("workflow uses correct build command per SSG", async () => {
    await runInit({ endpoint: "https://e.com", ssg: "jekyll", theme: "light", dir });
    const workflow = await readFile(join(dir, ".github", "workflows", "rebuild-comments.yml"), "utf-8");
    expect(workflow).toContain("jekyll build");
    expect(workflow).not.toContain("hugo");
  });

  it("accepts custom theme colors", async () => {
    await runInit({
      endpoint: "https://e.com",
      ssg: "hugo",
      theme: "custom",
      customColors: { text: "#f00", bg: "#0f0", border: "#00f", muted: "#999" },
      dir,
    });
    const partial = await readFile(join(dir, "layouts", "partials", "ziscus.html"), "utf-8");
    expect(partial).toContain("--zc-text: #f00");
    expect(partial).toContain("--zc-bg: #0f0");
  });
});
