import type { Env } from "./types.js";

/**
 * Returns a 401 Response if not authenticated, or null if auth passes.
 *
 * Auth is the `Authorization: Bearer <ADMIN_SECRET>` header only. The secret is
 * deliberately never read from the query string so it can't leak into browser
 * history, proxy/CDN logs, Referer headers, or a search index. In a browser,
 * set the header with a request-header extension (ModHeader, Requestly, etc.).
 */
export function requireAuth(request: Request, env: Env): Response | null {
  if (!env.ADMIN_SECRET) return new Response("Unauthorized", { status: 401 });
  const auth = request.headers.get("Authorization");
  if (auth === `Bearer ${env.ADMIN_SECRET}`) return null;
  return new Response("Unauthorized", { status: 401 });
}
