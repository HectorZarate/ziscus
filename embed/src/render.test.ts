import { describe, it, expect } from "vitest";
import { escHtml, unescapeHtml, renderComment, type Comment } from "./render.js";

describe("unescapeHtml", () => {
  const fixtures = [
    "plain text, no entities",
    "Tom & Jerry",
    "<script>alert(1)</script>",
    `He said "hi" and 'bye'`,
    `all five: & < > " '`,
    `bobby tables"`,
    "&lt; typed literally by the author",
    "",
  ];

  it.each(fixtures)("round-trips %j through escHtml", (s) => {
    expect(unescapeHtml(escHtml(s))).toBe(s);
  });

  it("decodes each of the five entities", () => {
    expect(unescapeHtml("&amp;")).toBe("&");
    expect(unescapeHtml("&lt;")).toBe("<");
    expect(unescapeHtml("&gt;")).toBe(">");
    expect(unescapeHtml("&quot;")).toBe('"');
    expect(unescapeHtml("&#39;")).toBe("'");
  });

  it("decodes &amp; last so &amp;lt; becomes &lt;, not <", () => {
    expect(unescapeHtml("&amp;lt;")).toBe("&lt;");
    expect(unescapeHtml("&amp;quot;")).toBe("&quot;");
    expect(unescapeHtml("&amp;amp;")).toBe("&amp;");
  });

  it("leaves entities it does not produce untouched", () => {
    expect(unescapeHtml("&copy; &nbsp; &#x27;")).toBe("&copy; &nbsp; &#x27;");
  });
});

describe("renderComment", () => {
  const comment: Comment = {
    id: "c1",
    slug: "landing",
    author: `bobby tables"`,
    body: `say "hi" & <b>wave</b>`,
    createdAt: "2026-04-05T12:00:00Z",
    status: "approved",
  };

  it("escapes a double quote exactly once", () => {
    const html = renderComment(comment);
    expect(html).toContain("bobby tables&quot;");
    expect(html).toContain("say &quot;hi&quot; &amp; &lt;b&gt;wave&lt;/b&gt;");
    expect(html).not.toContain("&amp;quot;");
    expect(html).not.toContain("<b>");
  });
});
