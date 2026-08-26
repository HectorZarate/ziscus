import { defineConfig } from "tsdown";

// Bundles the Worker into a single ESM file. The `ziscus` npm package copies
// dist/index.{js,d.ts} in as `ziscus/worker` (see embed/scripts/bundle-worker.mjs).
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  platform: "neutral",
  dts: true,
  hash: false,
  outDir: "dist",
});
