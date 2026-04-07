import type { Env } from "./types.js";

export type Classification = "approve" | "spam" | "review";

const MODEL = "@cf/meta/llama-3.1-8b-instruct";
const MAX_BODY_CHARS = 500;
const AI_TIMEOUT_MS = 3000;

const SYSTEM_PROMPT = `You classify blog comments as approve, spam, or review.

approve: any legitimate comment. Short reactions ("nice", "thanks", "+1"), technical questions, feedback, criticism, bug reports, bot status updates, and links to related content are all legitimate. When in doubt, approve.

spam: unsolicited commercial content. SEO pitches, marketing services, crypto/trading schemes, fake earnings claims, guest post requests with backlinks, and "contact me for a proposal" outreach.

review: only when you genuinely cannot tell. This should be rare.

Respond with one word only.`;

export async function classifyComment(
  author: string,
  body: string,
  env: Env,
): Promise<Classification> {
  if (!env.AI_MOD) return "approve";

  const safeAuthor = author.slice(0, 100).replace(/[<>]/g, "");
  const safeBody = body.slice(0, MAX_BODY_CHARS).replace(/[<>]/g, "");

  try {
    const result = await Promise.race([
      (env.AI_MOD.run as Function)(MODEL, {
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
    return "review";
  }
}
