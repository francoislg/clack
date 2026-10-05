/**
 * Split-investigations engine: the surface-agnostic bootstrap, the round runner, the
 * per-round drain/refresh hook, the followed-thread event handler, and the boot
 * reconciliation sweep. Thin Slack adapters (reaction handler, tools, Home Tab) call in here;
 * the engine owns the orchestration and leaves Slack-notice concerns (owner DM, ephemerals) to
 * its callers via the returned outcome.
 */

import type { App } from "@slack/bolt";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import { t } from "../i18n/t.js";
import { getBotIdentity } from "../slack/botIdentity.js";
import { openDmChannel } from "../slack/channelResolver.js";
import { isBotInConversation } from "../slack/botMembership.js";
import {
  createSession,
  findSessionByThread,
  getSession,
  updateSession,
  type SessionContext,
} from "../sessions.js";
import { processMessage, setInvestigationSessionRefresher } from "../slack/handlers/core.js";
import { runInvestigationPreAnalysis } from "../claude/preAnalysis.js";
import { isBotMessage } from "../slack/isBotMessage.js";
import { getUserPreference } from "../userPreferences.js";
import { getUserInfo } from "../slack/userCache.js";
import { drainFollowedThreads, type DrainClient } from "./drain.js";
import { buildInvestigationDeliveryContext } from "./deliveryContext.js";
import {
  findInvestigationByFollowedThread,
  getInvestigationsChannel,
  listOpenInvestigations,
  openInvestigation,
} from "./state.js";
import type { FollowedThread, FollowMode, InvestigationSurface } from "./types.js";

type SlackClient = App["client"];

function toDrainClient(client: SlackClient): DrainClient {
  return {
    conversations: {
      replies: (args) => client.conversations.replies(args),
    },
  };
}

function slackTsNow(): string {
  return (Date.now() / 1000).toFixed(6);
}

async function getPermalink(
  client: SlackClient,
  channel: string,
  ts: string,
): Promise<string | undefined> {
  try {
    const res = await client.chat.getPermalink({ channel, message_ts: ts });
    return res.permalink;
  } catch {
    return undefined;
  }
}

/** Render the requester for the parent message: a pinging mention when the user opted in,
 *  else a plain-text @name that does not notify. */
async function renderRequesterLabel(client: SlackClient, requester: string): Promise<string> {
  const tag = await getUserPreference(requester, "investigationTag");
  if (tag) return `<@${requester}>`;
  const info = await getUserInfo(client, requester);
  const name = info?.displayName ?? info?.username ?? requester;
  return `@${name}`;
}

/** The requester-access grants held by the session of the origin thread, copied so the forked
 *  session owns its own list. No origin session, no grants, or a failed lookup → none. */
async function originAccessGrants(channel: string, threadTs: string): Promise<string[]> {
  try {
    const origin = await findSessionByThread(channel, threadTs);
    return [...(origin?.accessGranted ?? [])];
  } catch (err) {
    logger.warn(
      `investigations: origin session lookup failed for ${channel}/${threadTs}: ${String(err)}`,
    );
    return [];
  }
}

/**
 * Drain the session's followed threads, rebuild its investigation delivery context (+ deltas)
 * into `additionalSystemPrompt`, and advance cursors. Registered as the core session refresher
 * so EVERY round — engine-driven or a human reply in the main thread — drains uniformly. A
 * second call in the same round finds nothing new (cursors already advanced) and is a no-op.
 */
export async function refreshInvestigationSession(
  session: SessionContext,
  client: SlackClient,
): Promise<SessionContext> {
  const followed = session.followedThreads;
  if (!followed || followed.length === 0) return session;

  const anchor = findInvestigationByFollowedThread(followed[0].channel, followed[0].threadTs);
  const surface: InvestigationSurface = anchor?.surface ?? "channel";

  const { botUserId } = await getBotIdentity(client);
  const drain = await drainFollowedThreads(
    toDrainClient(client),
    followed,
    botUserId ? { botUserId } : {},
  );

  const deliveryContext = buildInvestigationDeliveryContext({
    surface,
    followedThreads: drain.updatedThreads,
    ...(anchor?.subject ? { subject: anchor.subject } : {}),
  });
  const additionalSystemPrompt = drain.injectedContext
    ? `${deliveryContext}\n\n${drain.injectedContext}`
    : deliveryContext;

  const updated = await updateSession(session.sessionId, {
    followedThreads: drain.updatedThreads,
    additionalSystemPrompt,
  });
  return updated ?? session;
}

/** Register the drain/refresh hook with the core message pipeline. Call once at boot. */
export function initInvestigationsEngine(): void {
  setInvestigationSessionRefresher(refreshInvestigationSession);
}

/** Drive one investigation round as a resumed turn on the main-surface session. The core
 *  refresh hook drains the followed threads before the turn. Pass `deferProgress: true` when
 *  nobody is waiting on the round (a followed-thread event or boot reconciliation), so its
 *  progress card stays hidden until the round does visible work. */
