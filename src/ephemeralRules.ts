import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { logger } from "./logger.js";
import { fileExists } from "./fs.js";
import type { AutoRespondRule } from "./autoRespond.js";

// ============================================================================
// Types
// ============================================================================

/** The live dial an ephemeral rule can hold — `"always"` is never seedable for a channel. */
export type EphemeralAttentionLevel = "high" | "medium" | "low";

export interface EphemeralRule extends AutoRespondRule {
  kind: "ephemeral";
  attentionLevel: EphemeralAttentionLevel;
  expiresAt: number;
  sessionIds: string[];
  anchorText: string;
}

export function isEphemeralRule(rule: AutoRespondRule): rule is EphemeralRule {
  return rule.kind === "ephemeral";
}

/** Sliding-window TTL for ephemeral rules; renewed on every `respond` verdict. */
export const EPHEMERAL_RULE_TTL_MS = 60 * 60 * 1000;
/** Max stored anchor-post length handed to the continuation judge. */
export const EPHEMERAL_ANCHOR_TEXT_MAX = 500;
/** Conversation-ledger bound; the anchor entry is never dropped. */
export const EPHEMERAL_SESSION_LEDGER_CAP = 10;

const EPHEMERAL_RATCHET_DOWN: Record<EphemeralAttentionLevel, EphemeralAttentionLevel | null> = {
  high: "medium",
  medium: "low",
  low: null,
};

const ephemeralRuleZod = z
  .object({
    id: z.string(),
    kind: z.literal("ephemeral"),
    channels: z.array(z.string()),
    attentionLevel: z.enum(["high", "medium", "low"]),
    expiresAt: z.number(),
    sessionIds: z.array(z.string()),
    anchorText: z.string(),
    creationContext: z.string().optional(),
    // Legacy alias for rules persisted before the creationContext rename; coalesced below.
    followUpContext: z.string().optional(),
    enabled: z.boolean(),
  })
  .transform(({ followUpContext, ...rule }) => ({
    ...rule,
    creationContext: rule.creationContext ?? followUpContext,
  }));

const ephemeralStateZod = z.object({
  rules: z.array(ephemeralRuleZod).optional(),
});

// ============================================================================
// Storage
// ============================================================================

let cachedEphemeral: EphemeralRule[] | null = null;

function getEphemeralFilePath(): string {
  return resolve(process.cwd(), "data", "state", "auto-respond-ephemeral.json");
}

export async function loadEphemeralRules(): Promise<EphemeralRule[]> {
  if (cachedEphemeral) {
    return cachedEphemeral;
  }

  const filePath = getEphemeralFilePath();

  if (!(await fileExists(filePath))) {
    cachedEphemeral = [];
    return cachedEphemeral;
  }

  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = ephemeralStateZod.safeParse(JSON.parse(content));
    if (!parsed.success) {
      logger.error(
        "ephemeral auto-respond state has unexpected shape; using empty:",
        parsed.error.message,
      );
      cachedEphemeral = [];
      return cachedEphemeral;
    }
    cachedEphemeral = parsed.data.rules ?? [];
    return cachedEphemeral;
  } catch (error) {
    logger.error("Failed to load ephemeral auto-respond rules:", error);
    cachedEphemeral = [];
    return cachedEphemeral;
  }
}

async function saveEphemeralState(rules: EphemeralRule[]): Promise<void> {
  const stateDir = resolve(process.cwd(), "data", "state");

  if (!(await fileExists(stateDir))) {
    await mkdir(stateDir, { recursive: true });
  }

  await writeFile(getEphemeralFilePath(), JSON.stringify({ rules }, null, 2));
  cachedEphemeral = rules;
}

// ============================================================================
// Lifecycle operations (channel-conversation windows)
// ============================================================================

export interface SeedEphemeralRuleOptions {
  channel: string;
  attentionLevel: EphemeralAttentionLevel;
  sessionId: string;
  anchorText: string;
  creationContext?: string;
}

/** Create the channel's conversation window. Newest-wins: replaces any existing
 *  ephemeral rule for the same channel, so at most one window exists per channel. */
export async function seedEphemeralRule(opts: SeedEphemeralRuleOptions): Promise<EphemeralRule> {
  const ephemeral = await loadEphemeralRules();
  const rule: EphemeralRule = {
    id: randomUUID().slice(0, 8),
    kind: "ephemeral",
    channels: [opts.channel],
    attentionLevel: opts.attentionLevel,
    expiresAt: Date.now() + EPHEMERAL_RULE_TTL_MS,
    sessionIds: [opts.sessionId],
    anchorText: opts.anchorText.slice(0, EPHEMERAL_ANCHOR_TEXT_MAX),
    ...(opts.creationContext?.trim() && { creationContext: opts.creationContext.trim() }),
    enabled: true,
  };
  const remaining = ephemeral.filter((r) => !r.channels.includes(opts.channel));
  await saveEphemeralState([...remaining, rule]);
  logger.info(
    `Ephemeral auto-respond rule ${rule.id} seeded for channel ${opts.channel} at ${opts.attentionLevel}`,
  );
  return rule;
}

