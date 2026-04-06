import type { Env } from "./types.js";

/** Max comments to query for the HTMLRewriter response. */
const REWRITER_COMMENT_LIMIT = 200;

/** Render a single comment as HTML */
function renderComment(author: string, body: string, createdAt: string, timeZone: string = "UTC"): string {
  const date = new Date(createdAt);
  const formatted = date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone,
  });

  return `<article class="comment">
        <header class="comment-header">
          <strong class="comment-author">${author}</strong>
          <time datetime="${createdAt}">${formatted}</time>
        </header>
        <p class="comment-body">${body}</p>
      </article>`;
}

/**
 * Serve the page with fresh comments injected via HTMLRewriter.
 * Fetches the static page from ASSETS, queries D1 for approved comments,
 * and rewrites the #comments section with up-to-date content.
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
    const pageUrl = new URL(
      redirectUrl.startsWith("/") ? redirectUrl : new URL(redirectUrl).pathname || "/",
      request.url,
    ).toString();

    const [pageRes, commentsResult] = await Promise.all([
      env.ASSETS.fetch(new Request(pageUrl)),
      env.DB.prepare(
        "SELECT author, body, created_at FROM comments WHERE slug = ? AND status = 'approved' ORDER BY created_at DESC LIMIT ?",
      )
        .bind(slug, REWRITER_COMMENT_LIMIT)
        .all<{ author: string; body: string; created_at: string }>(),
    ]);

    if (!pageRes.ok) {
      return redirect(redirectUrl);
    }

    const comments = (commentsResult.results ?? []).reverse();

    if (comments.length === 0) {
      return new Response(pageRes.body, {
        status: 200,
        headers: htmlHeaders(),
      });
    }

    // Use the requester's timezone from Cloudflare, fall back to UTC
    const tz = (request.cf as Record<string, unknown>)?.timezone as string || "UTC";

    const total = comments.length;
    const heading = `<h2>${total} ${total === 1 ? "Comment" : "Comments"}</h2>`;
    const commentHtml = comments
      .map((c) => renderComment(c.author, c.body, c.created_at, tz))
      .join("\n      ");
    const freshSection = `${heading}\n      ${commentHtml}`;

    const handler = {
      element(el: Element) {
        el.setInnerContent(freshSection, { html: true });
      },
    };
    const rewritten = new HTMLRewriter()
      .on("#comments", handler)
      .on("#ziscus", handler)
      .transform(pageRes);

    return new Response(rewritten.body, {
      status: 200,
      headers: htmlHeaders(),
    });
  } catch {
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
