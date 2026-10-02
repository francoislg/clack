import type { App } from "@slack/bolt";
import type { Config } from "../config.js";
import { errorMessage } from "../errors.js";
import { t } from "../i18n/t.js";
import { logger } from "../logger.js";
import { getOwnerUserId, sendOwnerDm, type OwnerNotifierDeps } from "./ownerDm.js";
import { manifestFeatures, requiredBotScopes } from "./requiredScopes.js";

export const defaultScopeDriftCheckDeps: OwnerNotifierDeps = { getOwnerUserId, sendOwnerDm };

/** The required scopes the token lacks, in `required` order. Extra granted scopes are ignored. */
export function findMissingScopes(
  required: readonly string[],
  granted: readonly string[],
): string[] {
  const held = new Set(granted);
  return required.filter((scope) => !held.has(scope));
}

/** Logs each missing scope and DMs the owner once about all of them. Best-effort — it never throws. */
export async function reportMissingScopes(
  missing: string[],
  deps: OwnerNotifierDeps = defaultScopeDriftCheckDeps,
): Promise<void> {
  if (missing.length === 0) return;
  for (const scope of missing) {
    logger.error(
      `Bot token is missing scope "${scope}" — the features that need it fail until the manifest is re-uploaded and the app reinstalled`,
    );
  }
  try {
    const owner = await deps.getOwnerUserId();
    if (!owner) return;
    const text = [
      t("scopes.missing.dm_title", { count: missing.length }),
      ...missing.map((scope) => t("scopes.missing.dm_entry", { scope })),
      "",
      t("scopes.missing.dm_footer"),
    ].join("\n");
    await deps.sendOwnerDm(owner, text, { suppressUnfurls: true });
  } catch (error) {
    logger.warn(`scope-drift-check: owner DM failed: ${errorMessage(error)}`);
  }
}

/**
 * Boot / soft-restart guard: compares the bot scopes the live config requires with the ones
 * the installed token carries and reports the gap. It asks `auth.test` on every run, because
 * reinstalling the app changes the token's scopes without changing the token. Warns rather
 * than blocks — it never throws, and returns the missing scopes for the caller's own summary.
 */
export async function checkTokenScopes(
  config: Config,
  client: App["client"] | undefined,
): Promise<string[]> {
  if (!client) return [];
  try {
    const response = await client.auth.test();
    const granted = response.response_metadata?.scopes;
    if (!granted) {
      logger.warn("scope-drift-check: skipped — auth.test returned no scope list");
      return [];
    }
    const missing = findMissingScopes(requiredBotScopes(manifestFeatures(config)), granted);
    await reportMissingScopes(missing);
    return missing;
  } catch (error) {
    logger.warn(`scope-drift-check: failed: ${errorMessage(error)}`);
    return [];
  }
}
