import type { TriviaContextEntry } from "../core/configTypes.js";

/**
 * Produce a freshly-rolled weighted-random ordering of the given contexts (sampling
 * without replacement, weighted by `weight ?? 1`). Each call rolls independently —
 * caller's responsibility to invoke once per `get_ideas` response.
 *
 * High-weight entries are likelier to land near the front. The empty-string entry
 * is a first-class member of the rolled list — it's how "no lens" is expressed.
 *
 * Returns a `string[]` of `name` values (NOT the full entries) because that's all
 * downstream (Claude's prompt + `save_question.context` validation) needs to see.
 */
export function rollContextPriority(contexts: TriviaContextEntry[]): string[] {
  if (contexts.length === 0) return [];

  // Mutable copy of remaining (entry, effective weight) pairs.
  const remaining: { name: string; weight: number }[] = contexts.map((c) => ({
    name: c.name,
    weight: c.weight ?? 1,
  }));

  const out: string[] = [];
  while (remaining.length > 0) {
    const totalWeight = remaining.reduce((sum, e) => sum + e.weight, 0);
    let pick = Math.random() * totalWeight;
    let idx = 0;
    for (; idx < remaining.length; idx++) {
      pick -= remaining[idx].weight;
      if (pick <= 0) break;
    }
    if (idx === remaining.length) idx = remaining.length - 1;
    out.push(remaining[idx].name);
    remaining.splice(idx, 1);
  }
  return out;
}
