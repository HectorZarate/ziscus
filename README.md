# ziscus

Zero-JavaScript anonymous comment system with built-in moderation and anti-spam.

Inspired by [giscus](https://github.com/giscus/giscus), but with a fundamentally different philosophy:

| | giscus | ziscus |
|---|---|---|
| **Client JS** | Required (iframe + script) | None. Pure HTML forms |
| **Auth** | GitHub account required | Anonymous — no login needed |
| **Storage** | GitHub Discussions | Cloudflare D1 (SQLite at the edge) |
| **Moderation** | GitHub's built-in | Full moderation suite (approve/reject/spam/ban) |
| **Anti-spam** | GitHub's rate limits | Honeypot, rate limiting, URL filtering, IP banning |
| **Self-hosted** | Optional | Required (your Cloudflare account) |

## Architecture

```
┌──────────────┐     POST /submit      ┌──────────────────┐
│  Your static │ ──────────────────────>│  ziscus Worker   │
│  site (HTML) │                        │  (Cloudflare)    │
│              │     GET /comments/:slug│                  │
│  <form> ─────│ ──────────────────────>│  ┌────────────┐  │
│              │     JSON response      │  │ D1 (SQLite)│  │
└──────────────┘ <──────────────────────│  └────────────┘  │
                                        └──────────────────┘
                                               ▲
                                               │ Admin API
                                        ┌──────┴───────────┐
                                        │  CLI / curl       │
                                        │  (moderation)     │
                                        └──────────────────┘
```

Two packages:

- **`worker/`** — Cloudflare Worker that handles comment storage, submission, moderation, and anti-spam
- **`embed/`** — TypeScript library for rendering comments as static HTML in your build pipeline (publishable as `ziscus` on npm)

## Quick start

### 1. Deploy the Worker

```bash
cd worker
pnpm install

# Create a D1 database
wrangler d1 create ziscus-comments

# Update wrangler.toml with your database_id and ALLOWED_ORIGINS
# Then apply the schema:
wrangler d1 execute ziscus-comments --file=src/schema.sql

# Set your admin secret
wrangler secret put ADMIN_SECRET

# Deploy
wrangler deploy
```

### 2. Embed on your site

**Option A: Plain HTML (no build step)**

Add this wherever you want comments:

```html
<section id="ziscus" class="ziscus-section">
  <h2>Comments</h2>
  <p>No comments yet — be the first to comment.</p>
</section>

<form method="POST" action="https://your-worker.workers.dev/submit" class="ziscus-form">
  <input type="hidden" name="slug" value="your-page-slug">
  <!-- Honeypot field — hidden from real users, catches bots -->
  <div style="display:none"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>
  <div>
    <label for="ziscus-author">Name</label>
    <input type="text" name="author" id="ziscus-author" required>
  </div>
  <div>
    <label for="ziscus-body">Comment</label>
    <textarea name="body" id="ziscus-body" rows="4" required></textarea>
  </div>
  <button type="submit">Post Comment</button>
</form>
```

**Option B: Static site generator (Node.js)**

```bash
pnpm add ziscus
```

```ts
import { fetchComments, renderCommentsSection, ziscusStyles } from "ziscus";

// At build time — fetch approved comments and bake into HTML
const comments = await fetchComments("my-post-slug", "https://your-worker.workers.dev");
const html = renderCommentsSection(comments, "my-post-slug", "https://your-worker.workers.dev/submit");
const css = ziscusStyles();

// Inject into your page template
const page = `
  <style>${css}</style>
  ${html}
`;
```

## Anti-spam

Built-in, zero-configuration:

- **Honeypot field** — hidden `website` input that bots fill out; silently rejected with fake success
- **Rate limiting** — 5 comments per IP per hour (configurable via `RATE_LIMIT` env var)
- **URL filtering** — rejects comments with more than 3 URLs
- **IP banning** — manual ban list with reasons
- **CSRF protection** — Origin/Referer validation against `ALLOWED_ORIGINS`
- **HTML escaping** — all user input escaped server-side to prevent stored XSS

## Moderation

Three global modes:

| Mode | Submissions | Visibility |
|---|---|---|
| `on` (default) | Accepted | Approved comments visible |
| `paused` | Accepted as pending | All comments hidden |
| `off` | Rejected (403) | All comments hidden |

When `MODERATION=on` (default), new comments start as `pending` and require admin approval.
Set `MODERATION=off` to auto-approve (still protected by anti-spam).

### Admin API

All admin endpoints require `Authorization: Bearer <ADMIN_SECRET>`.

```bash
# Dashboard stats
curl -H "Authorization: Bearer $SECRET" https://worker.dev/admin/stats

# List pending comments
curl -H "Authorization: Bearer $SECRET" "https://worker.dev/admin/comments?status=pending"

# Approve / reject / spam / unapprove
curl -X POST -H "Authorization: Bearer $SECRET" https://worker.dev/approve/<id>
curl -X POST -H "Authorization: Bearer $SECRET" https://worker.dev/reject/<id>
curl -X POST -H "Authorization: Bearer $SECRET" https://worker.dev/spam/<id>
curl -X POST -H "Authorization: Bearer $SECRET" https://worker.dev/unapprove/<id>

# Bulk approve all pending for a page
curl -X POST -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
  -d '{"slug":"my-post"}' https://worker.dev/admin/bulk/approve

# Delete permanently
curl -X DELETE -H "Authorization: Bearer $SECRET" https://worker.dev/comments/<id>

# Ban / unban IPs
curl -X POST -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
  -d '{"ip_hash":"abc123","reason":"spam"}' https://worker.dev/admin/ban

# Set mode
curl -X POST -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
  -d '{"mode":"paused"}' https://worker.dev/admin/mode
```

## Theming

ziscus uses CSS custom properties. Override them to match your site:

```css
#ziscus {
  --ziscus-text: #1a1a1a;
  --ziscus-bg: #fff;
  --ziscus-border: #e0e0e0;
  --ziscus-muted: #6b6b6b;
}
```

Or if your site already uses `--color-text`, `--color-bg`, etc., ziscus picks those up automatically.

## Optional: Auto-rebuild on new comments

If your static site is built via GitHub Actions, ziscus can trigger a rebuild when a comment is approved:

1. Set `GITHUB_REPO` in wrangler.toml (e.g., `owner/repo`)
2. Set `GITHUB_TOKEN` as a Wrangler secret
3. Add a workflow triggered by `repository_dispatch` with event type `rebuild-comments`

Rebuilds are debounced (30s window) to prevent thundering herd on bulk approvals.

## Development

```bash
pnpm install
pnpm test        # run all tests
pnpm typecheck   # type-check all packages
```

## License

MIT
