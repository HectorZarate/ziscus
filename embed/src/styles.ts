/**
 * CSS styles for the ziscus comments section.
 * Uses CSS custom properties so it inherits from your site's design system.
 * Override --ziscus-* variables or set --color-* variables for theming.
 */
export function ziscusStyles(): string {
  return `
#ziscus {
  --_text: var(--ziscus-text, var(--color-text, #1a1a1a));
  --_bg: var(--ziscus-bg, var(--color-bg, #fff));
  --_border: var(--ziscus-border, var(--color-border, #e0e0e0));
  --_muted: var(--ziscus-muted, var(--color-muted, #6b6b6b));
}
#ziscus { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--_border); }
#ziscus h2 { font-size: 1.2rem; margin-bottom: 1rem; }
.ziscus-comment { margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--_border); }
.ziscus-comment-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.25rem; }
.ziscus-comment-author { color: var(--_text); }
.ziscus-comment-header time { font-size: 0.85rem; color: var(--_muted); }
.ziscus-comment-body { margin: 0; color: var(--_text); }
.ziscus-form { margin-top: 1.5rem; }
.ziscus-form label { display: block; margin-bottom: 0.25rem; font-size: 0.9rem; color: var(--_muted); }
.ziscus-form input[type="text"], .ziscus-form textarea { width: 100%; padding: 0.5rem; margin-bottom: 0.75rem; border: 1px solid var(--_border); background: var(--_bg); color: var(--_text); font: inherit; box-sizing: border-box; }
.ziscus-form textarea { resize: vertical; }
.ziscus-form button { padding: 0.5rem 1.25rem; border: 1px solid var(--_border); background: var(--_text); color: var(--_bg); font: inherit; cursor: pointer; min-height: 44px; }
.ziscus-form button:hover { opacity: 0.85; }
`;
}
