import type { Env } from "./types.js";
import { handleSubmit } from "./submit.js";
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
} from "./admin-api.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight for all routes
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // /submit — comment submission (POST only)
    if (path === "/submit") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }
      return handleSubmit(request, env);
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
      if (path === "/admin/bulk/approve" && request.method === "POST") return handleBulkApprove(request, env);

      const unbanMatch = path.match(/^\/admin\/ban\/([a-z0-9]+)\/?$/);
      if (unbanMatch && request.method === "DELETE") return handleUnbanIp(unbanMatch[1]!, request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};
