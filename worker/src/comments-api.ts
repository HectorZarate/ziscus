import type { Env } from "./types.js";
import { requireAuth } from "./auth.js";
import { triggerRebuild } from "./debounce.js";
import { logModAction } from "./mod-log.js";

const JSON_HEADERS = { "Content-Type": "application/json" };
const OK_RESPONSE = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS });

/** GET /comments/:slug — return approved comments as JSON */
export async function handleGetComments(
  slug: string,
  env: Env,
): Promise<Response> {
  // Check mode — if off or paused, return empty
  const modeRow = await env.DB.prepare("SELECT value FROM meta WHERE key = 'comments_mode'").first<{ value: string }>();
  const mode = modeRow?.value ?? "on";
  if (mode === "off" || mode === "paused") {
    return new Response("[]", { status: 200, headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=60", "Access-Control-Allow-Origin": "*" } });
  }

  const { results } = await env.DB.prepare(
    "SELECT id, slug, author, body, status, created_at, approved_at FROM comments WHERE slug = ? AND status = 'approved' ORDER BY created_at ASC",
  )
    .bind(slug)
    .all();

  return new Response(JSON.stringify(results ?? []), {
    status: 200,
    headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=60", "Access-Control-Allow-Origin": "*" },
  });
}

/** Helper: find comment or return 404 */
async function findComment(id: string, env: Env): Promise<{ slug: string; status: string } | Response> {
  const comment = await env.DB.prepare("SELECT slug, status FROM comments WHERE id = ?").bind(id).first<{ slug: string; status: string }>();
  if (!comment) return new Response("Not found", { status: 404 });
  return comment;
}

/** POST /approve/:id */
export async function handleApprove(id: string, request: Request, env: Env): Promise<Response> {
  const authErr = requireAuth(request, env);
  if (authErr) return authErr;

  const comment = await findComment(id, env);
  if (comment instanceof Response) return comment;

  await env.DB.prepare("UPDATE comments SET status = 'approved', approved_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").bind(id).run();
  await logModAction(env.DB, "approve", "admin", { commentId: id, slug: comment.slug });
  await triggerRebuild(env.DB, env, comment.slug);
  return OK_RESPONSE();
}

/** POST /reject/:id */
export async function handleReject(id: string, request: Request, env: Env): Promise<Response> {
  const authErr = requireAuth(request, env);
  if (authErr) return authErr;

  const comment = await findComment(id, env);
  if (comment instanceof Response) return comment;

  await env.DB.prepare("UPDATE comments SET status = 'rejected' WHERE id = ?").bind(id).run();
  await logModAction(env.DB, "reject", "admin", { commentId: id, slug: comment.slug });
  return OK_RESPONSE();
}

/** POST /spam/:id */
export async function handleSpam(id: string, request: Request, env: Env): Promise<Response> {
  const authErr = requireAuth(request, env);
  if (authErr) return authErr;

  const comment = await findComment(id, env);
  if (comment instanceof Response) return comment;

  const wasApproved = comment.status === "approved";
  await env.DB.prepare("UPDATE comments SET status = 'spam' WHERE id = ?").bind(id).run();
  await logModAction(env.DB, "spam", "admin", { commentId: id, slug: comment.slug });
  if (wasApproved) await triggerRebuild(env.DB, env, comment.slug);
  return OK_RESPONSE();
}

/** POST /unapprove/:id */
export async function handleUnapprove(id: string, request: Request, env: Env): Promise<Response> {
  const authErr = requireAuth(request, env);
  if (authErr) return authErr;

  const comment = await findComment(id, env);
  if (comment instanceof Response) return comment;

  await env.DB.prepare("UPDATE comments SET status = 'pending', approved_at = NULL WHERE id = ?").bind(id).run();
  await logModAction(env.DB, "unapprove", "admin", { commentId: id, slug: comment.slug });
  await triggerRebuild(env.DB, env, comment.slug);
  return OK_RESPONSE();
}

/** DELETE /comments/:id */
export async function handleDeleteComment(id: string, request: Request, env: Env): Promise<Response> {
  const authErr = requireAuth(request, env);
  if (authErr) return authErr;

  const comment = await findComment(id, env);
  if (comment instanceof Response) return comment;

  const wasApproved = comment.status === "approved";
  await logModAction(env.DB, "delete", "admin", { commentId: id, slug: comment.slug });
  await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
  if (wasApproved) await triggerRebuild(env.DB, env, comment.slug);
  return OK_RESPONSE();
}
