import type { Env } from "./types.js";
import { handleSubmit } from "./submit.js";
import { serveWithFreshComments } from "./html-rewriter.js";
import { classifyComment } from "./classify.js";
import { requireAuth } from "./auth.js";
import { handleGetModLog } from "./mod-log.js";
import { handleDashboard } from "./dashboard.js";
import {
  handleGetComments,
  handleApprove,
  handleReject,
  handleSpam,
  handleUnapprove,
  handleDeleteComment,
} from "./comments-api.js";
import {
  handleGetStats,
  handleListComments,
  handleSetMode,
  handleGetMode,
  handleBanIp,
  handleUnbanIp,
  handleListBans,
  handleBulkApprove,
  handleExport,
  handleImport,
} from "./admin-api.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      const isAdmin = path.startsWith("/admin/");
      const allowedOrigin = isAdmin
        ? (env.ALLOWED_ORIGINS ?? "").split(",").map((h) => h.trim()).filter(Boolean)[0] ?? ""
        : "*";
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowedOrigin,
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // /submit — comment submission
    if (path === "/submit") {
      if (request.method === "POST") return handleSubmit(request, env);
      // GET /submit (e.g. browser refresh) → redirect to homepage
      return new Response(null, { status: 302, headers: { Location: "/" } });
    }

    // GET /comments/:slug — approved comments as JSON
    // DELETE /comments/:id — permanent delete (admin)
    const commentsMatch = path.match(/^\/comments\/([a-z0-9-]+)\/?$/);
    if (commentsMatch) {
      if (request.method === "GET") return handleGetComments(commentsMatch[1]!, env);
      if (request.method === "DELETE") return handleDeleteComment(commentsMatch[1]!, request, env);
    }

    // POST /approve/:id
    const approveMatch = path.match(/^\/approve\/([a-z0-9]+)\/?$/);
    if (approveMatch && request.method === "POST") {
      return handleApprove(approveMatch[1]!, request, env);
    }

    // POST /reject/:id
    const rejectMatch = path.match(/^\/reject\/([a-z0-9]+)\/?$/);
    if (rejectMatch && request.method === "POST") {
      return handleReject(rejectMatch[1]!, request, env);
    }

    // POST /spam/:id
    const spamMatch = path.match(/^\/spam\/([a-z0-9]+)\/?$/);
    if (spamMatch && request.method === "POST") {
      return handleSpam(spamMatch[1]!, request, env);
    }

    // POST /unapprove/:id
    const unapproveMatch = path.match(/^\/unapprove\/([a-z0-9]+)\/?$/);
    if (unapproveMatch && request.method === "POST") {
      return handleUnapprove(unapproveMatch[1]!, request, env);
    }

    // /admin/* — authenticated management endpoints
    if (path.startsWith("/admin/")) {
      if (path === "/admin/dashboard" && request.method === "GET") return handleDashboard(request, env);
      if (path === "/admin/stats" && request.method === "GET") return handleGetStats(request, env);
      if (path === "/admin/comments" && request.method === "GET") return handleListComments(request, env);
      if (path === "/admin/mode" && request.method === "POST") return handleSetMode(request, env);
      if (path === "/admin/mode" && request.method === "GET") return handleGetMode(request, env);
      if (path === "/admin/ban" && request.method === "POST") return handleBanIp(request, env);
      if (path === "/admin/bans" && request.method === "GET") return handleListBans(request, env);
      if (path === "/admin/mod-log" && request.method === "GET") return handleGetModLog(request, env);
      if (path === "/admin/export" && request.method === "GET") return handleExport(request, env);
      if (path === "/admin/import" && request.method === "POST") return handleImport(request, env);
      if (path === "/admin/bulk/approve" && request.method === "POST") return handleBulkApprove(request, env);

      if (path === "/admin/classify" && request.method === "POST") {
        const authErr = requireAuth(request, env);
        if (authErr) return authErr;
        const { author, body } = await request.json() as { author?: string; body?: string };
        if (!author || !body) return new Response("Missing author or body", { status: 400 });
        const classification = await classifyComment(author, body, env);
        return new Response(JSON.stringify({ classification }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }

      const unbanMatch = path.match(/^\/admin\/ban\/([a-z0-9]+)\/?$/);
      if (unbanMatch && request.method === "DELETE") return handleUnbanIp(unbanMatch[1]!, request, env);

      // Per-slug pause: POST to pause, DELETE to reopen
      const pauseMatch = path.match(/^\/admin\/pause\/([a-z0-9-]+)\/?$/);
      if (pauseMatch) {
        const authErr = requireAuth(request, env);
        if (authErr) return authErr;
        const pauseSlug = pauseMatch[1]!;
        if (request.method === "POST") {
          await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')").bind(`slug_paused:${pauseSlug}`).run();
          return new Response(JSON.stringify({ ok: true, slug: pauseSlug, paused: true }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (request.method === "DELETE") {
          await env.DB.prepare("DELETE FROM meta WHERE key = ?").bind(`slug_paused:${pauseSlug}`).run();
          return new Response(JSON.stringify({ ok: true, slug: pauseSlug, paused: false }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
      }
    }

    // Flash cookie: after PRG redirect, serve fresh comments via HTMLRewriter
    // so the commenter sees their comment instantly
    const cookies = request.headers.get("Cookie") ?? "";
    const flashMatch = cookies.match(/ziscus_posted=([a-z0-9-]+)/);
    if (flashMatch && env.ASSETS && request.method === "GET") {
      const slug = flashMatch[1]!;
      const original = await serveWithFreshComments(slug, url.pathname, request, env);
      // Build new response with mutable headers to clear the flash cookie
      const headers = new Headers(original.headers);
      headers.set("Set-Cookie", "ziscus_posted=; Max-Age=0; Path=/; SameSite=Lax");
      return new Response(original.body, { status: original.status, headers });
    }

    // No API route matched — serve static assets (landing site)
    if (env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      // If this is an HTML page, check for paused slugs and hide comment forms
      const ct = assetRes.headers.get("Content-Type") ?? "";
      if (ct.includes("text/html") && request.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT key FROM meta WHERE key LIKE 'slug_paused:%'",
        ).all<{ key: string }>();
        if (results && results.length > 0) {
          const pausedSlugs = new Set(results.map((r) => r.key.replace("slug_paused:", "")));
          let formIsPaused = false;
          const pausedMsg = '<p style="color: var(--color-muted, #888); font-style: italic; margin: 1rem 0;">Comments are paused on this page.</p>';
          const rewritten = new HTMLRewriter()
            .on(".comment-form input[name='slug']", {
              element(el) {
                const val = el.getAttribute("value") ?? "";
                formIsPaused = pausedSlugs.has(val);
                if (formIsPaused) el.remove();
              },
            })
            .on(".comment-form div, .comment-form button", {
              element(el) {
                if (formIsPaused) el.remove();
              },
            })
            .on(".comment-form", {
              element(el) {
                el.onEndTag((end) => {
                  if (formIsPaused) end.before(pausedMsg, { html: true });
                });
              },
            })
            .transform(assetRes);
          return new Response(rewritten.body, {
            status: assetRes.status,
            headers: assetRes.headers,
          });
        }
      }
      return assetRes;
    }
    return new Response("Not found", { status: 404 });
  },
};
