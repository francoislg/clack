/**
 * Pure text-derived helpers for conversation stats: each takes raw message text and returns
 * aggregate numbers/tokens only. Reading content here is fine — the privacy contract is that
 * none of it leaves the tool as content.
 */

export function wordCount(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function questionMarkCount(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

export function exclamationCount(text: string): number {
  return (text.match(/!/g) ?? []).length;
}

export function politenessCount(text: string): number {
  const matches = text.match(/\b(please|svp|stp)\b|s['’ ]?il [tv]ous? pla[iî]t/gi);
  return matches ? matches.length : 0;
}

export function linkCount(text: string): number {
  return (text.match(/https?:\/\//g) ?? []).length;
}

/**
 * Shortcodes are kept only when they contain a letter (drops numeric labels like `:22:`);
 * unicode emoji use `\p{Extended_Pictographic}` so non-emoji symbols like arrows (`→`) are
 * excluded. Duplicates are preserved so the caller can tally.
 */
export function extractEmoji(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/:([a-z0-9_+'-]+):/gi)) {
    const name = m[1];
    if (/[a-z]/i.test(name)) out.push(`:${name}:`);
  }
  for (const m of text.matchAll(/\p{Extended_Pictographic}/gu)) {
    out.push(m[0]);
  }
  return out;
}
