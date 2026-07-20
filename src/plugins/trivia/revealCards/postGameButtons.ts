/**
 * Registry + shared machinery for the buttons appended to a revealed trivia
 * question's card (the "post-game buttons"). One declarative entry per button
 * (`see-answer`, `tell-me-more`, …) drives three write-once helpers:
 *
 *   - `renderPostGameButtons` — render every enabled entry as elements of ONE
 *     shared `actions` block, so they sit on a single row (used by `editCard.ts`),
 *   - `installPostGameButtons` — register one Slack action handler per entry at
 *     boot; `one-shot` entries get the static element-drop applied uniformly,
 *   - `removePostGameButton` — drop a single button's element by its `action_id`,
 *     preserving every sibling button (and dropping the block once it empties).
 *
 * Adding a post-game button is one registry entry (+ its `onClick`) — the
 * renderer, installer, and remover never change. The two pre-reveal live-card
 * buttons (`hint`, `freeform-answer`) are deliberately NOT modelled here: they
 * live on the question card before reveal, on a different host block.
 */

import type { KnownBlock } from "@slack/types";
import type { ModalView, ViewsOpenResponse } from "@slack/web-api";
import type { ClackSdk, PluginActionHandler } from "../../../plugins-sdk/sdk.js";
import { triviaLogger as logger } from "../core/pluginLogger.js";
import type { ScopedTriviaDataLayer, TriviaDataLayer, TriviaQuestion } from "../core/types.js";
import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";

/** Narrow Slack client surface shared by post-game button click handlers. */
export interface PostGameSlackClient {
  views: {
    open: (args: { trigger_id: string; view: ModalView }) => Promise<ViewsOpenResponse>;
  };
  chat: {
    update: (args: { channel: string; ts: string; blocks: KnownBlock[] }) => Promise<{
      ok?: boolean;
    }>;
  };
}

/** SDK surface the installer + click handlers depend on. */
export type PostGameSdk = Pick<
  ClackSdk,
  "registerAction" | "sendMessage" | "startThreadConversation"
> & {
  getSlackClient: () => PostGameSlackClient | null;
};

/** Normalized fields read off the Slack action body. */
export interface PostGameActionBody {
  trigger_id?: string;
  user?: { id?: string };
  channel?: { id?: string };
  message?: { ts?: string; blocks?: KnownBlock[] };
}

/** Inputs to a button's enablement predicate at render time. */
export interface PostGameButtonContext {
  question: TriviaQuestion;
  game: TriviaGame | null;
  config: TriviaConfig | null;
}

/** Fields every click handler receives, regardless of lifecycle. */
interface BaseClickContext {
  questionId: string;
  question: TriviaQuestion;
  gameName: string;
  scoped: ScopedTriviaDataLayer;
  data: TriviaDataLayer;
  body: PostGameActionBody;
  client: PostGameSlackClient;
  sdk: PostGameSdk;
}

export type PersistentClickContext = BaseClickContext;

/** A one-shot click: the wrapper already removed the block and resolved the card location. */
export interface OneShotClickContext extends BaseClickContext {
  channel: string;
  ts: string;
  userId: string;
}

interface PostGameButtonShared {
  /** Stable identifier, used in log lines and tests. */
  key: string;
  /** Regex passed to `sdk.registerAction` — matches the action_id suffix after SDK scope. */
  actionRe: RegExp;
  /** Full prefix Slack delivers at click time (after the `plugin:trivia:` scope). */
  actionPrefix: string;
  /** Suffix handed to `sdk.actionId(...)` when rendering the button. */
  actionIdSuffix: (questionId: string) => string;
  /** Localized button label (resolved through the plugin `t()`). */
  label: () => string;
  /** Whether this button is rendered for the given question/game/config. */
  enabled: (ctx: PostGameButtonContext) => boolean;
}

export interface PersistentPostGameButton extends PostGameButtonShared {
  lifecycle: "persistent";
  onClick: (ctx: PersistentClickContext) => Promise<void>;
}

