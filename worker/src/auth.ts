import type { Env } from "./types.js";

/** Returns a 401 Response if not authenticated, or null if auth passes. */
export function requireAuth(request: Request, env: Env): Response | null {
  const auth = request.headers.get("Authorization");
  if (!env.ADMIN_SECRET || auth !== `Bearer ${env.ADMIN_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
