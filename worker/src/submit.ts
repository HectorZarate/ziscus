import type { Env } from "./types.js";
import { checkRateLimit } from "./rate-limit.js";
import { triggerRebuild } from "./debounce.js";
import { serveWithFreshComments } from "./html-rewriter.js";
import { classifyComment } from "./classify.js";
import { logModAction } from "./mod-log.js";
import { structuralFilter } from "./structural-filter.js";

const MAX_AUTHOR_LENGTH = 100;
const MAX_BODY_LENGTH = 10000;
const MIN_BODY_LENGTH = 2;
const MAX_URLS_IN_BODY = 3;
const MAX_SLUG_LENGTH = 255;

/** Hash an IP address for privacy-preserving rate limiting */
async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/** Escape HTML to prevent stored XSS */
export function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\0/g, ""); // strip null bytes
}

export async function handleSubmit(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Mode check
  const modeRow = await env.DB.prepare("SELECT value FROM meta WHERE key = 'comments_mode'").first<{ value: string }>();
  const mode = modeRow?.value ?? "on";
  if (mode === "off") {
    return new Response("Comments are disabled", { status: 403 });
  }

  const formData = await request.formData();
  const slug = formData.get("slug")?.toString().trim() ?? "";
  const author = formData.get("author")?.toString().trim() ?? "";
  const body = formData.get("body")?.toString().trim() ?? "";
  const redirectUrl = formData.get("redirect")?.toString().trim() ?? "";

  // CSRF protection: reject if Origin doesn't match any allowed origin
  const origin = request.headers.get("Origin") ?? request.headers.get("Referer") ?? "";
  const allowedHosts = (env.ALLOWED_ORIGINS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  const originHost = origin ? new URL(origin).hostname : "";
  if (originHost && allowedHosts.length > 0 && !allowedHosts.some((h) => originHost === h || originHost.endsWith("." + h))) {
    return new Response("Invalid origin", { status: 403 });
  }

  // Validate required fields
  if (!slug) return new Response("Missing slug", { status: 400 });
  if (!author) return new Response("Missing author", { status: 400 });
  if (!body) return new Response("Missing body", { status: 400 });

  // Slug validation
  if (slug.length > MAX_SLUG_LENGTH) return new Response("Slug too long", { status: 400 });
  if (!/^[a-z0-9-]+$/.test(slug)) return new Response("Invalid slug format", { status: 400 });

  // Length limits
  if (author.length > MAX_AUTHOR_LENGTH)
    return new Response("Author name too long", { status: 400 });
  if (body.length > MAX_BODY_LENGTH)
    return new Response("Comment too long", { status: 400 });
  if (body.length < MIN_BODY_LENGTH)
    return new Response("Comment too short", { status: 400 });

  // Body heuristics — reject > MAX_URLS_IN_BODY URLs
  const urlCount = (body.match(/https?:\/\//g) ?? []).length;
  if (urlCount > MAX_URLS_IN_BODY)
    return new Response("Too many URLs", { status: 400 });

  // Layer 0: structural / malicious payload filter
  const filter = structuralFilter(author, body);
  if (filter.blocked) {
    return new Response(filter.reason, { status: 400 });
  }

  // Rate limiting
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const ipHash = await hashIp(ip);
  const maxPerHour = env.RATE_LIMIT ? parseInt(env.RATE_LIMIT, 10) : 30;
  const { allowed } = await checkRateLimit(env.DB, ipHash, maxPerHour);
  if (!allowed) {
    return new Response("Rate limited. Try again later.", { status: 429 });
  }

  // Ban check
  const banned = await env.DB.prepare("SELECT 1 FROM banned_ips WHERE ip_hash = ?").bind(ipHash).first();
  if (banned) {
    return new Response("Forbidden", { status: 403 });
  }

  // AI spam classification (skip if paused — pause means review everything)
  const classifyStart = Date.now();
  const classification = mode === "paused" ? "approve" as const : await classifyComment(author, body, env);
  const classifyMs = Date.now() - classifyStart;

  // Escape and insert
  const safeAuthor = escHtml(author);
  const safeBody = escHtml(body);

  // Status resolution: AI is authoritative when bound, otherwise fall back to MODERATION setting.
  // When AI_MOD is bound, the AI's verdict maps directly:
  //   approve → approved, spam → spam, review → pending
  // When AI_MOD is not bound, MODERATION controls:
  //   on → pending, off → approved
  // Paused mode always forces pending regardless.
  let status: string;
  if (mode === "paused") {
    status = "pending";
  } else if (env.AI_MOD) {
    // AI is the moderator — its verdict is authoritative
    status = classification === "spam" ? "spam"
      : classification === "approve" ? "approved"
      : "pending"; // "review" or any unexpected value → pending
  } else {
    // No AI — fall back to MODERATION setting
    status = env.MODERATION === "on" ? "pending" : "approved";
  }

  // Generate ID so we can reference it in the mod log
  const commentId = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  await env.DB.prepare(
    "INSERT INTO comments (id, slug, author, body, status, ip_hash) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(commentId, slug, safeAuthor, safeBody, status, ipHash)
    .run();

  // Log AI decision
  if (env.AI_MOD && mode !== "paused") {
    await logModAction(env.DB, `ai_${classification}`, "ai", {
      commentId, slug,
      metadata: { model: "@cf/meta/llama-3.1-8b-instruct", latency_ms: classifyMs },
    });
  }

  // Trigger debounced rebuild if auto-approved
  if (status === "approved") {
    await triggerRebuild(env.DB, env, slug);
  }

  const destination = redirectUrl || request.headers.get("Referer") || "/";

  // Auto-approved: return the page with fresh comments injected via HTMLRewriter.
  // The commenter sees their comment instantly — no redirect, stays on the same site.
  if ((status === "approved" || status === "spam") && env.ASSETS) {
    return serveWithFreshComments(slug, destination, request, env);
  }

  return new Response(null, {
    status: 303,
    headers: { Location: destination },
  });
}