export interface OneShotPostGameButton extends PostGameButtonShared {
  lifecycle: "one-shot";
  onClick: (ctx: OneShotClickContext) => Promise<void>;
}

export type PostGameButton = PersistentPostGameButton | OneShotPostGameButton;

/** `block_id` of the shared actions block that hosts every post-game button. */
export const postGameActionsBlockId = (questionId: string): string =>
  `reveal-post-game-actions:${questionId}`;

/**
 * Render the enabled post-game buttons as elements of ONE shared `actions`
 * block, in registry order, so Slack lays them out on a single row. Disabled
 * entries are omitted; an all-disabled registry yields no block at all.
 */
export function renderPostGameButtons(
  registry: readonly PostGameButton[],
  ctx: PostGameButtonContext,
  actionId: (key: string) => string,
): KnownBlock[] {
  const elements = registry
    .filter((button) => button.enabled(ctx))
    .map((button) => ({
      type: "button" as const,
      action_id: actionId(button.actionIdSuffix(ctx.question.id)),
      text: { type: "plain_text" as const, text: button.label(), emoji: true },
    }));
  if (elements.length === 0) return [];
  return [{ type: "actions", block_id: postGameActionsBlockId(ctx.question.id), elements }];
}

/**
 * Statically drop a button's element by its `action_id`, leaving sibling
 * buttons in place; the host `actions` block is dropped only once it empties.
 * `removed: false` means the element was already absent — the caller should
 * treat the click as a no-op. Scans every `actions` block, so it tolerates both
 * the shared-row layout and any legacy one-block-per-button card still in flight.
 */
export function removePostGameButton(
  currentBlocks: KnownBlock[],
  button: PostGameButton,
  questionId: string,
): { blocks: KnownBlock[]; removed: boolean } {
  const targetActionId = `${button.actionPrefix}${questionId}`;
  let removed = false;
  const blocks: KnownBlock[] = [];
  for (const block of currentBlocks) {
    if (block.type === "actions") {
      const kept = block.elements.filter(
        (el) => !("action_id" in el && el.action_id === targetActionId),
      );
      if (kept.length !== block.elements.length) {
        removed = true;
        if (kept.length > 0) blocks.push({ ...block, elements: kept });
        continue;
      }
    }
    blocks.push(block);
  }
  return { blocks, removed };
}

export interface PostGameInstallDeps {
  data: TriviaDataLayer;
  getGameNames: () => string[];
}

/** Register one Slack action handler per registry entry. */
export function installPostGameButtons(
  sdk: PostGameSdk,
  registry: readonly PostGameButton[],
  deps: PostGameInstallDeps,
): void {
  for (const button of registry) {
    sdk.registerAction(button.actionRe, makeHandler(sdk, button, deps));
  }
}