export async function runInvestigationRound(
  client: SlackClient,
  sessionId: string,
  userId: string,
  messageText: string,
  { deferProgress = false }: { deferProgress?: boolean } = {},
): Promise<void> {
  const anchor = listOpenInvestigations().find((i) => i.sessionId === sessionId);
  if (!anchor) {
    logger.warn(`runInvestigationRound: no open investigation for session ${sessionId}`);
    return;
  }
  await processMessage({
    client,
    userId,
    channelId: anchor.mainChannel,
    messageTs: slackTsNow(),
    messageText,
    threadTs: anchor.mainThreadTs,
    triggerType: "mentions",
    resumeSessionId: sessionId,
    deferProgress,
  });
}

export interface BootstrapParams {
  client: SlackClient;
  surface: InvestigationSurface;
  originChannel: string;
  originThreadTs: string;
  /** Slack user id starting the investigation. */
  requester: string;
  /** Mode for the origin thread. Reaction/"investigate on the side" → followAndInteract;
   *  DM relocation → follow. */
  originMode?: FollowMode;
  subject?: string;
}

export type BootstrapResult =
  | { status: "ok"; sessionId: string; mainChannel: string; permalink?: string }
  | { status: "not_in_channel" }
  | { status: "channel_not_configured" }
  | { status: "cycle" }
  | { status: "duplicate"; permalink?: string }
  | { status: "dm_failed" };

/**
 * The one bootstrap all three entry points funnel into: link an existing investigation of the
 * origin (`duplicate`), refuse an origin the bot is not a member of (`not_in_channel`), resolve
 * the main surface, post the parent, create the session following the origin, run an immediate
 * first round over the full origin history, and leave a single breadcrumb in the origin thread.
 */
export async function bootstrapInvestigation(params: BootstrapParams): Promise<BootstrapResult> {
  const { client, surface, originChannel, originThreadTs, requester } = params;

  const existing = findInvestigationByFollowedThread(originChannel, originThreadTs);
  if (existing) {
    const permalink = await getPermalink(client, existing.mainChannel, existing.mainThreadTs);
    return { status: "duplicate", ...(permalink ? { permalink } : {}) };
  }

  // Clack only follows a thread it already receives events for: it never joins a channel.
  if (!(await isBotInConversation(client, originChannel))) return { status: "not_in_channel" };

  let mainChannel: string;
  if (surface === "channel") {
    const configured = getInvestigationsChannel();
    if (!configured) return { status: "channel_not_configured" };
    if (originChannel === configured) return { status: "cycle" };
    mainChannel = configured;
  } else {
    const dm = await openDmChannel(client, requester);
    if (!dm) return { status: "dm_failed" };
    mainChannel = dm;
  }

  const originMode: FollowMode = params.originMode ?? "followAndInteract";

  const [originPermalink, requesterLabel] = await Promise.all([
    getPermalink(client, originChannel, originThreadTs),
    renderRequesterLabel(client, requester),
  ]);
  const linkVar = originPermalink ?? `<#${originChannel}>`;
  const parentText = t("investigations.parent", { requester: requesterLabel, link: linkVar });

  const parent = await client.chat.postMessage({ channel: mainChannel, text: parentText });
  const mainThreadTs = parent.ts;
  if (!mainThreadTs) {
    logger.error("investigations: parent message returned no ts; aborting bootstrap");
    return { status: "dm_failed" };
  }

  const originThread: FollowedThread = {
    channel: originChannel,
    threadTs: originThreadTs,
    mode: originMode,
    lastInjectedTs: "0",
    pendingCount: 0,
    addedBy: requester,
  };

  const session = await createSession({
    channelId: mainChannel,
    messageTs: mainThreadTs,
    threadTs: mainThreadTs,
    userId: requester,
    trigger: {
      type: "mentions",
      userId: requester,
      messageTs: mainThreadTs,
      messageText: params.subject ?? "Investigation",
    },
  });
  const accessGranted = await originAccessGrants(originChannel, originThreadTs);
  await updateSession(session.sessionId, {
    followedThreads: [originThread],
    ...(accessGranted.length > 0 ? { accessGranted } : {}),
  });

  await openInvestigation({
    sessionId: session.sessionId,
    mainChannel,
    mainThreadTs,
    surface,
    startedBy: requester,
    ...(params.subject ? { subject: params.subject } : {}),
    followed: [{ channel: originChannel, threadTs: originThreadTs }],
  });

  const firstRoundText = params.subject
    ? `Investigate: ${params.subject}. Review the followed thread's full history and report your findings.`
    : "Review the followed thread's full history and report your findings.";
  // The first round is a full nested Claude query — launch it detached so no caller
  // (tool handler, reaction handler) blocks on it. The investigation is already created
  // and indexed; a round failure only logs — the session, index, and parent message stand.
  runInvestigationRound(client, session.sessionId, requester, firstRoundText).catch((err) => {
    logger.warn(`investigations: first round failed for ${session.sessionId}: ${String(err)}`);
  });

  const [mainPermalink, breadcrumbPref] = await Promise.all([
    getPermalink(client, mainChannel, mainThreadTs),
    getUserPreference(requester, "investigationBreadcrumb"),
  ]);
  if (breadcrumbPref === "explicit") {
    const breadcrumb =
      surface === "dm"
        ? t("investigations.breadcrumb_dm")
        : t("investigations.breadcrumb_channel", { link: mainPermalink ?? `<#${mainChannel}>` });
    try {
      await client.chat.postMessage({
        channel: originChannel,
        thread_ts: originThreadTs,
        text: breadcrumb,
      });
    } catch (err) {
      logger.warn(`investigations: failed to post breadcrumb in ${originChannel}: ${String(err)}`);
    }
  }

  return {
    status: "ok",
    sessionId: session.sessionId,
    mainChannel,
    ...(mainPermalink ? { permalink: mainPermalink } : {}),
  };
}

