import type { Comment } from "./render.js";

/** D1 API response shape (snake_case from SQLite) */
interface D1Comment {
  id: string;
  slug: string;
  author: string;
  body: string;
  status: string;
  created_at?: string;
  createdAt?: string;
  approved_at?: string | null;
}

/**
 * Fetch approved comments for a page from the ziscus Worker API.
 * Maps snake_case D1 fields to camelCase Comment type.
 * Returns an empty array on any failure (network error, bad JSON, 404, timeout).
 */
export async function fetchComments(
  slug: string,
  endpoint: string,
): Promise<Comment[]> {
  try {
    const res = await fetch(`${endpoint}/comments/${slug}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    const validStatuses = ["pending", "approved", "rejected", "spam"];
    return (data as D1Comment[]).map((c) => ({
      id: c.id,
      slug: c.slug,
      author: c.author,
      body: c.body,
      status: (validStatuses.includes(c.status) ? c.status : "pending") as Comment["status"],
      createdAt: c.createdAt ?? c.created_at ?? new Date().toISOString(),
    }));
  } catch (err) {
    console.error(`[ziscus] fetch failed for "${slug}" from ${endpoint}:`, err instanceof Error ? err.message : err);
    return [];
  }
}
