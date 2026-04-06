import { describe, it, expect } from "vitest";
import { THEMES, generateThemeCss } from "./themes.js";

describe("THEMES", () => {
  it("has light, dark, and terminal presets", () => {
    expect(THEMES.light).toBeDefined();
    expect(THEMES.dark).toBeDefined();
    expect(THEMES.terminal).toBeDefined();
  });

  it("each theme has text, bg, border, muted", () => {
    for (const [name, colors] of Object.entries(THEMES)) {
      expect(colors.text, `${name}.text`).toBeTruthy();
      expect(colors.bg, `${name}.bg`).toBeTruthy();
      expect(colors.border, `${name}.border`).toBeTruthy();
      expect(colors.muted, `${name}.muted`).toBeTruthy();
    }
  });
});

describe("generateThemeCss", () => {
  it("generates CSS with light theme custom properties", () => {
    const css = generateThemeCss("light");
    expect(css).toContain("--zc-text: #1a1a1a");
    expect(css).toContain("--zc-bg: #fff");
    expect(css).toContain("--zc-border: #e0e0e0");
    expect(css).toContain("--zc-muted: #6b6b6b");
  });

  it("generates CSS with dark theme", () => {
    const css = generateThemeCss("dark");
    expect(css).toContain("--zc-text: #e0e0e0");
    expect(css).toContain("--zc-bg: #1a1a1a");
  });

  it("generates CSS with terminal theme", () => {
    const css = generateThemeCss("terminal");
    expect(css).toContain("--zc-text: #FFB000");
    expect(css).toContain("--zc-bg: #0D0D0D");
  });

  it("falls back to light for unknown theme name", () => {
    const css = generateThemeCss("nonexistent");
    expect(css).toContain("--zc-text: #1a1a1a");
  });

  it("accepts custom ThemeColors object", () => {
    const css = generateThemeCss({ text: "#f00", bg: "#0f0", border: "#00f", muted: "#999" });
    expect(css).toContain("--zc-text: #f00");
    expect(css).toContain("--zc-bg: #0f0");
    expect(css).toContain("--zc-border: #00f");
    expect(css).toContain("--zc-muted: #999");
  });

  it("includes form styles", () => {
    const css = generateThemeCss("light");
    expect(css).toContain(".ziscus-form");
    expect(css).toContain(".ziscus-form button");
    expect(css).toContain("min-height: 44px");
  });

  it("includes comment styles", () => {
    const css = generateThemeCss("light");
    expect(css).toContain(".ziscus-comment");
    expect(css).toContain(".ziscus-header");
    expect(css).toContain(".ziscus-author");
    expect(css).toContain(".ziscus-body");
  });
});
