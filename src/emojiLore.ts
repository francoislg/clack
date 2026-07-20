import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { fileExists } from "./fs.js";
import { createRecordStore } from "./state/resilientStore.js";
import type { EmojiCache } from "./slack/emojiCache.js";

// ============================================================================
// Dependency Injection
// ============================================================================

/** Injected I/O + clock so tests never touch disk and timestamps stay deterministic. */
export interface EmojiLoreDeps {
  readFile: (path: string, encoding: "utf-8") => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<string | undefined>;
  fileExists: (path: string) => Promise<boolean>;
  now: () => Date;
}

export const defaultEmojiLoreDeps: EmojiLoreDeps = {
  readFile,
  writeFile,
  mkdir,
  fileExists,
  now: () => new Date(),
};

let deps: EmojiLoreDeps = defaultEmojiLoreDeps;

export function setEmojiLoreDeps(d: EmojiLoreDeps): void {
  deps = d;
}

export function resetEmojiLoreDeps(): void {
  deps = defaultEmojiLoreDeps;
}

// ============================================================================
// Types & Schema
// ============================================================================

/**
 * One curated illustration of an emoji's use. `text` is a PARAPHRASE of the situation — never a
 * verbatim quote, and never naming the reacting user — so the dictionary can't become a record of
 * who said what. `link` is an optional Slack permalink kept as audit provenance: it lets a human
 * (or a later run re-checking its own inference) open the moment the lore was drawn from.
 */
export interface EmojiLoreExample {
  text: string;
  link?: string;
}

/** Provenance. `taught` = a human stated the meaning; `observed` = Clack inferred it from usage. */
export type EmojiLoreSource = "taught" | "observed";

/** One record in `data/state/emoji-lore.json`, keyed by emoji name (no colons). */
export interface EmojiLoreEntry {
  name: string;
  meaning: string;
  tags: string[];
  examples: EmojiLoreExample[];
  source: EmojiLoreSource;
  updatedAt: string;
}

/** The prompt-facing projection: what an emoji means, with nothing that isn't needed to pick it. */
export interface CompactEmojiLore {
  name: string;
  meaning: string;
  tags: string[];
}

const exampleZod = z.object({
  text: z.string().default(""),
  link: z.string().optional(),
});

// Graceful (permissive) reader: a state file, so a hand-edited or older-shaped entry must still
// load rather than being dropped. `source` deliberately accepts ANY string and narrows to the
// weaker provenance — rejecting unknown values here would quarantine real lore over a typo, and
// defaulting to "observed" is the safe direction (it can be overwritten by a taught write).
const sourceZod = z
  .string()
  .default("observed")
  .transform((value): EmojiLoreSource => (value === "taught" ? "taught" : "observed"));

const emojiLoreEntryZod: z.ZodType<EmojiLoreEntry> = z.object({
  name: z.string(),
  meaning: z.string().default(""),
  tags: z.array(z.string()).default([]),
  examples: z.array(exampleZod).default([]),
  source: sourceZod,
  updatedAt: z.string().default(""),
});

export interface EmojiLoreStore {
  [name: string]: EmojiLoreEntry;
}

/** Caller-supplied fields for {@link upsertLore}; `updatedAt` is stamped by the store. */
export interface UpsertLoreInput {
  name: string;
  meaning: string;
  tags?: string[];
  examples?: EmojiLoreExample[];
  source: EmojiLoreSource;
}

/**
 * Outcome of an upsert. `applied: false` is the ONE guarded case — an `observed` write aiming at a
 * `taught` entry — so a machine inference can never silently overwrite what a human stated.
 */
export type UpsertLoreResult =
  | { applied: true; entry: EmojiLoreEntry; previous: EmojiLoreEntry | undefined }
  | { applied: false; reason: "taught-wins"; existing: EmojiLoreEntry };

/** Hard cap on curated examples per entry — lore is a dictionary, not an evidence log. */
export const MAX_LORE_EXAMPLES = 3;

// ============================================================================
// Load / persist
// ============================================================================

let writeChain: Promise<void> = Promise.resolve();

function getStorePath(): string {
  return resolve(process.cwd(), "data", "state", "emoji-lore.json");
}

// Reads the live `deps` binding so `setEmojiLoreDeps` overrides at runtime are honored.
const liveStoreDeps = {
  readFile: (path: string) => deps.readFile(path, "utf-8"),
  writeFile: (path: string, data: string) => deps.writeFile(path, data),
  fileExists: (path: string) => deps.fileExists(path),
  mkdir: (path: string, opts: { recursive: boolean }) => deps.mkdir(path, opts),
};

const loreStore = createRecordStore<EmojiLoreEntry>({
  storeId: "emoji-lore",
  label: "emoji lore",
  getPath: getStorePath,
  entrySchema: emojiLoreEntryZod,
  deps: liveStoreDeps,
});

export async function loadEmojiLoreStore(): Promise<EmojiLoreStore> {
  return loreStore.load();
}

export function clearEmojiLoreCache(): void {
  loreStore.clearCache();
}

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ============================================================================
// Reads
// ============================================================================

export async function listLore(): Promise<EmojiLoreEntry[]> {
  const store = await loadEmojiLoreStore();
  return Object.values(store);
}

