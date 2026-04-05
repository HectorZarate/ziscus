#!/bin/bash
# Fetch approved comments from the ziscus API and inject them into the landing page.
# Run after `rsslobster regenerate` to bake live comments into the static HTML.

set -e

ENDPOINT="https://ziscus.com/comments/landing"
INDEX="$( cd "$(dirname "$0")" && pwd )/_site/index.html"

# Fetch comments JSON
COMMENTS=$(curl -sf "$ENDPOINT" 2>/dev/null || echo "[]")
COUNT=$(echo "$COMMENTS" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const c=JSON.parse(d); console.log(c.length)")

if [ "$COUNT" = "0" ]; then
  echo "No comments to inject."
  exit 0
fi

# Build comment HTML
COMMENT_HTML=$(echo "$COMMENTS" | node -e "
const data = require('fs').readFileSync('/dev/stdin', 'utf8');
const comments = JSON.parse(data);
const heading = '<h3>' + comments.length + ' ' + (comments.length === 1 ? 'Comment' : 'Comments') + '</h3>';
const items = comments.map(c => {
  const d = new Date(c.created_at);
  const fmt = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return '<article class=\"ziscus-comment\"><header class=\"ziscus-comment-header\"><strong class=\"ziscus-comment-author\">' + c.author + '</strong><time datetime=\"' + c.created_at + '\">' + fmt + '</time></header><p class=\"ziscus-comment-body\">' + c.body + '</p></article>';
}).join('\n      ');
console.log(heading + '\n      ' + items);
")

# Replace the #ziscus section content using node
node -e "
const fs = require('fs');
const html = fs.readFileSync('$INDEX', 'utf8');
const replacement = \`$COMMENT_HTML\`;
const updated = html.replace(
  /(<section id=\"ziscus\"[^>]*>)[\\s\\S]*?(<\\/section>)/,
  '\$1\\n      ' + replacement + '\\n    \$2'
);
fs.writeFileSync('$INDEX', updated);
"

echo "Injected $COUNT comments into index.html"
