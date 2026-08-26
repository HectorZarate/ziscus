import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          d1Databases: ["DB"],
          bindings: {
            ADMIN_SECRET: "test-admin-secret",
            ALLOWED_ORIGINS: "ziscus.com,ziscus.hdz.workers.dev",
            MODERATION: "off",
            RATE_LIMIT: "30",
            GITHUB_REPO: "HectorZarate/ziscus",
          },
        },
      },
    },
  },
});
