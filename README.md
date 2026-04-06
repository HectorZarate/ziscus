# ziscus

[![npm](https://img.shields.io/npm/v/ziscus)](https://www.npmjs.com/package/ziscus)

Comments for static sites. No JavaScript. No accounts. Just an HTML form.

A Cloudflare Worker stores comments in [D1](https://developers.cloudflare.com/d1/), your SSG bakes them into HTML at build time. Moderation via curl.

**Live demo:** [ziscus.com](https://ziscus.com)

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

### CLI (fastest way)

```bash
npx ziscus init    # scaffold config and deploy the Worker
npx ziscus fetch   # pull comments and render static HTML
```

That's it. The CLI handles Worker deployment, D1 setup, and code generation. Read on if you want to understand each piece or set things up manually.

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

### 4. Auto-rebuild on new comments

When a comment is posted, the commenter sees it instantly. To make it visible to everyone else, the static site needs to rebuild. ziscus triggers this automatically via GitHub Actions.

**Set up the Worker secrets:**

```bash
cd worker

# Set your repo (owner/repo format)
# Already in wrangler.toml as GITHUB_REPO — update it to match your repo

# Create a fine-grained GitHub token:
# → https://github.com/settings/personal-access-tokens/new
# → Repository access: select your site repo
# → Permissions: Contents → Read and write
wrangler secret put GITHUB_TOKEN
```

**Add the workflow** (already included at `.github/workflows/rebuild-comments.yml`):

```yaml
name: Rebuild comments
on:
  repository_dispatch:
    types: [rebuild-comments]

permissions:
  contents: write

jobs:
  rebuild:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }

      - name: Install rsslobster
        run: |
          git clone --depth 1 https://github.com/HectorZarate/rsslobster.git /tmp/rsslobster
          cd /tmp/rsslobster
          pnpm install --frozen-lockfile
          pnpm build
          pnpm link --global

      - name: Regenerate site
        run: cd site && rsslobster regenerate

      - name: Commit and push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add site/_site/
          git diff --cached --quiet && echo "No changes" && exit 0
          git commit -m "rebuild: bake comments for ${{ github.event.client_payload.slug }}"
          git push
```

The Worker debounces rebuild triggers (30s window) to avoid flooding on bulk approvals.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
```

## License

MIT
