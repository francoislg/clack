import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { logger } from "./logger.js";
import { fileExists } from "./fs.js";
import type { SettableAttentionLevel } from "./sessions.js";

// ============================================================================
// Types
// ============================================================================

export interface AutoRespondRule {
  id: string;
  channels: string[];
  userFilters?: string[];
  /** Optional keywords — trigger if message text contains any (case-insensitive) */
  keywords?: string[];
  /** Optional extra context injected into Claude's prompt for this rule */
  extraContext?: string;
  /** Optional pre-analysis context — when set, a lightweight Claude Haiku call evaluates message relevance before responding */
  preAnalysisContext?: string;
  /** Optional attention level seeded onto sessions this rule creates. Defaults to `"medium"`. */
  attentionLevel?: SettableAttentionLevel;
  enabled: boolean;
}

interface AutoRespondState {
  rules: AutoRespondRule[];
}

// Lenient on load: matches the on-disk shape real rules carry (written by addRule)
// without rejecting any saved rule. Per-field strictness lives at the mutation boundary.
const autoRespondRuleZod = z.object({
  id: z.string(),
  channels: z.array(z.string()),
  userFilters: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  extraContext: z.string().optional(),
  preAnalysisContext: z.string().optional(),
  attentionLevel: z.enum(["always", "high", "medium", "low"]).optional(),
  enabled: z.boolean(),
});

const autoRespondStateZod = z.object({
  rules: z.array(autoRespondRuleZod).optional(),
});

// ============================================================================
// Storage
// ============================================================================

const DEFAULT_STATE: AutoRespondState = { rules: [] };

let cached: AutoRespondState | null = null;

function getStateDir(): string {
  return resolve(process.cwd(), "data", "state");
}

function getFilePath(): string {
  return resolve(getStateDir(), "auto-respond.json");
}

export async function loadRules(): Promise<AutoRespondRule[]> {
  if (cached) {
    return cached.rules;
  }

  const filePath = getFilePath();

  if (!(await fileExists(filePath))) {
    cached = { ...DEFAULT_STATE, rules: [] };
    return cached.rules;
  }

  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = autoRespondStateZod.safeParse(JSON.parse(content));
    if (!parsed.success) {
      logger.error("auto-respond state has unexpected shape; using empty:", parsed.error.message);
      cached = { ...DEFAULT_STATE, rules: [] };
      return cached.rules;
    }
    cached = { rules: parsed.data.rules ?? [] };
    return cached.rules;
  } catch (error) {
    logger.error("Failed to load auto-respond rules:", error);
    cached = { ...DEFAULT_STATE, rules: [] };
    return cached.rules;
  }
}

async function saveState(state: AutoRespondState): Promise<void> {
  const stateDir = getStateDir();
  const filePath = getFilePath();

  if (!(await fileExists(stateDir))) {
    await mkdir(stateDir, { recursive: true });
  }

  await writeFile(filePath, JSON.stringify(state, null, 2));
  cached = state;
}

// ============================================================================
// CRUD Operations
// ============================================================================

export async function getRules(): Promise<AutoRespondRule[]> {
  return loadRules();
}

export async function getEnabledRules(): Promise<AutoRespondRule[]> {
  const rules = await loadRules();
  return rules.filter((r) => r.enabled);
}

export async function addRule(
  channels: string[],
  userFilters?: string[],
  keywords?: string[],
  extraContext?: string,
  preAnalysisContext?: string,
  attentionLevel?: SettableAttentionLevel,
): Promise<AutoRespondRule> {
  const rules = await loadRules();
  const rule: AutoRespondRule = {
    id: randomUUID().slice(0, 8),
    channels,
    ...(userFilters && userFilters.length > 0 && { userFilters }),
    ...(keywords && keywords.length > 0 && { keywords }),
    ...(extraContext?.trim() && { extraContext: extraContext.trim() }),
    ...(preAnalysisContext?.trim() && { preAnalysisContext: preAnalysisContext.trim() }),
    ...(attentionLevel && { attentionLevel }),
    enabled: true,
  };
  rules.push(rule);
  await saveState({ rules });
  logger.info(`Auto-respond rule ${rule.id} created for channels: ${channels.join(", ")}`);
  return rule;
}