interface FollowedEvent {
  channel: string;
  threadTs?: string;
  userId?: string;
  botId?: string;
  subtype?: string;
  text?: string;
}

/**
 * Tee target for message events in followed threads. Non-destructive: the normal pipeline
 * handles the same event independently. `followAndInteract` runs the subject-keyed classifier
 * and drives a round on `respond`; `follow` only bumps the pending count.
 */
export async function handleFollowedThreadEvent(
  client: SlackClient,
  event: FollowedEvent,
): Promise<void> {
  if (!getConfig().investigations?.enabled) return;
  const { channel, threadTs } = event;
  if (!threadTs) return;

  const entry = findInvestigationByFollowedThread(channel, threadTs);
  if (!entry) return;

  const { botUserId } = await getBotIdentity(client);
  if (
    isBotMessage({
      userId: event.userId,
      botId: event.botId,
      subtype: event.subtype,
      ...(botUserId ? { botUserId } : {}),
    })
  ) {
    return;
  }
  const text = (event.text ?? "").trim();
  if (!text) return;

  const session = await getSession(entry.sessionId);
  const followed = session?.followedThreads?.find(
    (f) => f.channel === channel && f.threadTs === threadTs,
  );
  if (!session || !followed) return;

  if (followed.mode === "follow") {
    const nextThreads = session.followedThreads?.map((f) =>
      f.channel === channel && f.threadTs === threadTs
        ? { ...f, pendingCount: f.pendingCount + 1 }
        : f,
    );
    await updateSession(session.sessionId, { followedThreads: nextThreads });
    return;
  }

  const botName = getConfig().slackApp?.name ?? "Clack";
  const verdict = await runInvestigationPreAnalysis(entry.subject, text, botName);
  if (verdict !== "respond") return;
  await runInvestigationRound(
    client,
    entry.sessionId,
    entry.startedBy,
    "New activity in a followed thread. Review the injected updates and continue the investigation.",
    { deferProgress: true },
  );
}

async function reconcileOneInvestigation(
  client: SlackClient,
  inv: { sessionId: string; startedBy: string; subject?: string },
  botUserId: string | undefined,
  botName: string,
): Promise<void> {
  const session = await getSession(inv.sessionId);
  const interactive = session?.followedThreads?.filter((f) => f.mode === "followAndInteract");
  if (!session || !interactive || interactive.length === 0) return;

  const peek = await drainFollowedThreads(
    toDrainClient(client),
    interactive,
    botUserId ? { botUserId } : {},
  );
  if (!peek.drainedAny) return;

  const verdict = await runInvestigationPreAnalysis(inv.subject, peek.injectedContext, botName);
  if (verdict !== "respond") return;
  await runInvestigationRound(
    client,
    inv.sessionId,
    inv.startedBy,
    "Catching up after downtime. Review the injected updates and continue the investigation.",
    { deferProgress: true },
  );
}

/**
 * Boot reconciliation: recover triggers lost while the process was down. For each open
 * investigation, if any `followAndInteract` thread has undrained human messages, run the
 * classifier and drive a round on `respond`. Fired from a delayed boot timer (after
 * `cron.catchUp.delayMinutes`) in `index.ts`. Each investigation is isolated so one
 * unreachable thread never blocks the others.
 */
export async function reconcileInvestigationsOnBoot(client: SlackClient): Promise<void> {
  if (!getConfig().investigations?.enabled) return;
  const { botUserId } = await getBotIdentity(client);
  const botName = getConfig().slackApp?.name ?? "Clack";

  for (const inv of listOpenInvestigations()) {
    try {
      await reconcileOneInvestigation(client, inv, botUserId, botName);
    } catch (err) {
      logger.warn(
        `investigations: boot reconciliation failed for ${inv.sessionId}: ${String(err)}`,
      );
    }
  }
}
