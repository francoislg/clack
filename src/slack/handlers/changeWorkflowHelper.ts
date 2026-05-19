import { getConfig } from "../../config.js";
import { getRole } from "../../roles.js";
import { canRequestChanges } from "../../permissions.js";
import type { AskClaudeOptions } from "../../claude/index.js";
import type { TriggerType } from "../../changes/types.js";
import type { UserRole } from "../../roles.js";
import type { Config } from "../../config.js";
import { isChangesEnabledForTrigger, getChangeEnabledRepos } from "../../changes/detection.js";

export interface ChangeWorkflowHelperDeps {
  getConfig: () => Config;
  getRole: (userId: string) => Promise<UserRole>;
  canRequestChanges: (role: UserRole) => boolean;
  isChangesEnabledForTrigger: (triggerType: TriggerType, config: Config) => boolean;
  getChangeEnabledRepos: (
    config: Config,
    role: UserRole,
  ) => Array<{ name: string; description: string }>;
}

export const defaultChangeWorkflowHelperDeps: ChangeWorkflowHelperDeps = {
  getConfig,
  getRole,
  canRequestChanges,
  isChangesEnabledForTrigger,
  getChangeEnabledRepos,
};

/**
 * Get Claude options for a user and trigger type.
 * Dynamic state (repos, sessions) is now queryable through clack tools.
 *
 * `roleOverride` lets callers (e.g. the cron scheduler for plugin-managed jobs)
 * bypass `getRole(userId)` and run as a specific role — needed for system-owned
 * jobs whose `userId` is a synthetic actor source, not a Slack user.
 */
export async function getClaudeOptions(
  userId: string,
  triggerType: TriggerType,
  roleOverride?: UserRole,
  deps: ChangeWorkflowHelperDeps = defaultChangeWorkflowHelperDeps,
): Promise<AskClaudeOptions> {
  const config = deps.getConfig();
  const role = roleOverride ?? (await deps.getRole(userId));

  const changesEnabled = deps.isChangesEnabledForTrigger(triggerType, config);
  const isChangeCapable = changesEnabled && deps.canRequestChanges(role);

  if (!isChangeCapable) {
    return { role, changesWorkflowEnabled: false };
  }

  const availableRepos = deps.getChangeEnabledRepos(config, role);
  if (availableRepos.length === 0) {
    return { role, changesWorkflowEnabled: false };
  }

  return {
    role,
    changesWorkflowEnabled: true,
  };
}
