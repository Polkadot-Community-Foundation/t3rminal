/** Stable, queryable kind for a topUp() failure (string attr → count_if). */
export type TopupErrorKind = "timeout" | "declined" | "host" | "unknown";

export function classifyTopupError(err: unknown): TopupErrorKind {
  const text =
    err instanceof Error ? err.message
    : typeof err === "string" ? err
    : (() => { const o = err as Record<string, unknown> | null;
        const tag = o && typeof o.tag === "string" ? o.tag : "";
        const reason = o && typeof (o.value as Record<string, unknown>)?.reason === "string"
          ? String((o.value as Record<string, unknown>).reason) : "";
        return `${tag} ${reason}`; })();
  if (/time?d?\s?out|timeout/i.test(text)) return "timeout";
  if (/declin|insufficient|reject/i.test(text)) return "declined";
  if (/host|bridge|unavailable|disconnect/i.test(text)) return "host";
  return "unknown";
}
