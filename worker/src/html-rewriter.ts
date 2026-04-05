import type { Env } from "./types.js";

/** Max comments to query for the HTMLRewriter response. */
const REWRITER_COMMENT_LIMIT = 200;

/** Render a single comment as HTML */
function renderComment(author: string, body: string, createdAt: string): string {
  const date = new Date(createdAt);
  const formatted = date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `<article class="ziscus-comment">
        <header class="ziscus-comment-header">
          <strong class="ziscus-comment-author">${author}</strong>
          <time datetime="${createdAt}">${formatted}</time>
        </header>
        <p class="ziscus-comment-body">${body}</p>
      </article>`;
}

/**
 * Serve the page with fresh comments injected via HTMLRewriter.
 * Fetches the static page from ASSETS, queries D1 for approved comments,
 * and rewrites the #ziscus section with up-to-date content.
 *
 * Falls back to a 303 redirect on any failure — the comment is already in D1.
 */
export async function serveWithFreshComments(
  slug: string,
  redirectUrl: string,
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    // Use the original request's URL origin for ASSETS fetch
    const url = new URL(request.url);
    const assetUrl = new URL(redirectUrl.startsWith("/") ? redirectUrl : new URL(redirectUrl).pathname, url.origin);

    // Fetch page and comments in parallel
    const [pageRes, commentsResult] = await Promise.all([
      env.ASSETS.fetch(assetUrl.toString()),
      env.DB.prepare(
        "SELECT author, body, created_at FROM comments WHERE slug = ? AND status = 'approved' ORDER BY created_at DESC LIMIT ?",
      )
        .bind(slug, REWRITER_COMMENT_LIMIT)
        .all<{ author: string; body: string; created_at: string }>(),
    ]);

    if (!pageRes.ok) {
      return redirect(redirectUrl);
    }

    // Reverse to chronological order (queried DESC for efficiency with LIMIT)
    const comments = (commentsResult.results ?? []).reverse();

    if (comments.length === 0) {
      return new Response(pageRes.body, {
        status: 200,
        headers: htmlHeaders(),
      });
    }

    // Build the comments HTML
    const total = comments.length;
    const heading = `<h3>${total} ${total === 1 ? "Comment" : "Comments"}</h3>`;
    const commentHtml = comments
      .map((c) => renderComment(c.author, c.body, c.created_at))
      .join("\n      ");
    const freshSection = `${heading}\n      ${commentHtml}`;

    // Stream through HTMLRewriter — replaces comment section content
    // Supports both #comments (rss lobster) and #ziscus (standalone embed)
    const rewritten = new HTMLRewriter()
      .on("#comments, #ziscus", {
        element(el) {
          el.setInnerContent(freshSection, { html: true });
        },
      })
      .transform(pageRes);

    return new Response(rewritten.body, {
      status: 200,
      headers: htmlHeaders(),
    });
  } catch (err) {
    console.error("[ziscus] HTMLRewriter failed:", err instanceof Error ? err.message : err);
    return redirect(redirectUrl);
  }
}

function redirect(url: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: url },
  });
}

function htmlHeaders(): HeadersInit {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  };
}
