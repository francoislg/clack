import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { getConfig } from "../../config.js";
import { slackFileWriteRole, type SlackFileFeatureConfig } from "../../configSchemas.js";
import {
  consumeStagedIntent,
  getSession,
  getStagedIntent,
  type SessionContext,
} from "../../sessions.js";
import type { StagedIntent, StagedListItemsDeleteIntent } from "../../tools/types.js";
import { getRole, type UserRole } from "../../roles.js";
import { meetsMinimumRole } from "../../permissions.js";
import { decodeActionValue } from "../blocks.js";
import { stripClickedButton } from "../stripClickedButton.js";
import { activeSessions, type SessionInfo } from "../activeSessions.js";
import { checkFileAccess } from "../requesterAccess.js";
import { deleteItems } from "../lists.js";
import { slackErrorCode } from "../../slackErrors.js";
import { errorMessage } from "../../errors.js";
import { t } from "../../i18n/t.js";

type SlackClient = App["client"];

export interface ListItemsDeleteActionDeps {
  getRole: (userId: string) => Promise<UserRole>;
  getConfig: () => { lists?: SlackFileFeatureConfig };
  meetsMinimumRole: typeof meetsMinimumRole;
  decodeActionValue: (value: string) => { sessionId: string; ref?: string };
  restoreSession: (sessionId: string) => Promise<SessionInfo | undefined>;
  getSession: (sessionId: string) => Promise<SessionContext | null>;
  getStagedIntent: (sessionId: string, ref: string) => Promise<StagedIntent | null>;
  consumeStagedIntent: (sessionId: string, ref: string) => Promise<StagedIntent | null>;
  checkFileAccess: typeof checkFileAccess;
  deleteItems: typeof deleteItems;
  stripClickedButton: typeof stripClickedButton;
  slackErrorCode: typeof slackErrorCode;
  errorMessage: (err: unknown) => string;
}

export const defaultListItemsDeleteActionDeps: ListItemsDeleteActionDeps = {
  getRole,
  getConfig,
  meetsMinimumRole,
  decodeActionValue,
  restoreSession: (sessionId: string) => activeSessions.restore(sessionId),
  getSession,
  getStagedIntent,
  consumeStagedIntent,
  checkFileAccess,
  deleteItems,
  stripClickedButton,
  slackErrorCode,
  errorMessage,
};

/** Where the clicker's ephemeral notices go. */
interface Thread {
  channelId: string;
  threadTs: string | undefined;
}

async function notify(
  client: SlackClient,
  userId: string,
  thread: Thread,
  text: string,
): Promise<void> {
  await client.chat.postEphemeral({
    channel: thread.channelId,
    user: userId,
    ...(thread.threadTs ? { thread_ts: thread.threadTs } : {}),
    text,
  });
}

/** The thread the clicked message sits in, read off the click payload. */
function clickedThread(body: BlockAction): Thread {
  const threadTs: unknown = body.message?.thread_ts;
  return {
    channelId: body.channel?.id ?? "",
    threadTs: typeof threadTs === "string" ? threadTs : undefined,
  };
}

/** The refusal text when List editing is off or the clicker is below the write role. */
function editingRefusal(
  lists: SlackFileFeatureConfig | undefined,
  role: UserRole,
  deps: Pick<ListItemsDeleteActionDeps, "meetsMinimumRole">,
): string | undefined {
  if (lists?.mode !== "write") return t("errors.list_delete_unavailable");
  const minRole = slackFileWriteRole(lists);
  if (!deps.meetsMinimumRole(role, minRole)) {
    return t("errors.list_delete_permission_denied", { role: minRole });
  }
  return undefined;
}

async function resolveDeletionIntent(
  sessionId: string,
  ref: string,
  deps: Pick<ListItemsDeleteActionDeps, "getStagedIntent">,
): Promise<StagedListItemsDeleteIntent | undefined> {
  const intent = await deps.getStagedIntent(sessionId, ref);
  return intent?.type === "list_items_delete" ? intent : undefined;
}

