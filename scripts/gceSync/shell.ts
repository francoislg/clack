/** Quotes a value for a POSIX shell as one single-quoted word. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Quotes each value and joins them with spaces. */
export function shellWords(values: readonly string[]): string {
  return values.map(shellQuote).join(" ");
}
