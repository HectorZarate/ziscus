# ziscus

Comments for static sites. No JavaScript. No accounts. Just an HTML form.

A Cloudflare Worker stores comments in [D1](https://developers.cloudflare.com/d1/), your SSG bakes them into HTML at build time. Moderation via curl.

Inspired by [giscus](https://github.com/giscus/giscus), but different:

- **No client JavaScript** — pure HTML forms, no iframe
- **Anonymous** — no GitHub account required to comment
- **Cloudflare D1** — SQLite at the edge, not GitHub Discussions
- **Full moderation** — approve / reject / spam / ban via API
- **Free** — runs on Cloudflare's free tier

Two packages:

- **`worker/`** — Cloudflare Worker (comment storage, moderation, submission)
- **`embed/`** — TypeScript library for rendering comments as static HTML (`ziscus` on npm)

## Quick start

### 1. Deploy the Worker

```bash
cd worker
pnpm install

wrangler d1 create ziscus-comments
# Update wrangler.toml with your database_id and ALLOWED_ORIGINS
wrangler d1 execute ziscus-comments --remote --file=src/schema.sql

# Generate and set admin secret
openssl rand -hex 32
wrangler secret put ADMIN_SECRET

wrangler deploy
```

### 2. Embed on your site

**Plain HTML:**

```html
<form method="POST" action="https://your-worker.workers.dev/submit">
  <input type="hidden" name="slug" value="your-page-slug">
  <input type="text" name="author" required>
  <textarea name="body" rows="4" required></textarea>
  <button type="submit">Post Comment</button>
</form>
```

**Static site generator (Node.js):**

```ts
import { fetchComments, renderCommentsSection, ziscusStyles } from "ziscus";

const comments = await fetchComments("my-post", "https://your-worker.workers.dev");
const html = renderCommentsSection(comments, "my-post", "https://your-worker.workers.dev/submit");
const css = ziscusStyles();
```

### 3. Moderate

```bash
curl -H "Authorization: Bearer $SECRET" https://worker.dev/admin/comments?status=pending
curl -X POST -H "Authorization: Bearer $SECRET" https://worker.dev/approve/<id>
curl -X POST -H "Authorization: Bearer $SECRET" https://worker.dev/reject/<id>
curl -X POST -H "Authorization: Bearer $SECRET" https://worker.dev/spam/<id>
curl -X DELETE -H "Authorization: Bearer $SECRET" https://worker.dev/comments/<id>
```

Three global modes (`POST /admin/mode`):

| Mode | Submissions | Visibility |
|---|---|---|
| `on` (default) | Accepted | Approved only |
| `paused` | Queued as pending | Hidden |
| `off` | Rejected (403) | Hidden |

## Theming

Override CSS custom properties to match your site:

```css
#ziscus {
  --ziscus-text: #1a1a1a;
  --ziscus-bg: #fff;
  --ziscus-border: #e0e0e0;
  --ziscus-muted: #6b6b6b;
}
```

Falls back to `--color-text`, `--color-bg`, etc. if your site already uses them.

## Auto-rebuild on new comments

If your site builds via GitHub Actions, ziscus can trigger a rebuild when a comment is approved:

1. Set `GITHUB_REPO` in wrangler.toml
2. Set `GITHUB_TOKEN` as a Wrangler secret
3. Add a workflow on `repository_dispatch` event type `rebuild-comments`

Rebuilds are debounced (30s window).

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
```

## License

MIT