export async function getEphemeralRuleForChannel(channel: string): Promise<EphemeralRule | null> {
  const ephemeral = await loadEphemeralRules();
  return ephemeral.find((r) => r.channels.includes(channel)) ?? null;
}

/** Lower the live dial one rung on an unrelated message; a skip at `low` deletes the rule.
 *  Returns the updated rule, or null when the ratchet deleted it. */
export async function ratchetEphemeralRule(ruleId: string): Promise<EphemeralRule | null> {
  const ephemeral = await loadEphemeralRules();
  const rule = ephemeral.find((r) => r.id === ruleId);
  if (!rule) return null;

  const next = EPHEMERAL_RATCHET_DOWN[rule.attentionLevel];
  if (next === null) {
    await saveEphemeralState(ephemeral.filter((r) => r.id !== ruleId));
    logger.info(`Ephemeral rule ${ruleId} ratcheted below low — deleted`);
    return null;
  }

  rule.attentionLevel = next;
  await saveEphemeralState(ephemeral);
  logger.info(`Ephemeral rule ${ruleId} ratcheted down to ${next}`);
  return rule;
}

/** Slide the window forward after a `respond` verdict. */
export async function renewEphemeralRule(ruleId: string): Promise<EphemeralRule | null> {
  const ephemeral = await loadEphemeralRules();
  const rule = ephemeral.find((r) => r.id === ruleId);
  if (!rule) return null;

  rule.expiresAt = Date.now() + EPHEMERAL_RULE_TTL_MS;
  await saveEphemeralState(ephemeral);
  return rule;
}

/** Claude's reframe from `submit_response.channel_attention_level`; `"off"` deletes. */
export async function setEphemeralRuleLevel(
  ruleId: string,
  level: EphemeralAttentionLevel | "off",
): Promise<EphemeralRule | null> {
  const ephemeral = await loadEphemeralRules();
  const rule = ephemeral.find((r) => r.id === ruleId);
  if (!rule) return null;

  if (level === "off") {
    await saveEphemeralState(ephemeral.filter((r) => r.id !== ruleId));
    logger.info(`Ephemeral rule ${ruleId} set to off — deleted`);
    return null;
  }

  rule.attentionLevel = level;
  await saveEphemeralState(ephemeral);
  logger.info(`Ephemeral rule ${ruleId} reframed to ${level}`);
  return rule;
}

/** Record a session joining the conversation (thread spin-offs). Capped; anchor never dropped. */
export async function appendSessionToEphemeralRule(
  channel: string,
  sessionId: string,
): Promise<EphemeralRule | null> {
  const ephemeral = await loadEphemeralRules();
  const rule = ephemeral.find((r) => r.channels.includes(channel));
  if (!rule) return null;
  if (rule.sessionIds.includes(sessionId)) return rule;

  rule.sessionIds.push(sessionId);
  if (rule.sessionIds.length > EPHEMERAL_SESSION_LEDGER_CAP) {
    const [anchor, ...rest] = rule.sessionIds;
    rule.sessionIds = [anchor, ...rest.slice(rest.length - (EPHEMERAL_SESSION_LEDGER_CAP - 1))];
  }
  await saveEphemeralState(ephemeral);
  return rule;
}

export async function deleteEphemeralRuleForChannel(channel: string): Promise<boolean> {
  const ephemeral = await loadEphemeralRules();
  const remaining = ephemeral.filter((r) => !r.channels.includes(channel));
  if (remaining.length === ephemeral.length) return false;

  await saveEphemeralState(remaining);
  logger.info(`Ephemeral auto-respond rule for channel ${channel} deleted`);
  return true;
}

export async function deleteEphemeralRuleById(ruleId: string): Promise<boolean> {
  const ephemeral = await loadEphemeralRules();
  const remaining = ephemeral.filter((r) => r.id !== ruleId);
  if (remaining.length === ephemeral.length) return false;

  await saveEphemeralState(remaining);
  logger.info(`Ephemeral auto-respond rule ${ruleId} deleted`);
  return true;
}

// Clear cache (useful for testing)
export function clearEphemeralRulesCache(): void {
  cachedEphemeral = null;
}
