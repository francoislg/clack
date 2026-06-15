import type { App } from "@slack/bolt";
import { t } from "../../i18n/t.js";
import { logger } from "../../logger.js";
import { getConfig, findRepoByName, type Config, type RepositoryConfig } from "../../config.js";
import { getExistingWorktree } from "../../worktrees.js";
import { createSession } from "../../sessions.js";
import { resolveNonCollidingBranch } from "../../changes/branchNaming.js";
import { startChangeWorkflow, type WorkflowDeps } from "../../changes/workflow.js";
import { SlackStreamer, finalizeStreamedWorkflow } from "../../streaming/slackStreamer.js";
import type { StreamEvent } from "../../streaming/types.js";
import type { ChangeRequest, ChangePlan, ChangeResult, TriggerType } from "../../changes/types.js";
import type { SpinoffIntentData } from "../../changes/spinoff.js";

export interface ProvisionSpinoffDeps {
  getConfig: () => Config;
  findRepoByName: (name: string, config: Config) => RepositoryConfig | undefined;
  branchExists: (repo: RepositoryConfig, branch: string) => boolean;
  createSession: typeof createSession;
  startChangeWorkflow: (
    request: ChangeRequest,
    plan: ChangePlan,
    sessionId: string,
    onEvent: (event: StreamEvent) => void,
    deps?: WorkflowDeps,
    onAck?: (text: string) => Promise<void>,
    options?: { bypassUserCap?: boolean },
  ) => Promise<ChangeResult>;
  createStreamer: (opts: {
    client: App["client"];
    channel: string;
    threadTs: string;
    userId: string;
    thinkingTitle: string;
  }) => SlackStreamer;
  finalizeStreamedWorkflow: typeof finalizeStreamedWorkflow;
  getPermalink: (client: App["client"], channel: string, ts: string) => Promise<string | undefined>;
}

export const defaultProvisionSpinoffDeps: ProvisionSpinoffDeps = {
  getConfig,
  findRepoByName,
  branchExists: (repo, branch) => getExistingWorktree(repo, branch) !== null,
  createSession,
  startChangeWorkflow,
  createStreamer: (opts) => new SlackStreamer(opts),
  finalizeStreamedWorkflow,
  getPermalink: async (client, channel, ts) => {
    try {
      const res = await client.chat.getPermalink({ channel, message_ts: ts });
      return res.permalink;
    } catch {
      return undefined;
    }
  },
};

export interface ProvisionSpinoffSiblingsArgs {
  spinoffs: SpinoffIntentData[];
  /** Repo of the originating change — the sibling lives in the same repo. */
  repo: string;
  /** Channel the originating change runs in — siblings post a NEW top-level message here. */
  channel: string;
  userId: string;
  userDisplayName?: string;
  triggerType: TriggerType;
  /** Thread of the originating change, for the cross-link back-reference. */
  parentThreadTs: string;
  client: App["client"];
  deps?: ProvisionSpinoffDeps;
}

/**
 * Provision one standalone sibling change session per staged spinoff slice. Each sibling gets
 * its OWN top-level Slack thread (not a reply under the parent), a fresh non-colliding branch,
 * its own streamed worker run (the slice patch is applied by the workflow), and a cross-link to
 * and from the originating thread. Siblings are provisioned sequentially; one failing does not
 * stop the others. Orchestrator-initiated, so they bypass the per-user active-change cap.
 */
export async function provisionSpinoffSiblings(args: ProvisionSpinoffSiblingsArgs): Promise<void> {
  const deps = args.deps ?? defaultProvisionSpinoffDeps;
  const repo = deps.findRepoByName(args.repo, deps.getConfig());

  for (const spinoff of args.spinoffs) {
    try {
      await provisionOne(spinoff, args, deps, repo);
    } catch (err) {
      logger.error(`Spinoff sibling provisioning failed for ${spinoff.proposedBranch}:`, err);
    }
  }
}

async function provisionOne(
  spinoff: SpinoffIntentData,
  args: ProvisionSpinoffSiblingsArgs,
  deps: ProvisionSpinoffDeps,
  repo: RepositoryConfig | undefined,
): Promise<void> {
  const { client, channel } = args;
  const branch = repo
    ? resolveNonCollidingBranch(spinoff.proposedBranch, (b) => deps.branchExists(repo, b))
    : spinoff.proposedBranch;

  // New top-level message → the sibling's own thread.
  const intro = await client.chat.postMessage({
    channel,
    text: t("changes.spinoff.sibling_thread_intro", { description: spinoff.description, branch }),
  });
  const siblingTs = intro.ts;
  if (!siblingTs) {
    logger.error(`Spinoff: top-level message returned no ts for ${branch}; skipping sibling`);
    return;
  }

  const session = await deps.createSession({
    channelId: channel,
    messageTs: siblingTs,
    threadTs: siblingTs,
    userId: args.userId,
    trigger: {
      type: "mentions",
      userId: args.userId,
      messageTs: siblingTs,
      messageText: spinoff.description,
    },
  });

  // Cross-link both ways (best-effort — a permalink hiccup must not abort provisioning).
  const [siblingLink, parentLink] = await Promise.all([
    deps.getPermalink(client, channel, siblingTs),
    deps.getPermalink(client, channel, args.parentThreadTs),
  ]);
  if (siblingLink) {
    await client.chat.postMessage({
      channel,
      thread_ts: args.parentThreadTs,
      text: t("changes.spinoff.posted_in_parent", {
        description: spinoff.description,
        link: siblingLink,
      }),
    });
  }
  if (parentLink) {
    await client.chat.postMessage({
      channel,
      thread_ts: siblingTs,
      text: t("changes.spinoff.spun_off_from", { link: parentLink }),
    });
  }

  const request: ChangeRequest = {
    userId: args.userId,
    ...(args.userDisplayName && { userDisplayName: args.userDisplayName }),
    message: spinoff.description,
    triggerType: args.triggerType,
    channel,
    messageTs: siblingTs,
  };
  const plan: ChangePlan = {
    branchName: branch,
    description: spinoff.description,
    targetRepo: args.repo,
    applySpinoffPatch: spinoff.patchPath,
  };

  const streamer = deps.createStreamer({
    client,
    channel,
    threadTs: siblingTs,
    userId: args.userId,
    thinkingTitle: t("streamer.working_on", { branch }),
  });
  await streamer.start();

  const onAck = async (text: string): Promise<void> => {
    await client.chat.postMessage({ channel, thread_ts: siblingTs, text });
  };

  const result = await deps.startChangeWorkflow(
    request,
    plan,
    session.sessionId,
    streamer.handleEvent,
    undefined,
    onAck,
    { bypassUserCap: true },
  );

  await deps.finalizeStreamedWorkflow(
    streamer,
    client,
    channel,
    siblingTs,
    result,
    "Change request",
  );

  // A sibling may itself spin off further slices — same machinery, one more level.
  if (result.success && result.spinoffs && result.spinoffs.length > 0) {
    await provisionSpinoffSiblings({
      ...args,
      spinoffs: result.spinoffs,
      parentThreadTs: siblingTs,
    });
  }
}