/** Strip to just what's needed to CHOOSE an emoji — examples, provenance and timestamps stay home. */
export function toCompactLore(entry: EmojiLoreEntry): CompactEmojiLore {
  return { name: entry.name, meaning: entry.meaning, tags: entry.tags };
}

/**
 * The searchable text of an entry. Tags are the intent hooks that make lore findable by what an
 * emoji is FOR ("approval", "incident") rather than what it is NAMED.
 */
export function loreHaystack(entry: EmojiLoreEntry): string {
  return `${entry.name} ${entry.meaning} ${entry.tags.join(" ")}`.toLowerCase();
}

/**
 * Reduce a raw query to a lore needle. `*` is a NAME-search wildcard with no meaning against free
 * text, so it is stripped; a query that was only wildcards yields an empty needle, which matches
 * everything — making `query: "*"` mean "the whole index", exactly as it does for name search.
 */
export function loreNeedle(query: string): string {
  return query.replaceAll("*", "").trim().toLowerCase();
}

export function matchesLore(entry: EmojiLoreEntry, needle: string): boolean {
  return needle === "" || loreHaystack(entry).includes(needle);
}

// ============================================================================
// Writes (serialized)
// ============================================================================

/**
 * Create or replace a lore entry. Whole-record replace (not a field merge): lore is a short
 * statement of meaning, so a partial overwrite would leave a half-old/half-new description that
 * reads as coherent but describes nothing. The taught-wins guard is the only refusal.
 */
export function upsertLore(input: UpsertLoreInput): Promise<UpsertLoreResult> {
  return serialize(async () => {
    const store = await loadEmojiLoreStore();
    const name = normalizeEmojiName(input.name);
    const existing = store[name];

    if (existing && existing.source === "taught" && input.source === "observed") {
      return { applied: false, reason: "taught-wins", existing };
    }

    const entry: EmojiLoreEntry = {
      name,
      meaning: input.meaning,
      tags: input.tags ?? [],
      examples: (input.examples ?? []).slice(0, MAX_LORE_EXAMPLES),
      source: input.source,
      updatedAt: deps.now().toISOString(),
    };
    await loreStore.save({ ...store, [name]: entry });
    return { applied: true, entry, previous: existing };
  });
}

// ============================================================================
// Usage scanning + hint
// ============================================================================

/** Custom emoji names are lowercase alphanumerics plus `_ + -`; anything else isn't a shortcode. */
const EMOJI_TOKEN_PATTERN = /:([a-z0-9_+-]+):/gi;

/** How many unknown names a single hint will name before collapsing the rest into a count. */
export const MAX_HINT_NAMES = 5;

/** The subset of a tool-output message this scan needs — text and reaction names. */
export interface EmojiScannableMessage {
  text?: string;
  reactions?: Array<{ emoji: string }>;
}

/**
 * Canonical emoji key: colons stripped, skin-tone modifier dropped (`thumbsup::skin-tone-2` is the
 * same emoji as `thumbsup`), lowercased — so lore is keyed once per emoji, not once per rendering.
 */
export function normalizeEmojiName(raw: string): string {
  return raw
    .replace(/^:+|:+$/g, "")
    .split("::")[0]
    .toLowerCase();
}

/** Every distinct emoji name used across these messages, from reactions AND inline `:name:` text. */
export function collectEmojiNames(messages: readonly EmojiScannableMessage[]): Set<string> {
  const names = new Set<string>();
  for (const message of messages) {
    for (const reaction of message.reactions ?? []) {
      if (reaction.emoji) names.add(normalizeEmojiName(reaction.emoji));
    }
    if (!message.text) continue;
    for (const match of message.text.matchAll(EMOJI_TOKEN_PATTERN)) {
      names.add(normalizeEmojiName(match[1]));
    }
  }
  return names;
}

export interface BuildLoreHintDeps {
  loadEmojiLoreStore: typeof loadEmojiLoreStore;
}

const defaultBuildLoreHintDeps: BuildLoreHintDeps = { loadEmojiLoreStore };

/**
 * The passive collector: given the emoji seen in a batch of messages, return an optional one-line
 * nudge naming the CUSTOM ones we have no lore for. Returns null in the steady state — every seen
 * emoji known, or none of them custom — so hint frequency decays to zero as coverage grows and a
 * session that has nothing to learn is never taxed.
 */
export async function buildLoreHint(
  names: Iterable<string>,
  emojiCache: EmojiCache,
  hintDeps: BuildLoreHintDeps = defaultBuildLoreHintDeps,
): Promise<string | null> {
  const unique = [...new Set(names)];
  if (unique.length === 0) return null;

  const store = await hintDeps.loadEmojiLoreStore();
  const unknown: string[] = [];
  for (const name of unique) {
    // Lore first: it's an in-memory map lookup, and a known emoji needs no cache round-trip.
    if (store[name]) continue;
    if (await emojiCache.has(name)) unknown.push(name);
  }
  if (unknown.length === 0) return null;

  const shown = unknown.slice(0, MAX_HINT_NAMES);
  const overflow = unknown.length - shown.length;
  const list = shown.map((name) => `:${name}:`).join(" ");
  const more = overflow > 0 ? ` (+${overflow} more)` : "";
  return (
    `Emoji lore: no entry yet for ${list}${more}. ` +
    `If this conversation makes clear what one of them means to this workspace, record it with ` +
    `describe_emoji (source: "observed"). If it doesn't, ignore this and carry on.`
  );
}
