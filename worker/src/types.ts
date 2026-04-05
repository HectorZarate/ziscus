export interface Env {
  DB: D1Database;
  /** Comma-separated list of allowed origin hostnames for CSRF protection */
  ALLOWED_ORIGINS: string;
  /** GitHub repo (owner/repo) to trigger rebuilds via repository_dispatch */
  GITHUB_REPO?: string;
  /** GitHub token for repository_dispatch */
  GITHUB_TOKEN?: string;
  /** Bearer token for admin endpoints */
  ADMIN_SECRET?: string;
  /** "on" (default) or "off" — whether new comments require approval */
  MODERATION: string;
  /** Max comments per IP per hour. Default 5. */
  RATE_LIMIT?: string;
}

export interface Comment {
  id: string;
  slug: string;
  author: string;
  body: string;
  status: "pending" | "approved" | "rejected" | "spam";
  ip_hash: string;
  created_at: string;
  approved_at: string | null;
}
