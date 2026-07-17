import { buildRoleChain, scanTopicNames } from "../../cascadingConfigResolver.js";
import { buildVirtualDefaults } from "../../instructions.js";

/**
 * Enumerate every topic name attachable via `attachedTopics`: topic folders across the
 * full role chain (on-disk defaults + operator overrides), plugin virtual-default topics,
 * and integration-registry names (an MCP integration's topic is attachable too).
 */
export function collectKnownTopics(registryNames: ReadonlyArray<string> = []): string[] {
  const names = new Set<string>(registryNames);
  const virtualDefaults = buildVirtualDefaults();
  for (const role of buildRoleChain("owner", true)) {
    for (const topic of scanTopicNames(role, virtualDefaults)) {
      names.add(topic);
    }
  }
  return [...names].sort();
}

/**
 * Validate topic names against the known set. Returns `null` when all names are valid,
 * otherwise a user-facing error naming the invalid entries and listing the known topics.
 */
export function validateTopicNames(
  names: ReadonlyArray<string>,
  knownTopics: ReadonlyArray<string>,
): string | null {
  const known = new Set(knownTopics);
  const invalid = names.filter((n) => !known.has(n));
  if (invalid.length === 0) return null;
  return (
    `Unknown topic name(s): ${invalid.join(", ")}. ` +
    `Known topics: ${knownTopics.length > 0 ? knownTopics.join(", ") : "(none)"}.`
  );
}
