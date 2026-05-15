import { logger } from "../logger.js";
import { errorMessage } from "../errors.js";
import { loadRoles } from "../roles.js";
import { getSlackClient } from "../slack/app.js";
import { openDmChannel } from "../slack/channelResolver.js";
import type { QuarantineEvent } from "./reusablePool.js";

const TRIGGER_LABELS: Record<QuarantineEvent["trigger"], string> = {
  release: "PR completion",
  branch_switch: "branch switch",
  idle_release: "idle-release sweep",
};

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
  sendOwnerDm: (ownerUserId: string, text: string) => Promise<boolean>;
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

async function defaultSendOwnerDm(ownerUserId: string, text: string): Promise<boolean> {
  const client = getSlackClient();
  if (!client) {
    logger.warn(`quarantine-notify: no Slack client available`);
    return false;
  }
  const dmChannel = await openDmChannel(client, ownerUserId);
  if (!dmChannel) return false; // openDmChannel logs internally
  try {
    await client.chat.postMessage({ channel: dmChannel, text });
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
): Promise<void> {
  const owner = await deps.getOwnerUserId();
  if (!owner) {
    logger.info(
      `quarantine-notify: no owner configured — skipping DM for worker ${event.workerId}`,
    );
    return;
  }

  const triggerLabel = TRIGGER_LABELS[event.trigger];
  const filesPreview = event.dirtyFiles
    .slice(0, 10)
    .map((f) => `• \`${f}\``)
    .join("\n");
  const moreFiles =
    event.dirtyFiles.length > 10 ? `\n…and ${event.dirtyFiles.length - 10} more` : "";

  const text = [
    `:warning: Worker \`${event.workerId}\` quarantined`,
    `*Repo:* ${event.repo}`,
    `*Branch:* ${event.branch ?? "(detached)"}`,
    `*Trigger:* ${triggerLabel}`,
    `*Dirty tracked files (${event.dirtyFiles.length}):*`,
    `${filesPreview}${moreFiles}`,
    "",
    `The worker is excluded from acquire until cleared. Discard the changes via the Home Tab "Discard & restore" button (or remove \`.clack-quarantine.json\` from \`${event.worktreePath}\` manually) once you've decided what to do.`,
  ].join("\n");

  await deps.sendOwnerDm(owner, text);
}
