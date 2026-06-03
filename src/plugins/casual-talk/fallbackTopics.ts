import type { CasualTalkConfig } from "./types.js";

// Workplace-safe by design — these ship to every deployment, so no politics,
// religion, or anything sensitive.
export const BUILTIN_FALLBACK_TOPICS: string[] = [
  "weekend plans",
  "what everyone's currently watching or reading",
  "best lunch spots nearby",
  "small wins from this week",
  "hobbies outside of work",
  "music or podcast recommendations",
  "upcoming holidays or long weekends",
  "pet photos and stories",
];

// Augment semantics: built-ins are unioned with custom topics when enabled,
// otherwise the custom list is used verbatim (the pre-feature behavior).
export function resolveFallbackTopics(
  config: Pick<CasualTalkConfig, "smallTalkTopics" | "useBuiltinFallbackTopics">,
): string[] {
  if (!config.useBuiltinFallbackTopics) return config.smallTalkTopics;
  return [...new Set([...BUILTIN_FALLBACK_TOPICS, ...config.smallTalkTopics])];
}
