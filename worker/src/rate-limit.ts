/** Check if an IP hash is within rate limit. Returns { allowed, remaining }. */
export async function checkRateLimit(
  db: D1Database,
  ipHash: string,
  maxPerWindow: number = 5,
  windowMinutes: number = 60,
): Promise<{ allowed: boolean; remaining: number }> {
  const now = new Date();
  // Window key: truncate to the current window period
  const windowStart = new Date(
    Math.floor(now.getTime() / (windowMinutes * 60 * 1000)) * (windowMinutes * 60 * 1000),
  ).toISOString();

  // Atomic upsert: single round-trip, no race condition
  const row = await db
    .prepare(
      "INSERT INTO rate_limits (ip_hash, window, count) VALUES (?, ?, 1) ON CONFLICT(ip_hash, window) DO UPDATE SET count = count + 1 RETURNING count",
    )
    .bind(ipHash, windowStart)
    .first<{ count: number }>();

  const count = row?.count ?? 1;

  if (count > maxPerWindow) {
    return { allowed: false, remaining: 0 };
  }

  return { allowed: true, remaining: maxPerWindow - count };
}
