/**
 * CSS styles for the comments section.
 * Uses CSS custom properties so it inherits from your site's design system.
 * Override --ziscus-* variables or set --color-* variables for theming.
 */
export function ziscusStyles(): string {
  return `
#comments { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--ziscus-border, var(--color-border, #e0e0e0)); }
#comments h2 { font-size: 1.2rem; margin-bottom: 1rem; }
.comment { margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--ziscus-border, var(--color-border, #e0e0e0)); }
.comment-header { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; margin-bottom: 0.25rem; }
.comment-author { color: var(--ziscus-text, var(--color-text, #1a1a1a)); }
.comment-header time { font-size: 0.85rem; color: var(--ziscus-muted, var(--color-muted, #6b6b6b)); }
.comment-body { margin: 0; color: var(--ziscus-text, var(--color-text, #1a1a1a)); }
.comment-form { margin-top: 1.5rem; }
.comment-form label { display: block; margin-bottom: 0.25rem; font-size: 0.9rem; color: var(--ziscus-muted, var(--color-muted, #6b6b6b)); }
.comment-form input[type="text"], .comment-form textarea { width: 100%; padding: 0.5rem; margin-bottom: 0.75rem; border: 1px solid var(--ziscus-border, var(--color-border, #e0e0e0)); background: var(--ziscus-bg, var(--color-bg, #fff)); color: var(--ziscus-text, var(--color-text, #1a1a1a)); font: inherit; box-sizing: border-box; }
.comment-form textarea { resize: vertical; }
.comment-form button { padding: 0.5rem 1.25rem; border: 1px solid var(--ziscus-border, var(--color-border, #e0e0e0)); background: var(--ziscus-text, var(--color-text, #1a1a1a)); color: var(--ziscus-bg, var(--color-bg, #fff)); font: inherit; cursor: pointer; min-height: 44px; }
.comment-form button:hover { opacity: 0.85; }
`;
}