/**
 * The session whose access grants count for this click: the staging session when the clicker is
 * its requester, none otherwise. Someone else's grants never vouch for the clicker.
 */
async function ownSession(
  sessionId: string,
  sessionInfo: SessionInfo,
  userId: string,
  deps: Pick<ListItemsDeleteActionDeps, "getSession">,
): Promise<SessionContext | undefined> {
  if (sessionInfo.userId !== userId) return undefined;
  return (await deps.getSession(sessionId)) ?? undefined;
}

/** Remove the staged items and return the notice for the clicker. A failure is reported, never thrown. */
async function removeStagedItems(
  client: SlackClient,
  intent: StagedListItemsDeleteIntent,
  deps: Pick<ListItemsDeleteActionDeps, "deleteItems" | "slackErrorCode" | "errorMessage">,
): Promise<string> {
  try {
    await deps.deleteItems(
      client,
      intent.listId,
      intent.items.map((item) => item.id),
    );
    return t("errors.list_items_deleted", {
      count: intent.items.length,
      items: intent.items.map((item) => item.label).join(", "),
    });
  } catch (error) {
    logger.error("List item deletion failed:", error);
    const code = deps.slackErrorCode(error instanceof Error ? error : undefined);
    return t("errors.list_delete_failed", { error: code ?? deps.errorMessage(error) });
  }
}

export function registerListItemsDeleteActionHandler(
  app: App,
  deps: ListItemsDeleteActionDeps = defaultListItemsDeleteActionDeps,
): void {
  app.action<BlockAction>(
    /^clack_list_items_delete_\d+$/,
    async ({ ack, body, client, respond }) => {
      await ack();

      const action = body.actions[0];
      if (action?.type !== "button" || !action.value) {
        logger.error("List item deletion handler: the click carries no button value");
        return;
      }
      const { sessionId, ref } = deps.decodeActionValue(action.value);
      const userId = body.user.id;
      if (!ref) {
        logger.error("List item deletion handler: missing ref");
        return;
      }

      const role = await deps.getRole(userId);
      const refusal = editingRefusal(deps.getConfig().lists, role, deps);
      if (refusal !== undefined) {
        await notify(client, userId, clickedThread(body), refusal);
        return;
      }

      const sessionInfo = await deps.restoreSession(sessionId);
      if (!sessionInfo) {
        logger.error(`List item deletion handler: could not restore session ${sessionId}`);
        return;
      }
      const thread: Thread = { channelId: sessionInfo.channelId, threadTs: sessionInfo.threadTs };

      const intent = await resolveDeletionIntent(sessionId, ref, deps);
      if (!intent) {
        logger.error(`List item deletion handler: could not resolve intent ref ${ref}`);
        await notify(client, userId, thread, t("errors.list_delete_request_expired"));
        return;
      }

      const session = await ownSession(sessionId, sessionInfo, userId, deps);
      const verdict = await deps.checkFileAccess({ client, userId, role, session }, intent.listId);
      if (!verdict.allowed) {
        await notify(client, userId, thread, t("errors.list_delete_access_denied"));
        return;
      }

      // Claim the intent only now, so a refused click leaves it for someone allowed, and a
      // second concurrent click finds it gone.
      if (!(await deps.consumeStagedIntent(sessionId, ref))) {
        await notify(client, userId, thread, t("errors.list_delete_request_expired"));
        return;
      }

      const stripped = deps.stripClickedButton(body.message, action.action_id);
      if (stripped) {
        await respond({ replace_original: true, ...stripped });
      }

      const outcome = await removeStagedItems(client, intent, deps);
      try {
        await notify(client, userId, thread, outcome);
      } catch (error) {
        logger.error(
          `List item deletion handler: could not tell ${userId} the outcome for List ${intent.listId} ("${outcome}"):`,
          error,
        );
      }
    },
  );
}
