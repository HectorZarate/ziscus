import type { Env } from "./types.js";

/** Returns a 401 Response if not authenticated, or null if auth passes. */
export function requireAuth(request: Request, env: Env): Response | null {
  if (!env.ADMIN_SECRET) return new Response("Unauthorized", { status: 401 });
  const auth = request.headers.get("Authorization");
  if (auth === `Bearer ${env.ADMIN_SECRET}`) return null;
  const url = new URL(request.url);
  if (url.searchParams.get("token") === env.ADMIN_SECRET) return null;
  return new Response("Unauthorized", { status: 401 });
}
