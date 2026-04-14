import type { Env } from "./types.js";

/** Check auth via query-param token OR Bearer header */
function checkDashboardAuth(request: Request, env: Env): boolean {
  if (!env.ADMIN_SECRET) return false;
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (token === env.ADMIN_SECRET) return true;
  const auth = request.headers.get("Authorization");
  if (auth === `Bearer ${env.ADMIN_SECRET}`) return true;
  return false;
}

const PAGE_SIZE = 20;

export async function handleDashboard(request: Request, env: Env): Promise<Response> {
  if (!checkDashboardAuth(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const pageParam = parseInt(url.searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;
  const q = (url.searchParams.get("q") ?? "").trim();
  const offset = (page - 1) * PAGE_SIZE;

  // Build pending query with optional search filter
  const searchFilter = q ? " AND (body LIKE ? OR author LIKE ?)" : "";
  const likeVal = q ? `%${q}%` : null;

  const pendingCountQuery = `SELECT COUNT(*) as count FROM comments WHERE status = 'pending'${searchFilter}`;
  const pendingDataQuery = `SELECT id, slug, author, body, created_at FROM comments WHERE status = 'pending'${searchFilter} ORDER BY created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`;

  const [statsResult, topPagesResult, latestPagesResult, pendingCountResult, pendingResult, spamResult, modeRow] = await Promise.all([
    env.DB.prepare("SELECT status, COUNT(*) as count FROM comments GROUP BY status")
      .all<{ status: string; count: number }>(),
    env.DB.prepare("SELECT slug, COUNT(*) as count FROM comments WHERE status = 'approved' GROUP BY slug ORDER BY count DESC LIMIT 10")
      .all<{ slug: string; count: number }>(),
    env.DB.prepare("SELECT slug, COUNT(*) as count, MAX(created_at) as latest FROM comments WHERE status = 'approved' GROUP BY slug ORDER BY latest DESC LIMIT 5")
      .all<{ slug: string; count: number; latest: string }>(),
    likeVal !== null
      ? env.DB.prepare(pendingCountQuery).bind(likeVal, likeVal).first<{ count: number }>()
      : env.DB.prepare(pendingCountQuery).first<{ count: number }>(),
    likeVal !== null
      ? env.DB.prepare(pendingDataQuery).bind(likeVal, likeVal).all<{ id: string; slug: string; author: string; body: string; created_at: string }>()
      : env.DB.prepare(pendingDataQuery).all<{ id: string; slug: string; author: string; body: string; created_at: string }>(),
    env.DB.prepare("SELECT id, slug, author, body, created_at FROM comments WHERE status = 'spam' ORDER BY created_at DESC LIMIT 5")
      .all<{ id: string; slug: string; author: string; body: string; created_at: string }>(),
    env.DB.prepare("SELECT value FROM meta WHERE key = 'comments_mode'").first<{ value: string }>(),
  ]);

  const stats: Record<string, number> = { pending: 0, approved: 0, rejected: 0, spam: 0 };
  for (const row of statsResult.results ?? []) {
    stats[row.status] = row.count;
  }

  const topPages = topPagesResult.results ?? [];
  const latestPages = latestPagesResult.results ?? [];
  const pending = pendingResult.results ?? [];
  const recentSpam = spamResult.results ?? [];
  const commentsMode = modeRow?.value ?? "on";
  const aiModEnabled = !!env.AI_MOD;

  const totalPending = pendingCountResult?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalPending / PAGE_SIZE));

  const token = url.searchParams.get("token") ?? "";
  const tokenParam = token ? `?token=${token}` : "";

  // Build nav link helper — preserves token and q params
  function navHref(targetPage: number): string {
    const p = new URLSearchParams();
    if (token) p.set("token", token);
    if (q) p.set("q", q);
    p.set("page", String(targetPage));
    return `/admin/dashboard?${p.toString()}`;
  }

  const prevHref = page > 1 ? navHref(page - 1) : null;
  const nextHref = page < totalPages ? navHref(page + 1) : null;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin Dashboard</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem 1rem; background: #0d0d0d; color: #e0e0e0; }
  h1 { font-size: 1.4rem; margin-bottom: 1.5rem; color: #fff; }
  h2 { font-size: 1.1rem; margin: 1.5rem 0 0.75rem; color: #aaa; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .stat { background: #1a1a1a; border: 1px solid #333; border-radius: 6px; padding: 1rem; }
  .stat-value { font-size: 2rem; font-weight: 700; color: #fff; }
  .stat-label { font-size: 0.85rem; color: #888; margin-top: 0.25rem; }
  .settings { display: flex; gap: 1.5rem; margin-bottom: 2rem; flex-wrap: wrap; }
  .setting { background: #1a1a1a; border: 1px solid #333; border-radius: 6px; padding: 0.75rem 1rem; }
  .setting-label { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
  .setting-value { font-size: 0.95rem; color: #fff; margin-top: 0.25rem; }
  .on { color: #4caf50; }
  .off { color: #f44336; }
  .paused { color: #ff9800; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th { text-align: left; padding: 0.5rem; border-bottom: 1px solid #333; color: #888; font-weight: normal; }
  td { padding: 0.5rem; border-bottom: 1px solid #1a1a1a; }
  .comment-body { max-width: 500px; }
  .spam-body { max-width: 500px; color: #888; white-space: pre-wrap; word-break: break-word; }
  a { color: #4da6ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .actions a { margin-right: 0.75rem; font-size: 0.85rem; }
  .approve { color: #4caf50; }
  .spam-action { color: #f44336; }
  .reject { color: #ff9800; }
  .action-btn { background: none; border: none; cursor: pointer; font-size: 0.85rem; padding: 0; font-family: inherit; text-decoration: none; }
  .action-btn:hover { text-decoration: underline; }
  .search-form { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
  .search-form input[type="text"] { flex: 1; background: #1a1a1a; border: 1px solid #333; border-radius: 4px; padding: 0.4rem 0.6rem; color: #e0e0e0; font-size: 0.9rem; }
  .search-form button { background: #333; border: 1px solid #555; border-radius: 4px; padding: 0.4rem 0.8rem; color: #e0e0e0; font-size: 0.9rem; cursor: pointer; }
  .search-form button:hover { background: #444; }
  .pagination { display: flex; align-items: center; gap: 1rem; margin-top: 0.75rem; font-size: 0.9rem; color: #888; }
  .pagination a { color: #4da6ff; }
</style>
</head>
<body>
<h1>Admin Dashboard</h1>

<div class="settings">
  <div class="setting">
    <div class="setting-label">Comments</div>
    <div class="setting-value ${commentsMode}">${commentsMode}</div>
  </div>
  <div class="setting">
    <div class="setting-label">AI Mod</div>
    <div class="setting-value ${aiModEnabled ? "on" : "off"}">${aiModEnabled ? "on" : "off"}</div>
  </div>
  <div class="setting">
    <div class="setting-label">Moderation</div>
    <div class="setting-value">${aiModEnabled ? "AI decides (fail-closed)" : esc(env.MODERATION === "on" ? "manual review" : "auto-approve")}</div>
  </div>
</div>

<div class="stats">
  <div class="stat"><div class="stat-value">${stats.approved}</div><div class="stat-label">Approved</div></div>
  <div class="stat"><div class="stat-value">${stats.pending}</div><div class="stat-label">Pending</div></div>
  <div class="stat"><div class="stat-value">${stats.spam}</div><div class="stat-label">Spam blocked</div></div>
</div>

<h2>Top pages</h2>
<table>
  <tr><th>Page</th><th>Comments</th></tr>
  ${topPages.map((p) => `<tr><td><a href="${slugUrl(p.slug)}">${esc(p.slug)}</a></td><td>${p.count}</td></tr>`).join("\n  ")}
  ${topPages.length === 0 ? "<tr><td colspan=2>No comments yet</td></tr>" : ""}
</table>

<h2>Latest activity</h2>
<table>
  <tr><th>Page</th><th>Comments</th><th>Last comment</th></tr>
  ${latestPages.map((p: { slug: string; count: number; latest: string }) => `<tr><td><a href="${slugUrl(p.slug)}">${esc(p.slug)}</a></td><td>${p.count}</td><td>${p.latest.slice(0, 10)}</td></tr>`).join("\n  ")}
  ${latestPages.length === 0 ? "<tr><td colspan=3>No comments yet</td></tr>" : ""}
</table>

<h2>Pending queue</h2>
<form method="GET" action="/admin/dashboard" class="search-form">
  ${token ? `<input type="hidden" name="token" value="${esc(token)}">` : ""}
  <input type="text" name="q" placeholder="Search by author or comment…" value="${esc(q)}">
  <button type="submit">Search</button>
</form>
<div class="pagination">
  <span>Showing ${pending.length} of ${totalPending} &middot; Page ${page} of ${totalPages}</span>
  ${prevHref ? `<a href="${prevHref}">&laquo; Prev</a>` : ""}
  ${nextHref ? `<a href="${nextHref}">Next &raquo;</a>` : ""}
</div>
<table>
  <tr><th>Author</th><th>Comment</th><th>Page</th><th>Date</th><th>Actions</th></tr>
  ${pending.map((c) => `<tr>
    <td>${esc(c.author)}</td>
    <td class="comment-body">${esc(c.body)}</td>
    <td>${esc(c.slug)}</td>
    <td>${c.created_at.slice(0, 10)}</td>
    <td class="actions">
      <form method="POST" action="/approve/${c.id}${tokenParam}" style="display:inline"><button type="submit" class="approve action-btn">approve</button></form>
      <form method="POST" action="/spam/${c.id}${tokenParam}" style="display:inline"><button type="submit" class="spam-action action-btn">spam</button></form>
      <form method="POST" action="/reject/${c.id}${tokenParam}" style="display:inline"><button type="submit" class="reject action-btn">reject</button></form>
    </td>
  </tr>`).join("\n  ")}
  ${pending.length === 0 ? "<tr><td colspan=5>No pending comments</td></tr>" : ""}
</table>

<h2>Recent spam (${recentSpam.length})</h2>
<table>
  <tr><th>Author</th><th>Content</th><th>Date</th></tr>
  ${recentSpam.map((c) => `<tr>
    <td>${esc(c.author)}</td>
    <td class="spam-body">${esc(c.body)}</td>
    <td>${c.created_at.slice(0, 10)}</td>
  </tr>`).join("\n  ")}
  ${recentSpam.length === 0 ? "<tr><td colspan=3>No spam caught yet</td></tr>" : ""}
</table>

</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function slugUrl(slug: string): string {
  return slug === "landing" ? "/" : `/${slug}`;
}
