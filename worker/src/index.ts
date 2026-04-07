import type { Env } from "./types.js";
import { handleSubmit } from "./submit.js";
import { serveWithFreshComments } from "./html-rewriter.js";
import { classifyComment } from "./classify.js";
import { requireAuth } from "./auth.js";
import { handleGetModLog } from "./mod-log.js";
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
    }

    // No API route matched — serve static assets (landing site)
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
