import { getConfig } from "../../config.js";
import { getRole } from "../../roles.js";
import { canRequestChanges } from "../../permissions.js";
import type { AskClaudeOptions } from "../../claude.js";
import type { TriggerType } from "../../changes/types.js";
import { isChangesEnabledForTrigger, getChangeEnabledRepos } from "../../changes/detection.js";

/**
 * Get Claude options for a user and trigger type.
 * Dynamic state (repos, sessions) is now queryable through clack tools.
 */
export async function getClaudeOptions(
  userId: string,
  triggerType: TriggerType
): Promise<AskClaudeOptions> {
  const config = getConfig();
  const role = await getRole(userId);

  const changesEnabled = isChangesEnabledForTrigger(triggerType, config);
  const isChangeCapable = changesEnabled && canRequestChanges(role);

  if (!isChangeCapable) {
    return { role, changesWorkflowEnabled: false };
  }

  const availableRepos = getChangeEnabledRepos(config, role);
  if (availableRepos.length === 0) {
    return { role, changesWorkflowEnabled: false };
  }

  return {
    role,
    changesWorkflowEnabled: true,
  };
}