function makeHandler(
  sdk: PostGameSdk,
  button: PostGameButton,
  deps: PostGameInstallDeps,
): PluginActionHandler {
  return async ({ ack, body, action }) => {
    await ack();
    const client = sdk.getSlackClient();
    if (!client) {
      logger.warn(`[trivia:reveal-card] ${button.key} fired before Slack client was connected`);
      return;
    }

    const actionId =
      "action_id" in action && typeof action.action_id === "string" ? action.action_id : "";
    const questionId = extractQuestionId(actionId, button.actionPrefix);
    if (questionId === null) {
      logger.warn(`[trivia:reveal-card] unparseable ${button.key} action_id: ${actionId}`);
      return;
    }

    const normBody = normalizeBody(body);

    if (button.lifecycle === "one-shot") {
      const channel = normBody.channel?.id;
      const ts = normBody.message?.ts;
      const currentBlocks = normBody.message?.blocks;
      const userId = normBody.user?.id ?? null;
      if (!channel || !ts || !currentBlocks || userId === null) {
        logger.warn(`[trivia:reveal-card] ${button.key} body missing channel/message/user`);
        return;
      }

      // Remove the button's block first. If it's already gone, another click won
      // the race and started the side effects — no-op (no duplicate kickoff).
      const { blocks: remaining, removed } = removePostGameButton(
        currentBlocks,
        button,
        questionId,
      );
      if (!removed) {
        logger.debug(
          `[trivia:reveal-card] ${button.key} already removed for ${questionId} — no-op`,
        );
        return;
      }

      const resolved = await resolveQuestion(deps, questionId, button.key);
      if (!resolved) return;

      try {
        await client.chat.update({ channel, ts, blocks: remaining });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `[trivia:reveal-card] ${button.key} chat.update failed for ${questionId}: ${msg}`,
        );
        return;
      }

      await button.onClick({
        questionId,
        question: resolved.question,
        gameName: resolved.gameName,
        scoped: resolved.scoped,
        data: deps.data,
        body: normBody,
        client,
        sdk,
        channel,
        ts,
        userId,
      });
      return;
    }

    // Persistent: no removal. The entry's onClick performs any body validation
    // (e.g. trigger_id) it needs and runs its interaction.
    const resolved = await resolveQuestion(deps, questionId, button.key);
    if (!resolved) return;
    await button.onClick({
      questionId,
      question: resolved.question,
      gameName: resolved.gameName,
      scoped: resolved.scoped,
      data: deps.data,
      body: normBody,
      client,
      sdk,
    });
  };
}

/** Locate the owning game and load the question; logs + returns null on any miss. */
async function resolveQuestion(
  deps: PostGameInstallDeps,
  questionId: string,
  key: string,
): Promise<{ gameName: string; scoped: ScopedTriviaDataLayer; question: TriviaQuestion } | null> {
  const gameName = await findGameForQuestion(deps.data, deps.getGameNames(), questionId);
  if (gameName === null) {
    logger.warn(`[trivia:reveal-card] no game owns question ${questionId} (${key})`);
    return null;
  }
  const scoped = deps.data.forGame(gameName);
  const question = (await scoped.loadQuestions()).find((q) => q.id === questionId);
  if (!question) {
    logger.warn(`[trivia:reveal-card] question ${questionId} disappeared before ${key} handled`);
    return null;
  }
  return { gameName, scoped, question };
}

/** Scan every known game's `questions.json` for the owner of a questionId. */
async function findGameForQuestion(
  data: TriviaDataLayer,
  gameNames: readonly string[],
  questionId: string,
): Promise<string | null> {
  for (const name of gameNames) {
    const questions = await data.forGame(name).loadQuestions();
    if (questions.some((q) => q.id === questionId)) return name;
  }
  return null;
}

/** Extract the questionId from a dispatched action_id given the button's full prefix. */
export function extractQuestionId(actionId: string, prefix: string): string | null {
  if (!actionId.startsWith(prefix)) return null;
  const id = actionId.slice(prefix.length);
  return id.length > 0 && !id.includes(":") ? id : null;
}

/** Read the fields we care about off the typed Slack action body, defensively. */
function normalizeBody(body: PluginActionBody): PostGameActionBody {
  const triggerId =
    "trigger_id" in body && typeof body.trigger_id === "string" ? body.trigger_id : undefined;
  const userId =
    "user" in body && body.user && typeof body.user.id === "string" ? body.user.id : undefined;
  const channelId =
    "channel" in body && body.channel && typeof body.channel.id === "string"
      ? body.channel.id
      : undefined;
  const message = "message" in body ? body.message : undefined;
  const ts = message && typeof message.ts === "string" ? message.ts : undefined;
  const blocks = (message as { blocks?: KnownBlock[] } | undefined)?.blocks;
  return {
    trigger_id: triggerId,
    user: userId !== undefined ? { id: userId } : undefined,
    channel: channelId !== undefined ? { id: channelId } : undefined,
    message: message ? { ts, blocks } : undefined,
  };
}

/** The Bolt action body shape, narrowed to the optional fields we read. */
type PluginActionBody = Parameters<PluginActionHandler>[0]["body"];
