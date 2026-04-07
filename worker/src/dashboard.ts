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

export async function handleDashboard(request: Request, env: Env): Promise<Response> {
  if (!checkDashboardAuth(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const [statsResult, topPagesResult, aiActionsResult, pendingResult] = await Promise.all([
    env.DB.prepare("SELECT status, COUNT(*) as count FROM comments GROUP BY status")
      .all<{ status: string; count: number }>(),
    env.DB.prepare("SELECT slug, COUNT(*) as count FROM comments WHERE status = 'approved' GROUP BY slug ORDER BY count DESC LIMIT 10")
      .all<{ slug: string; count: number }>(),
    env.DB.prepare("SELECT action, COUNT(*) as count FROM mod_log WHERE actor = 'ai' GROUP BY action")
      .all<{ action: string; count: number }>(),
    env.DB.prepare("SELECT id, slug, author, body, created_at FROM comments WHERE status = 'pending' ORDER BY created_at DESC LIMIT 20")
      .all<{ id: string; slug: string; author: string; body: string; created_at: string }>(),
  ]);

  const stats: Record<string, number> = { pending: 0, approved: 0, rejected: 0, spam: 0 };
  for (const row of statsResult.results ?? []) {
    stats[row.status] = row.count;
  }

  const topPages = topPagesResult.results ?? [];
  const pending = pendingResult.results ?? [];

  // Spam catch rate
  let aiTotal = 0;
  let aiSpam = 0;
  for (const row of aiActionsResult.results ?? []) {
    aiTotal += row.count;
    if (row.action === "ai_spam") aiSpam = row.count;
  }
  const spamRate = aiTotal > 0 ? Math.round((aiSpam / aiTotal) * 100) : 0;

  const token = new URL(request.url).searchParams.get("token") ?? "";
  const tokenParam = token ? `?token=${token}` : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ziscus dashboard</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem 1rem; background: #0d0d0d; color: #e0e0e0; }
  h1 { font-size: 1.4rem; margin-bottom: 1.5rem; color: #fff; }
  h2 { font-size: 1.1rem; margin: 1.5rem 0 0.75rem; color: #aaa; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .stat { background: #1a1a1a; border: 1px solid #333; border-radius: 6px; padding: 1rem; }
  .stat-value { font-size: 2rem; font-weight: 700; color: #fff; }
  .stat-label { font-size: 0.85rem; color: #888; margin-top: 0.25rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th { text-align: left; padding: 0.5rem; border-bottom: 1px solid #333; color: #888; font-weight: normal; }
  td { padding: 0.5rem; border-bottom: 1px solid #1a1a1a; }
  .pending-body { max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  a { color: #4da6ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .actions a { margin-right: 0.75rem; font-size: 0.85rem; }
  .approve { color: #4caf50; }
  .spam { color: #f44336; }
  .reject { color: #ff9800; }
</style>
</head>
<body>
<h1>ziscus dashboard</h1>

<div class="stats">
  <div class="stat"><div class="stat-value">${stats.approved}</div><div class="stat-label">Approved</div></div>
  <div class="stat"><div class="stat-value">${stats.pending}</div><div class="stat-label">Pending</div></div>
  <div class="stat"><div class="stat-value">${stats.spam}</div><div class="stat-label">Spam</div></div>
  <div class="stat"><div class="stat-value">${spamRate}%</div><div class="stat-label">AI spam catch rate</div></div>
</div>

<h2>Top pages</h2>
<table>
  <tr><th>Page</th><th>Comments</th></tr>
  ${topPages.map((p) => `<tr><td>${esc(p.slug)}</td><td>${p.count}</td></tr>`).join("\n  ")}
  ${topPages.length === 0 ? "<tr><td colspan=2>No comments yet</td></tr>" : ""}
</table>

<h2>Pending queue (${pending.length})</h2>
<table>
  <tr><th>Author</th><th>Comment</th><th>Page</th><th>Date</th><th>Actions</th></tr>
  ${pending.map((c) => `<tr>
    <td>${esc(c.author)}</td>
    <td class="pending-body">${esc(c.body)}</td>
    <td>${esc(c.slug)}</td>
    <td>${c.created_at.slice(0, 10)}</td>
    <td class="actions">
      <a class="approve" href="/approve/${c.id}${tokenParam}" onclick="return fetch('/approve/${c.id}',{method:'POST',headers:{'Authorization':'Bearer ${token}'}}).then(()=>location.reload())">approve</a>
      <a class="spam" href="/spam/${c.id}${tokenParam}" onclick="return fetch('/spam/${c.id}',{method:'POST',headers:{'Authorization':'Bearer ${token}'}}).then(()=>location.reload())">spam</a>
      <a class="reject" href="/reject/${c.id}${tokenParam}" onclick="return fetch('/reject/${c.id}',{method:'POST',headers:{'Authorization':'Bearer ${token}'}}).then(()=>location.reload())">reject</a>
    </td>
  </tr>`).join("\n  ")}
  ${pending.length === 0 ? "<tr><td colspan=5>No pending comments</td></tr>" : ""}
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
