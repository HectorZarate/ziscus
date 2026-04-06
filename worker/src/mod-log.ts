import { requireAuth } from "./auth.js";
import type { Env } from "./types.js";

export async function logModAction(
  db: D1Database,
  action: string,
  actor: "ai" | "admin",
  opts?: { commentId?: string; slug?: string; reason?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  await db.prepare(
    "INSERT INTO mod_log (action, actor, comment_id, slug, reason, metadata) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(
    action,
    actor,
    opts?.commentId ?? null,
    opts?.slug ?? null,
    opts?.reason ?? "",
    JSON.stringify(opts?.metadata ?? {}),
  ).run();
}

export async function handleGetModLog(request: Request, env: Env): Promise<Response> {
  const authErr = requireAuth(request, env);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const actor = url.searchParams.get("actor");
  const slug = url.searchParams.get("slug");
  const since = url.searchParams.get("since");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  const conditions: string[] = [];
  const binds: (string | number)[] = [];

  if (action) { conditions.push("action = ?"); binds.push(action); }
  if (actor) { conditions.push("actor = ?"); binds.push(actor); }
  if (slug) { conditions.push("slug = ?"); binds.push(slug); }
  if (since) { conditions.push("created_at >= ?"); binds.push(since); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const query = `SELECT * FROM mod_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  return new Response(JSON.stringify(results ?? []), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
