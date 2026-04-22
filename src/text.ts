/**
 * Truncate a string to `max` characters, appending "…" if truncated.
 * The "…" counts toward the limit, so the output is always ≤ max characters.
 */
export function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max - 1) + "…" : str;
}

/**
 * Keep the last `maxBytes` bytes of a UTF-8 string. If the string is already
 * within the cap, returns it unchanged. Used when we want to preserve the tail
 * of process output (the most recent lines are the most useful for diagnosing
 * a failure) while bounding memory / payload size.
 */
export function truncateBytesTail(str: string, maxBytes: number): string {
  const buf = Buffer.from(str, "utf-8");
  if (buf.byteLength <= maxBytes) return str;
  return buf.subarray(buf.byteLength - maxBytes).toString("utf-8");
}
