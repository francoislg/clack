import type { App } from "@slack/bolt";
import type { UserRole } from "../roles.js";
import type { SessionContext } from "../sessions.js";
import type { Config } from "../config.js";
import type { SlackImageFile, SlackFile } from "../slack/slackFileBase.js";
import type { QueryToolContext, WorkerToolContext, DeliverFn, DeliveryControl } from "./types.js";
import type { McpServerManager } from "../claude/mcpServerManager.js";
import type { SkillsManager } from "../claude/skillsManager.js";

export interface BuildQueryContextParams {
  userId: string;
  role: UserRole;
  session: SessionContext;
  config: Config;
  changesWorkflowEnabled: boolean;
  cronUserSchedules?: boolean;
  slackClient?: App["client"];
  deliver?: DeliverFn;
  /** Mid-run delivery-mode switch handle. Present only on interactive turns; enables the
   *  `switch_delivery_context` tool. */
  deliveryControl?: DeliveryControl;
  availableImages?: Map<string, SlackImageFile>;
  availableFiles?: Map<string, SlackFile>;
  requiredTools?: string[];
  skipConditions?: string;
  /**
   * Declarative override of `submit_response` schema/gating behavior. Propagated to the tool
   * server when building `submit_response`. See `CronJob.submitResponseMode` for the contract.
   */
  submitResponseMode?: "always" | "optional" | "optional-post-to" | "skipped";
  /**
   * When true, `submit_response` exposes top-level `additional_messages` and `thread_replies`.
   * Only the scheduled (cron) trigger sets this; everywhere else the fields are hidden.
   * Multi-message inside `post_to` actions is always available.
   */
  allowMultiMessage?: boolean;
  /**
   * Per-installation cap on `additional_messages.length`. Sourced from
   * `config.submitResponse.maxAdditionalMessages` (default 5, range [1, 10]).
   */
  maxAdditionalMessages?: number;
  /**
   * Effective "now" for time-sensitive tools. Populated by the cron scheduler during replay
   * runs. Real wall-clock `Date.now()` is used by tools when absent.
   */
  asOf?: Date;
  /**
   * MCP server lifecycle manager for this session. Owns session-start servers,
   * attached servers, and the effective registry; guarantees the merge invariant
   * on every `setMcpServers` call. Bound to the SDK Query by the orchestrator.
   */
  mcpManager?: McpServerManager;
  /**
   * Lazy skill-pack manager for this session. Owns per-pack skill metadata and
   * the session's `loadedSkills` set. Consumed by `list_skill_pack_skills` and
   * `load_skill`. Absent in worker mode.
   */
  skillsManager?: SkillsManager;
  /**
   * Returns true when `sendUpdate` has pushed user input Claude hasn't yet observed. Used
   * by `submit_response` to gate finalization on addressing queued user follow-ups.
   */
  hasPendingInput?: () => boolean;
  /**
   * Returns AND clears the texts of every unobserved push. Consumed by `submit_response`'s
   * gate to inline queued texts into its error result.
   */
  consumePendingPushedTexts?: () => string[];
}

export function buildQueryContext(params: BuildQueryContextParams): QueryToolContext {
  return {
    ...params,
    mode: "query",
    cronUserSchedules: params.cronUserSchedules ?? false,
  };
}

export interface BuildWorkerContextParams {
  worktreePath: string;
  branchName: string;
  repoName: string;
  repoUrl: string;
  channelId: string;
  threadTs: string;
  sessionId: string;
  silent?: boolean;
  config: Config;
}

export function buildWorkerContext(params: BuildWorkerContextParams): WorkerToolContext {
  return { mode: "worker", ...params };
}
