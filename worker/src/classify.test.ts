import { describe, it, expect, vi } from "vitest";
import { classifyComment } from "./classify.js";
import type { Env } from "./types.js";

function mockEnv(response?: string | Error): Env {
  const ai = response instanceof Error
    ? { run: vi.fn().mockRejectedValue(response) }
    : response !== undefined
    ? { run: vi.fn().mockResolvedValue({ response }) }
    : undefined;

  return {
    AI_MOD: ai as unknown as Env["AI_MOD"],
    DB: {} as unknown as Env["DB"],
    ASSETS: {} as unknown as Env["ASSETS"],
    ALLOWED_ORIGINS: "",
    MODERATION: "off",
  } as Env;
}

function envWithoutAI(): Env {
  return {
    DB: {} as unknown as Env["DB"],
    ASSETS: {} as unknown as Env["ASSETS"],
    ALLOWED_ORIGINS: "",
    MODERATION: "off",
  } as Env;
}

function slowEnv(delayMs: number): Env {
  return {
    AI_MOD: {
      run: vi.fn().mockImplementation(() =>
        new Promise((resolve) => setTimeout(() => resolve({ response: "approve" }), delayMs))
      ),
    } as unknown as Env["AI_MOD"],
    DB: {} as unknown as Env["DB"],
    ASSETS: {} as unknown as Env["ASSETS"],
    ALLOWED_ORIGINS: "",
    MODERATION: "off",
  } as Env;
}

describe("classifyComment", () => {
  // --- Fallback behavior ---

  it("returns approve when AI binding is missing", async () => {
    const result = await classifyComment("test", "hello", envWithoutAI());
    expect(result).toBe("approve");
  });

  it("returns review when AI call throws (fail-closed)", async () => {
    const result = await classifyComment("test", "hello", mockEnv(new Error("model error")));
    expect(result).toBe("review");
  });

  it("returns review when AI call times out (fail-closed)", async () => {
    const result = await classifyComment("test", "hello", slowEnv(5000));
    expect(result).toBe("review");
  }, 6000);

  // --- Response parsing ---

  it("parses 'spam' response", async () => {
    const result = await classifyComment("test", "buy SEO", mockEnv("spam"));
    expect(result).toBe("spam");
  });

  it("parses 'approve' response", async () => {
    const result = await classifyComment("test", "great post", mockEnv("approve"));
    expect(result).toBe("approve");
  });

  it("parses 'review' response", async () => {
    const result = await classifyComment("test", "hmm", mockEnv("review"));
    expect(result).toBe("review");
  });

  it("parses 'Spam.' with capitalization and punctuation", async () => {
    const result = await classifyComment("test", "spam text", mockEnv("Spam."));
    expect(result).toBe("spam");
  });

  it("parses ' approve ' with whitespace", async () => {
    const result = await classifyComment("test", "good", mockEnv("  approve  "));
    expect(result).toBe("approve");
  });

  it("returns review for unexpected response (hallucination)", async () => {
    const result = await classifyComment("test", "hello", mockEnv("I cannot classify this comment"));
    expect(result).toBe("review");
  });

  it("returns review for empty response", async () => {
    const result = await classifyComment("test", "hello", mockEnv(""));
    expect(result).toBe("review");
  });

  // --- Input sanitization ---

  it("truncates body to 500 chars", async () => {
    const env = mockEnv("approve");
    const longBody = "a".repeat(1000);
    await classifyComment("test", longBody, env);
    const call = (env.AI_MOD!.run as ReturnType<typeof vi.fn>).mock.calls[0];
    const userMessage = call[1].messages[1].content;
    // Body should be truncated, not the full 1000 chars
    expect(userMessage.length).toBeLessThan(700);
  });

  it("strips < and > from author and body", async () => {
    const env = mockEnv("approve");
    await classifyComment("<script>alert</script>", "test <img src=x>", env);
    const call = (env.AI_MOD!.run as ReturnType<typeof vi.fn>).mock.calls[0];
    const userMessage = call[1].messages[1].content;
    expect(userMessage).not.toContain("<");
    expect(userMessage).not.toContain(">");
  });

  // --- Model call shape ---

  it("calls AI with correct model and parameters", async () => {
    const env = mockEnv("approve");
    await classifyComment("Alice", "Great post!", env);
    const call = (env.AI_MOD!.run as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("@cf/meta/llama-3.1-8b-instruct");
    expect(call[1].max_tokens).toBe(5);
    expect(call[1].temperature).toBe(0);
    expect(call[1].stream).toBe(false);
    expect(call[1].messages).toHaveLength(2);
    expect(call[1].messages[0].role).toBe("system");
    expect(call[1].messages[1].role).toBe("user");
    expect(call[1].messages[1].content).toContain("Alice");
    expect(call[1].messages[1].content).toContain("Great post!");
  });
});
