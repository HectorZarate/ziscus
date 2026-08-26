// Copies the Worker bundle built by ../worker (tsdown) into this package's dist
// so consumers can `export { default } from "ziscus/worker"` and apply the
// schema from "ziscus/schema.sql" — no clone of this repo required.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const workerDist = here("../../worker/dist/");
mkdirSync(here("../dist"), { recursive: true });

copyFileSync(`${workerDist}index.js`, here("../dist/worker.js"));
// Ambient Cloudflare types (D1Database, Fetcher, Ai) resolve for consumers who typecheck.
const dts = readFileSync(`${workerDist}index.d.ts`, "utf8");
writeFileSync(here("../dist/worker.d.ts"), `/// <reference types="@cloudflare/workers-types" />\n${dts}`);
copyFileSync(here("../../worker/src/schema.sql"), here("../dist/schema.sql"));
console.log("bundled worker → dist/worker.js, dist/worker.d.ts, dist/schema.sql");
