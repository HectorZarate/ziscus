export interface ThemeColors {
  text: string;
  bg: string;
  border: string;
  muted: string;
}

export const THEMES: Record<string, ThemeColors> = {
  light: { text: "#1a1a1a", bg: "#fff", border: "#e0e0e0", muted: "#6b6b6b" },
  dark: { text: "#e0e0e0", bg: "#1a1a1a", border: "#333", muted: "#888" },
  terminal: { text: "#FFB000", bg: "#0D0D0D", border: "#333", muted: "#AA7700" },
};

/** Generate ziscus CSS with the given theme's custom properties. */
export function generateThemeCss(theme: string | ThemeColors): string {
  const colors = typeof theme === "string" ? THEMES[theme] ?? THEMES.light! : theme;

  return `.ziscus { --zc-text: ${colors.text}; --zc-bg: ${colors.bg}; --zc-border: ${colors.border}; --zc-muted: ${colors.muted}; }
.ziscus { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--zc-border); }
.ziscus h2 { font-size: 1.2rem; margin-bottom: 1rem; color: var(--zc-text); }
.ziscus-comment { margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--zc-border); }
.ziscus-header { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; margin-bottom: 0.25rem; }
.ziscus-author { font-weight: bold; color: var(--zc-text); }
.ziscus-time { font-size: 0.85rem; color: var(--zc-muted); }
.ziscus-body { margin: 0; color: var(--zc-text); }
.ziscus-form { margin-top: 1.5rem; }
.ziscus-form label { display: block; margin-bottom: 0.25rem; font-size: 0.9rem; color: var(--zc-muted); }
.ziscus-form input, .ziscus-form textarea { width: 100%; padding: 0.5rem; margin-bottom: 0.75rem; border: 1px solid var(--zc-border); background: var(--zc-bg); color: var(--zc-text); font: inherit; box-sizing: border-box; }
.ziscus-form textarea { resize: vertical; }
.ziscus-form button { padding: 0.5rem 1.25rem; border: 1px solid var(--zc-border); background: var(--zc-text); color: var(--zc-bg); font: inherit; cursor: pointer; min-height: 44px; }
.ziscus-form button:hover { opacity: 0.85; }`;
}
