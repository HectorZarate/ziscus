import type { Env } from "./types.js";

export type Classification = "approve" | "spam" | "review";

const MODEL = "@cf/meta/llama-3.1-8b-instruct";
const MAX_BODY_CHARS = 500;
const AI_TIMEOUT_MS = 3000;

const SYSTEM_PROMPT = `You are a comment spam classifier for a blog/website comment system.
Classify the following comment as exactly one of: approve, spam, review.

- approve: legitimate comment, question, feedback, or discussion
- spam: advertising, SEO pitches, unsolicited services, phishing, or promotional content
- review: uncertain or borderline

Respond with ONLY one word: approve, spam, or review.`;

export async function classifyComment(
  author: string,
  body: string,
  env: Env,
): Promise<Classification> {
  if (!env.AI) return "approve";

  const safeAuthor = author.slice(0, 100).replace(/[<>]/g, "");
  const safeBody = body.slice(0, MAX_BODY_CHARS).replace(/[<>]/g, "");

  try {
    const result = await Promise.race([
      (env.AI.run as Function)(MODEL, {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Author: ${safeAuthor}\nComment: ${safeBody}` },
        ],
        max_tokens: 5,
        temperature: 0,
        stream: false,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("AI timeout")), AI_TIMEOUT_MS),
      ),
    ]);

    const response = (result as { response: string }).response
      .trim()
      .toLowerCase();

    if (response.startsWith("spam")) return "spam";
    if (response.startsWith("approve")) return "approve";
    if (response.startsWith("review")) return "review";

    console.error(`[ziscus] Unexpected AI response: "${response}"`);
    return "review";
  } catch (err) {
    console.error(`[ziscus] AI classification failed: ${err instanceof Error ? err.message : err}`);
    return "approve";
  }
}
