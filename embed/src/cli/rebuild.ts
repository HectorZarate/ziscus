export interface RebuildOptions {
  endpoint: string;
  secret: string;
  /** Page slug to rebuild. Omitted → the Worker defaults to "all". */
  slug?: string;
}

/** Result of `POST /admin/rebuild`, plus the HTTP status the Worker answered with. */
export interface RebuildOutcome {
  /** GitHub accepted the repository_dispatch. */
  ok: boolean;
  dispatched: boolean;
  slug?: string;
  /** GitHub's HTTP status for the dispatch call (204 on success, 401 on a bad token, ...). */
  status?: number;
  error?: string;
  /** HTTP status of the Worker response itself (200, 401, 502, 503, ...). */
  httpStatus: number;
}

function toOutcome(body: Record<string, unknown>, httpStatus: number): RebuildOutcome {
  const outcome: RebuildOutcome = {
    ok: body.ok === true,
    dispatched: body.dispatched === true,
    httpStatus,
  };
  if (typeof body.slug === "string") outcome.slug = body.slug;
  if (typeof body.status === "number") outcome.status = body.status;
  if (typeof body.error === "string") outcome.error = body.error;
  return outcome;
}

/**
 * Ask the Worker to trigger a site rebuild via GitHub repository_dispatch.
 *
 * HTTP-level failures (401, 502, 503, a non-JSON body) never throw — they are
 * reported through the returned outcome. Genuine network errors propagate.
 */
export async function runRebuild(opts: RebuildOptions): Promise<RebuildOutcome> {
  const base = opts.endpoint.replace(/\/$/, "");
  const res = await fetch(`${base}/admin/rebuild`, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(opts.slug === undefined ? {} : { slug: opts.slug }),
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  if (res.status === 401 || parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    const fallback = res.status === 401 ? "Unauthorized" : `HTTP ${res.status}`;
    return { ok: false, dispatched: false, httpStatus: res.status, error: text.trim() || fallback };
  }

  return toOutcome(parsed as Record<string, unknown>, res.status);
}
