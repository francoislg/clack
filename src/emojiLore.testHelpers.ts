import type { EmojiLoreEntry } from "./emojiLore.js";

/**
 * Build a lore entry from just the fields a test cares about. Defaults mirror what the store
 * writes for an omitted field, so a builder result is always a shape the store could have produced.
 */
export function makeLoreEntry(partial: Partial<EmojiLoreEntry> & { name: string }): EmojiLoreEntry {
  return {
    meaning: "",
    tags: [],
    examples: [],
    source: "observed",
    updatedAt: "2026-07-20T12:00:00.000Z",
    ...partial,
  };
}
