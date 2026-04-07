export interface ModLogEntry {
  id: string;
  action: string;
  actor: string;
  comment_id: string | null;
  slug: string | null;
  reason: string;
  metadata: string;
  created_at: string;
}

export interface CommentInfo {
  id: string;
  author: string;
  body: string;
  status: string;
}

export interface ModLogOptions {
  endpoint: string;
  secret: string;
  action?: string;
  actor?: string;
  slug?: string;
  limit?: number;
}

const MAX_BODY_DISPLAY = 50;

export function formatModLogEntry(
  entry: ModLogEntry,
  comments?: Map<string, CommentInfo>,
): string {
  const meta = JSON.parse(entry.metadata) as Record<string, unknown>;
  const latency = meta.latency_ms ? `${meta.latency_ms}ms` : "";

  let commentInfo = "";
  if (entry.comment_id && comments) {
    const c = comments.get(entry.comment_id);
    if (c) {
      const clean = c.body.replace(/[\n\r]+/g, " ").trim();
      const body = clean.length > MAX_BODY_DISPLAY ? clean.slice(0, MAX_BODY_DISPLAY) + "..." : clean;
      commentInfo = `${c.author}: "${body}"`;
    } else {
      commentInfo = entry.comment_id.slice(0, 8);
    }
  } else if (entry.comment_id) {
    commentInfo = entry.comment_id.slice(0, 8);
  }

  return `${entry.created_at}  ${entry.actor.padEnd(6)} ${entry.action.padEnd(14)} ${(entry.slug ?? "").padEnd(10)} ${latency.padEnd(8)} ${commentInfo}`;
}

export async function runModLog(opts: ModLogOptions): Promise<string[]> {
  const params = new URLSearchParams();
  if (opts.action) params.set("action", opts.action);
  if (opts.actor) params.set("actor", opts.actor);
  if (opts.slug) params.set("slug", opts.slug);
  if (opts.limit) params.set("limit", String(opts.limit));

  const qs = params.toString();
  const logUrl = `${opts.endpoint}/admin/mod-log${qs ? `?${qs}` : ""}`;
  const commentsUrl = `${opts.endpoint}/admin/comments`;
  const headers = { Authorization: `Bearer ${opts.secret}` };

  const [logRes, commentsRes] = await Promise.all([
    fetch(logUrl, { headers }),
    fetch(commentsUrl, { headers }),
  ]);

  const entries = (await logRes.json()) as ModLogEntry[];
  if (entries.length === 0) return [];

  const allComments = (await commentsRes.json()) as CommentInfo[];
  const commentMap = new Map(allComments.map((c) => [c.id, c]));

  return entries.map((e) => formatModLogEntry(e, commentMap));
}
