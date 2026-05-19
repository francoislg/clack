/**
 * Weighted random pick over a string→non-negative-integer map.
 * Re-normalizes implicitly — the caller passes raw weights and the function
 * rolls uniformly in `[0, totalWeight)` then selects the first key whose
 * cumulative weight crosses the roll.
 *
 * Returns `null` only when the map is empty or every weight is zero — callers
 * should treat that as a configuration error and surface a clear message.
 */
export function weightedPick<K extends string>(
  weights: Record<K, number>,
  rng: () => number = Math.random,
): K | null {
  const entries = Object.entries(weights) as [K, number][];
  let total = 0;
  for (const [, w] of entries) {
    if (w > 0) total += w;
  }
  if (total === 0) return null;
  const roll = rng() * total;
  let cumulative = 0;
  for (const [key, w] of entries) {
    if (w <= 0) continue;
    cumulative += w;
    if (roll < cumulative) return key;
  }
  // Floating-point edge: the roll exactly equals total. Return the last positive-weight entry.
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i][1] > 0) return entries[i][0];
  }
  return null;
}
