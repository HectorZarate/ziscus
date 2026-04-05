import type { Env } from "./types.js";
import { requireAuth } from "./auth.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

/** GET /admin/stats — counts grouped by status */
export async function handleGetStats(request: Request, env: Env): Promise<Response> {
  const authErr = requireAuth(request, env);
  if (authErr) return authErr;

  const { results } = await env.DB.prepare(
    "SELECT status, COUNT(*) as count FROM comments GROUP BY status",
  ).all<{ status: string; count: number }>();

  const stats: Record<string, number> = { pending: 0, approved: 0, rejected: 0, spam: 0 };
  for (const row of results ?? []) {
    stats[row.status] = row.count;
  }

  return new Response(JSON.stringify(stats), { status: 200, headers: JSON_HEADERS });
}

/** GET /admin/comments — filtered list with pagination */
export async function handleListComments(request: Request, env: Env): Promise<Response> {
  const authErr = requireAuth(request, env);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const slug = url.searchParams.get("slug");
  const author = url.searchParams.get("author");
  const since = url.searchParams.get("since");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  const conditions: string[] = [];
  const binds: string[] = [];

  if (status) { conditions.push("status = ?"); binds.push(status); }
  if (slug) { conditions.push("slug = ?"); binds.push(slug); }
  if (author) { conditions.push("author LIKE ?"); binds.push(`%${author}%`); }
  if (since) { conditions.push("created_at >= ?"); binds.push(since); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const query = `SELECT id, slug, author, body, status, ip_hash, created_at, approved_at FROM comments ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  binds.push(limit.toString(), offset.toString());

  const stmt = env.DB.prepare(query);
  const bound = binds.length === 2 ? stmt.bind(binds[0], binds[1])
    : binds.length === 3 ? stmt.bind(binds[0], binds[1], binds[2])
    : binds.length === 4 ? stmt.bind(binds[0], binds[1], binds[2], binds[3])
    : binds.length === 5 ? stmt.bind(binds[0], binds[1], binds[2], binds[3], binds[4])
    : binds.length === 6 ? stmt.bind(binds[0], binds[1], binds[2], binds[3], binds[4], binds[5])
    : stmt.bind(limit.toString(), offset.toString());

  const { results } = await bound.all();
  return new Response(JSON.stringify(results ?? []), { status: 200, headers: JSON_HEADERS });
}

/** POST /admin/mode — set comments mode */
export async function handleSetMode(request: Request, env: Env): Promise<Response> {
  const authErr = requireAuth(request, env);
  if (authErr) return authErr;

  const body = await request.json() as { mode?: string };
  const mode = body.mode;
  if (!mode || !["on", "off", "paused"].includes(mode)) {
    return new Response("Invalid mode. Must be: on, off, paused", { status: 400 });
  }

  await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('comments_mode', ?)").bind(mode).run();
  return new Response(JSON.stringify({ ok: true, mode }), { status: 200, headers: JSON_HEADERS });
}

/** GET /admin/mode — get current mode */
export async function handleGetMode(request: Request, env: Env): Promise<Response> {
  const authErr = requireAuth(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'comments_mode'").first<{ value: string }>();
  const mode = row?.value ?? "on";
  return new Response(JSON.stringify({ mode }), { status: 200, headers: JSON_HEADERS });
}

/** POST /admin/ban — ban an IP hash */
export async function handleBanIp(request: Request, env: Env): Promise<Response> {
  const authErr = requireAuth(request, env);
  if (authErr) return authErr;

  const body = await request.json() as { ip_hash?: string; reason?: string };
  if (!body.ip_hash) {
    return new Response("Missing ip_hash", { status: 400 });
  }

  await env.DB.prepare("INSERT OR REPLACE INTO banned_ips (ip_hash, reason) VALUES (?, ?)").bind(body.ip_hash, body.reason ?? "").run();
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS });
}

/** DELETE /admin/ban/:ip_hash — unban */
export async function handleUnbanIp(ipHash: string, request: Request, env: Env): Promise<Response> {
  const authErr = requireAuth(request, env);
  if (authErr) return authErr;

  await env.DB.prepare("DELETE FROM banned_ips WHERE ip_hash = ?").bind(ipHash).run();
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS });
}

/** GET /admin/bans — list banned IPs */
export async function handleListBans(request: Request, env: Env): Promise<Response> {
  const authErr = requireAuth(request, env);
  if (authErr) return authErr;

  const { results } = await env.DB.prepare("SELECT ip_hash, reason, banned_at FROM banned_ips ORDER BY banned_at DESC").all();
  return new Response(JSON.stringify(results ?? []), { status: 200, headers: JSON_HEADERS });
}

/** POST /admin/bulk/approve — approve all pending for a slug */
export async function handleBulkApprove(request: Request, env: Env): Promise<Response> {
  const authErr = requireAuth(request, env);
  if (authErr) return authErr;

  const body = await request.json() as { slug?: string };
  if (!body.slug) {
    return new Response("Missing slug", { status: 400 });
  }

  const result = await env.DB.prepare(
    "UPDATE comments SET status = 'approved', approved_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE slug = ? AND status = 'pending'",
  ).bind(body.slug).run();

  return new Response(JSON.stringify({ ok: true, count: result.meta.changes }), { status: 200, headers: JSON_HEADERS });
}
