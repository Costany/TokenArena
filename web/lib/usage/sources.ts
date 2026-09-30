/** Read-side product grouping only. Never normalize persisted upload identities. */
export function normalizeUsageSource(source: string): string {
  return source === "snow-app" ? "snow" : source;
}

export function getUsageSourceLabel(source: string): string {
  const normalized = normalizeUsageSource(source);
  return normalized === "snow" ? "Snow" : normalized;
}

/** Match both ledgers without rewriting or replaying either snapshot. */
export function getUsageSourceFilter(
  source: string,
): string | { in: string[] } {
  return normalizeUsageSource(source) === "snow"
    ? { in: ["snow", "snow-app"] }
    : source;
}
