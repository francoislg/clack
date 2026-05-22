import { logger } from "../logger.js";
import { errorMessage } from "../errors.js";
import { loadRoles } from "../roles.js";
import { getSlackClient } from "../slack/app.js";
import { openDmChannel } from "../slack/channelResolver.js";
import { unfurlOptions } from "../slack/unfurlOptions.js";
import { t } from "../i18n/t.js";
import type { QuarantineEvent } from "./reusablePool.js";

function triggerLabel(trigger: QuarantineEvent["trigger"]): string {
  switch (trigger) {
    case "release":
      return t("changes.quarantine.trigger_release");
    case "branch_switch":
      return t("changes.quarantine.trigger_branch_switch");
    case "idle_release":
      return t("changes.quarantine.trigger_idle_release");
  }
}

/**
 * Hooks the notifier needs. Both are injected so tests can stub them without
 * touching read-only ESM namespaces (which `mock.method` cannot patch).
 *
 * - `getOwnerUserId()` returns the Slack user id of the workspace owner, or
 *   null when no owner is configured.
 * - `sendOwnerDm(text)` opens a DM with that owner and posts the text.
 *   Returns true on success, false on any failure. The notifier never throws.
 */
export interface QuarantineNotifierDeps {
  getOwnerUserId: () => Promise<string | null>;
  sendOwnerDm: (
    ownerUserId: string,
    text: string,
    options?: { suppressUnfurls?: boolean },
  ) => Promise<boolean>;
}

async function defaultGetOwnerUserId(): Promise<string | null> {
  try {
    const roles = await loadRoles();
    return roles.owner;
  } catch (err) {
    logger.warn(`quarantine-notify: failed to load roles: ${errorMessage(err)}`);
    return null;
  }
}

async function defaultSendOwnerDm(
  ownerUserId: string,
  text: string,
  options: { suppressUnfurls?: boolean } = {},
): Promise<boolean> {
  const client = getSlackClient();
  if (!client) {
    logger.warn(`quarantine-notify: no Slack client available`);
    return false;
  }
  const dmChannel = await openDmChannel(client, ownerUserId);
  if (!dmChannel) return false; // openDmChannel logs internally
  try {
    await client.chat.postMessage({
      channel: dmChannel,
      text,
      ...unfurlOptions(options.suppressUnfurls),
    });
    return true;
  } catch (err) {
    logger.warn(
      `quarantine-notify: failed to post DM to owner ${ownerUserId}: ${errorMessage(err)}`,
    );
    return false;
  }
}

export const defaultQuarantineNotifierDeps: QuarantineNotifierDeps = {
  getOwnerUserId: defaultGetOwnerUserId,
  sendOwnerDm: defaultSendOwnerDm,
};

/**
 * DM the workspace owner when a worker is quarantined. Best-effort: every failure
 * (no owner configured, no Slack client, DM rejected) is logged and swallowed
 * so the pool's internal flow never breaks.
 *
 * The message includes the worker id, repo, branch, dirty file list, and the
 * trigger so the operator can decide whether to discard the changes or rescue
 * them manually. The "Discard & restore" Home Tab button (task 14.2) is the
 * normal recovery path; this DM is the notification surface.
 */
export async function notifyOwnerOfQuarantine(
  event: QuarantineEvent,
  deps: QuarantineNotifierDeps = defaultQuarantineNotifierDeps,
  options: { suppressUnfurls?: boolean } = {},
): Promise<void> {
  const owner = await deps.getOwnerUserId();
  if (!owner) {
    logger.info(
      `quarantine-notify: no owner configured — skipping DM for worker ${event.workerId}`,
    );
    return;
  }

  const filesPreview = event.dirtyFiles
    .slice(0, 10)
    .map((f) => `• \`${f}\``)
    .join("\n");
  const moreFiles =
    event.dirtyFiles.length > 10
      ? t("changes.quarantine.more_files", { n: event.dirtyFiles.length - 10 })
      : "";

  const branchLabel = event.branch ?? t("changes.quarantine.branch_detached");

  const text = [
    t("changes.quarantine.title", { workerId: event.workerId }),
    t("changes.quarantine.repo", { repo: event.repo }),
    t("changes.quarantine.branch", { branch: branchLabel }),
    t("changes.quarantine.trigger", { trigger: triggerLabel(event.trigger) }),
    t("changes.quarantine.dirty_header", { count: event.dirtyFiles.length }),
    `${filesPreview}${moreFiles}`,
    "",
    t("changes.quarantine.footer", { path: event.worktreePath }),
  ].join("\n");

  await deps.sendOwnerDm(owner, text, { suppressUnfurls: options.suppressUnfurls });
}