/**
 * Partial patch for an existing rule. Semantics:
 * - Omitted keys preserve the current value.
 * - `extraContext` / `preAnalysisContext` set to an empty string (or whitespace-only) clear the field.
 * - `keywords` / `userFilters` set to an empty array clear the field.
 */
export type AutoRespondRulePatch = Partial<
  Omit<AutoRespondRule, "id" | "enabled" | "attentionLevel">
> & {
  /** A settable level sets it; an empty string clears it (reverting to the `"medium"` default). */
  attentionLevel?: SettableAttentionLevel | "";
};

export async function updateRule(
  ruleId: string,
  patch: AutoRespondRulePatch,
): Promise<AutoRespondRule | null> {
  const rules = await loadRules();
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) return null;

  if (patch.channels !== undefined) {
    rule.channels = patch.channels;
  }
  if (patch.userFilters !== undefined) {
    if (patch.userFilters.length > 0) {
      rule.userFilters = patch.userFilters;
    } else {
      delete rule.userFilters;
    }
  }
  if (patch.keywords !== undefined) {
    if (patch.keywords.length > 0) {
      rule.keywords = patch.keywords;
    } else {
      delete rule.keywords;
    }
  }
  if (patch.extraContext !== undefined) {
    const trimmed = patch.extraContext.trim();
    if (trimmed) {
      rule.extraContext = trimmed;
    } else {
      delete rule.extraContext;
    }
  }
  if (patch.preAnalysisContext !== undefined) {
    const trimmed = patch.preAnalysisContext.trim();
    if (trimmed) {
      rule.preAnalysisContext = trimmed;
    } else {
      delete rule.preAnalysisContext;
    }
  }
  if (patch.attentionLevel !== undefined) {
    if (patch.attentionLevel) {
      rule.attentionLevel = patch.attentionLevel;
    } else {
      delete rule.attentionLevel;
    }
  }

  await saveState({ rules });
  logger.info(`Auto-respond rule ${ruleId} updated`);
  return rule;
}

export async function toggleRule(ruleId: string): Promise<AutoRespondRule | null> {
  const rules = await loadRules();
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) return null;

  rule.enabled = !rule.enabled;
  await saveState({ rules });
  logger.info(`Auto-respond rule ${ruleId} ${rule.enabled ? "enabled" : "disabled"}`);
  return rule;
}

export async function deleteRule(ruleId: string): Promise<boolean> {
  const rules = await loadRules();
  const index = rules.findIndex((r) => r.id === ruleId);
  if (index === -1) return false;

  rules.splice(index, 1);
  await saveState({ rules });
  logger.info(`Auto-respond rule ${ruleId} deleted`);
  return true;
}

export async function getRule(ruleId: string): Promise<AutoRespondRule | null> {
  const rules = await loadRules();
  return rules.find((r) => r.id === ruleId) ?? null;
}

// ============================================================================
// Matching
// ============================================================================

/**
 * Returns the first matching enabled rule for a given channel, author, and message text.
 *
 * Matching logic:
 * - Channel must match (required)
 * - If no userFilters and no keywords → match everything in the channel
 * - If filters exist → match if user matches userFilters OR message contains any keyword (OR logic)
 */
export async function findMatchingRule(
  channelId: string,
  authorUserId: string | undefined,
  messageText?: string,
): Promise<AutoRespondRule | null> {
  const rules = await getEnabledRules();
  const textLower = messageText?.toLowerCase();

  for (const rule of rules) {
    if (!rule.channels.includes(channelId)) continue;

    const hasUserFilters = rule.userFilters && rule.userFilters.length > 0;
    const hasKeywords = rule.keywords && rule.keywords.length > 0;

    // No filters at all → match everything in the channel
    if (!hasUserFilters && !hasKeywords) {
      return rule;
    }

    // Check user filter (OR)
    if (hasUserFilters && authorUserId && rule.userFilters!.includes(authorUserId)) {
      return rule;
    }

    // Check keyword filter (OR)
    if (hasKeywords && textLower) {
      const keywordMatch = rule.keywords!.some((kw) => textLower.includes(kw.toLowerCase()));
      if (keywordMatch) {
        return rule;
      }
    }
  }

  return null;
}

// Clear cache (useful for testing)
export function clearAutoRespondCache(): void {
  cached = null;
}
