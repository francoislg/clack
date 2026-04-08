/**
 * Truncate a string to `max` characters, appending "…" if truncated.
 * The "…" counts toward the limit, so the output is always ≤ max characters.
 */
export function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max - 1) + "…" : str;
}
