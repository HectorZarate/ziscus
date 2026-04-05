/** Escape HTML to prevent XSS */
export function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\0/g, "");
}

/** A comment on a page */
export interface Comment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  slug: string;
  status: "pending" | "approved" | "rejected" | "spam";
}

/** Render a single comment as an HTML article element */
export function renderComment(comment: Comment): string {
  const date = new Date(comment.createdAt);
  const formatted = date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  return `<article class="ziscus-comment">
        <header class="ziscus-comment-header">
          <strong class="ziscus-comment-author">${escHtml(comment.author)}</strong>
          <time datetime="${escHtml(comment.createdAt)}">${formatted}</time>
        </header>
        <p class="ziscus-comment-body">${escHtml(comment.body)}</p>
      </article>`;
}

/** Render a list of approved comments wrapped in a section */
export function renderCommentList(comments: Comment[]): string {
  const approved = comments.filter((c) => c.status === "approved");
  const count = approved.length;

  const heading =
    count === 0
      ? `<h2>Comments</h2>\n      <p>No comments yet — be the first to comment.</p>`
      : `<h2>${count} ${count === 1 ? "Comment" : "Comments"}</h2>`;

  const items = approved.map((c) => renderComment(c)).join("\n      ");

  return `<section id="ziscus" class="ziscus-section">
      ${heading}
      ${items}
    </section>`;
}

/** Render the comment submission form */
export function renderCommentForm(
  slug: string,
  submitUrl: string,
  options?: { redirectUrl?: string },
): string {
  const redirectField = options?.redirectUrl
    ? `\n      <input type="hidden" name="redirect" value="${escHtml(options.redirectUrl)}">`
    : "";

  return `<form method="POST" action="${escHtml(submitUrl)}" class="ziscus-form">
      <input type="hidden" name="slug" value="${escHtml(slug)}">${redirectField}
      <div>
        <label for="ziscus-author">Name</label>
        <input type="text" name="author" id="ziscus-author" required>
      </div>
      <div>
        <label for="ziscus-body">Comment</label>
        <textarea name="body" id="ziscus-body" rows="4" required></textarea>
      </div>
      <button type="submit">Post Comment</button>
    </form>`;
}

/** Render the full comments section: list + form */
export function renderCommentsSection(
  comments: Comment[],
  slug: string,
  submitUrl: string,
  options?: { redirectUrl?: string },
): string {
  return `${renderCommentList(comments)}
    ${renderCommentForm(slug, submitUrl, options)}`;
}
