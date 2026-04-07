export interface FilterResult {
  blocked: boolean;
  reason: string;
}

/** Invisible unicode characters used for text obfuscation */
const INVISIBLE_RE = /[\u200B\u200C\u200D\u200E\u200F\u2060\u2061\u2062\u2063\u2064\uFEFF\u202A-\u202E]/g;
const MAX_INVISIBLE_CHARS = 5;

/** Same character repeated 20+ times in a row */
const REPETITION_RE = /(.)\1{19,}/;

/** At least one sequence of 2+ alphanumeric or common unicode letters */
const HAS_WORD_RE = /[\p{L}\p{N}]{2,}|[+]\d/u;

/** Max length for a single non-whitespace token (excluding URLs) */
const MAX_TOKEN_LENGTH = 200;
const URL_PREFIX_RE = /^https?:\/\//;

/**
 * Layer 0: Structural / malicious payload filter.
 *
 * Catches payloads that no legitimate comment would ever produce.
 * Does NOT filter on content (that's the AI's job).
 */
export function structuralFilter(author: string, body: string): FilterResult {
  const combined = author + body;

  // 1. Null bytes — injection vector
  if (combined.includes("\0")) {
    return { blocked: true, reason: "Null bytes are not allowed" };
  }

  // 2. Invisible unicode abuse — text obfuscation
  const invisibleCount = (combined.match(INVISIBLE_RE) ?? []).length;
  if (invisibleCount > MAX_INVISIBLE_CHARS) {
    return { blocked: true, reason: "Too many invisible unicode characters" };
  }

  // 3. Excessive character repetition — padding / noise
  if (REPETITION_RE.test(author) || REPETITION_RE.test(body)) {
    return { blocked: true, reason: "Excessive character repetition" };
  }

  // 4. No word-like content — pure symbols / gibberish
  if (!HAS_WORD_RE.test(body)) {
    return { blocked: true, reason: "Comment must contain word-like content" };
  }

  // 5. Long unbroken tokens — encoded/binary payloads (skip URLs)
  const tokens = body.split(/\s+/);
  for (const token of tokens) {
    if (token.length > MAX_TOKEN_LENGTH && !URL_PREFIX_RE.test(token)) {
      return { blocked: true, reason: "Unusually long token detected" };
    }
  }

  return { blocked: false, reason: "" };
}
