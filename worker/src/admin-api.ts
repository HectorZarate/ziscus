import type { Env } from "./types.js";
import { requireAuth } from "./auth.js";
import { logModAction } from "./mod-log.js";
import { escHtml } from "./submit.js";

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
  const bound = stmt.bind(...binds);

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
  await logModAction(env.DB, "mode_change", "admin", { reason: `mode → ${mode}` });
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
  await logModAction(env.DB, "ban", "admin", { reason: body.reason ?? "" });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS });
}

/** DELETE /admin/ban/:ip_hash — unban */
export async function handleUnbanIp(ipHash: string, request: Request, env: Env): Promise<Response> {
  const authErr = requireAuth(request, env);
  if (authErr) return authErr;

  await env.DB.prepare("DELETE FROM banned_ips WHERE ip_hash = ?").bind(ipHash).run();
  await logModAction(env.DB, "unban", "admin");
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

/** GET /admin/export — full database dump in one response */
export async function handleExport(request: Request, env: Env): Promise<Response> {
  const authErr = requireAuth(request, env);
  if (authErr) return authErr;

  const [comments, modLog, bans, modeRow] = await Promise.all([
    env.DB.prepare("SELECT * FROM comments ORDER BY created_at DESC").all(),
    env.DB.prepare("SELECT * FROM mod_log ORDER BY created_at DESC").all(),
    env.DB.prepare("SELECT * FROM banned_ips ORDER BY banned_at DESC").all(),
    env.DB.prepare("SELECT value FROM meta WHERE key = 'comments_mode'").first<{ value: string }>(),
  ]);

  return new Response(JSON.stringify({
    comments: comments.results ?? [],
    modLog: modLog.results ?? [],
    bans: bans.results ?? [],
    meta: { mode: modeRow?.value ?? "on" },
  }), { status: 200, headers: JSON_HEADERS });
}

const VALID_STATUSES = ["pending", "approved", "rejected", "spam"];

/** POST /admin/import — restore from backup */
export async function handleImport(request: Request, env: Env): Promise<Response> {
  const authErr = requireAuth(request, env);
  if (authErr) return authErr;

  let payload: { comments?: unknown; bans?: unknown; modLog?: unknown };
  try {
    payload = await request.json() as typeof payload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const comments = payload.comments;
  const bans = payload.bans;
  const modLogEntries = payload.modLog;

  if (comments !== undefined && !Array.isArray(comments)) {
    return new Response("comments must be an array", { status: 400 });
  }
  if (bans !== undefined && !Array.isArray(bans)) {
    return new Response("bans must be an array", { status: 400 });
  }

  // Validate and import comments
  let commentCount = 0;
  if (Array.isArray(comments)) {
    for (const c of comments as Record<string, unknown>[]) {
      if (!c.id || !c.slug || !c.author || !c.body || !c.status) {
        return new Response("Invalid comment: missing required fields", { status: 400 });
      }
      if (!VALID_STATUSES.includes(c.status as string)) {
        return new Response(`Invalid status: ${c.status}`, { status: 400 });
      }
    }

    const batch = (comments as Record<string, unknown>[]).map((c) =>
      env.DB.prepare(
        "INSERT OR REPLACE INTO comments (id, slug, author, body, status, ip_hash, created_at, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        c.id, c.slug, escHtml(String(c.author)), escHtml(String(c.body)),
        c.status, c.ip_hash ?? "", c.created_at ?? new Date().toISOString(), c.approved_at ?? null,
      ),
    );
    for (let i = 0; i < batch.length; i += 100) {
      await env.DB.batch(batch.slice(i, i + 100));
    }
    commentCount = batch.length;
  }

  // Import bans
  let banCount = 0;
  if (Array.isArray(bans)) {
    const batch = (bans as Record<string, unknown>[]).map((b) =>
      env.DB.prepare(
        "INSERT OR REPLACE INTO banned_ips (ip_hash, reason, banned_at) VALUES (?, ?, ?)",
      ).bind(b.ip_hash, b.reason ?? "", b.banned_at ?? new Date().toISOString()),
    );
    for (let i = 0; i < batch.length; i += 100) {
      await env.DB.batch(batch.slice(i, i + 100));
    }
    banCount = batch.length;
  }

  // Import mod_log
  let modLogCount = 0;
  if (Array.isArray(modLogEntries)) {
    const batch = (modLogEntries as Record<string, unknown>[]).map((m) =>
      env.DB.prepare(
        "INSERT OR REPLACE INTO mod_log (id, action, actor, comment_id, slug, reason, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        m.id, m.action, m.actor ?? "admin", m.comment_id ?? null,
        m.slug ?? null, m.reason ?? "", m.metadata ?? "{}", m.created_at ?? new Date().toISOString(),
      ),
    );
    for (let i = 0; i < batch.length; i += 100) {
      await env.DB.batch(batch.slice(i, i + 100));
    }
    modLogCount = batch.length;
  }

  await logModAction(env.DB, "import", "admin", {
    reason: `Imported ${commentCount} comments, ${banCount} bans, ${modLogCount} mod_log entries`,
  });

  return new Response(JSON.stringify({
    ok: true, comments: commentCount, bans: banCount, modLog: modLogCount,
  }), { status: 200, headers: JSON_HEADERS });
}
