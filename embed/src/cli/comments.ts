export interface AdminComment {
  id: string;
  slug: string;
  author: string;
  body: string;
  status: string;
  created_at: string;
}

export interface ListCommentsOptions {
  endpoint: string;
  secret: string;
  status?: string;
  slug?: string;
  limit?: number;
}

export function formatComment(c: AdminComment): string {
  return `[${c.status}] ${c.author} — ${c.slug} (${c.created_at})
  ID: ${c.id}
  ${c.body}`;
}

export async function runListComments(opts: ListCommentsOptions): Promise<string[]> {
  const params = new URLSearchParams();
  if (opts.status) params.set("status", opts.status);
  if (opts.slug) params.set("slug", opts.slug);
  if (opts.limit) params.set("limit", String(opts.limit));

  const qs = params.toString();
  const url = `${opts.endpoint}/admin/comments${qs ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${opts.secret}` },
  });

  const comments = (await res.json()) as AdminComment[];
  return comments.map(formatComment);
}
