export interface Env {
  DB: D1Database;
  /** Static asset handler — serves the landing site for non-API routes */
  ASSETS: Fetcher;
  /** Workers AI binding for ai-mod spam classification. Optional. */
  AI_MOD?: Ai;
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
  /** Max comments per IP per hour. Default 30. */
  RATE_LIMIT?: string;
  /** Max characters allowed in a comment body. Default 10000. */
  MAX_BODY_LENGTH?: string;
  /** Min characters required in a comment body. Default 2. */
  MIN_BODY_LENGTH?: string;
  /** Max characters allowed in the author field. Default 100. */
  MAX_AUTHOR_LENGTH?: string;
  /** Max number of URLs allowed in a comment body. Default 3. */
  MAX_URLS_IN_BODY?: string;
  /** Max characters allowed in a slug. Default 255. */
  MAX_SLUG_LENGTH?: string;
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
