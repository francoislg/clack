/**
 * Build a case-insensitive matcher for a query string.
 *
 * - If the query contains `*`, it's treated as a wildcard pattern
 *   (e.g., `dev-*` matches `dev-team`, `dev-updates`).
 * - Otherwise, it's a case-insensitive substring match.
 */
export function buildWildcardMatcher(query: string): (value: string) => boolean {
  if (query.includes("*")) {
    const escaped = query.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i");
    return (value) => pattern.test(value);
  }
  const lower = query.toLowerCase();
  return (value) => value.toLowerCase().includes(lower);
}
