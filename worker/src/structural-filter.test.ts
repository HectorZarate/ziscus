import { describe, it, expect } from "vitest";
import { structuralFilter } from "./structural-filter.js";

describe("structuralFilter", () => {
  // --- Should BLOCK ---

  it("blocks body containing null bytes", () => {
    const result = structuralFilter("Alice", "hello\0world");
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/null/i);
  });

  it("blocks author containing null bytes", () => {
    const result = structuralFilter("Ali\0ce", "hello world");
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/null/i);
  });

  it("blocks body with excessive invisible unicode characters", () => {
    const body = "hello" + "\u200B".repeat(10) + "world";
    const result = structuralFilter("Alice", body);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/invisible/i);
  });

  it("blocks body with mixed invisible unicode types", () => {
    // zero-width space, non-joiner, joiner, LTR mark, RTL mark, word joiner
    const body = "test\u200B\u200C\u200D\u200E\u200F\u2060test";
    const result = structuralFilter("Alice", body);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/invisible/i);
  });

  it("blocks author with excessive invisible unicode", () => {
    const author = "A\u200B\u200B\u200B\u200B\u200B\u200Blice";
    const result = structuralFilter(author, "hello world");
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/invisible/i);
  });

  it("blocks body with excessive character repetition", () => {
    const body = "a".repeat(50);
    const result = structuralFilter("Alice", body);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/repeti/i);
  });

  it("blocks author with excessive character repetition", () => {
    const result = structuralFilter("a".repeat(30), "hello world");
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/repeti/i);
  });

  it("blocks body with no word-like content", () => {
    const body = "!@#$%^&*()_+-=[]{}|;':\",./<>?";
    const result = structuralFilter("Alice", body);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/word/i);
  });

  it("blocks body that is only whitespace and punctuation", () => {
    const body = "   ... --- !!!   ";
    const result = structuralFilter("Alice", body);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/word/i);
  });

  it("blocks body with long unbroken non-URL token", () => {
    // Simulates base64 blob or encoded payload
    const body = "check this: " + "abcdefgh".repeat(40);
    const result = structuralFilter("Alice", body);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/token/i);
  });

  // --- Should ALLOW ---

  it("allows normal short comment", () => {
    const result = structuralFilter("Alice", "Great article, thanks!");
    expect(result.blocked).toBe(false);
  });

  it("allows comment with emojis", () => {
    const result = structuralFilter("Bob", "Love this! 🎉🚀💯");
    expect(result.blocked).toBe(false);
  });

  it("allows comment with legitimate unicode", () => {
    const result = structuralFilter("Jose", "Tres bien! 日本語テスト");
    expect(result.blocked).toBe(false);
  });

  it("allows moderate repetition like emphasis", () => {
    const result = structuralFilter("Fan", "nooooo way this is so cool");
    expect(result.blocked).toBe(false);
  });

  it("allows comment with code snippet", () => {
    const result = structuralFilter("dev", "Try using `const x = foo()` instead");
    expect(result.blocked).toBe(false);
  });

  it("allows comment with URLs containing long paths", () => {
    const result = structuralFilter(
      "reader",
      "Check https://example.com/very/long/path/to/some/deeply/nested/resource/that-is-really-quite-long-indeed for details",
    );
    expect(result.blocked).toBe(false);
  });

  it("allows single word comment", () => {
    const result = structuralFilter("anon", "nice");
    expect(result.blocked).toBe(false);
  });

  it("allows +1 style comment", () => {
    const result = structuralFilter("anon", "+1");
    expect(result.blocked).toBe(false);
  });

  it("allows comment with a few invisible chars from copy-paste", () => {
    const body = "hello\u200Bworld";
    const result = structuralFilter("Alice", body);
    expect(result.blocked).toBe(false);
  });

  it("allows comment with moderate-length technical terms", () => {
    const result = structuralFilter("dev", "The AbstractSingletonProxyFactoryBean is an anti-pattern");
    expect(result.blocked).toBe(false);
  });

  it("allows legitimate multi-paragraph comment", () => {
    const body = "First paragraph here.\n\nSecond paragraph with more thoughts.\n\nThird paragraph wrapping up.";
    const result = structuralFilter("Reader", body);
    expect(result.blocked).toBe(false);
  });
});
