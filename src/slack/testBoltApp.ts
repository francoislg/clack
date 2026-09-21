import { vi } from "vitest";
import { App } from "@slack/bolt";
import type {
  AllMiddlewareArgs,
  BlockAction,
  ButtonAction,
  EnvelopedEvent,
  SlackActionMiddlewareArgs,
  SlackEventMiddlewareArgs,
  SlackViewMiddlewareArgs,
  ViewOutput,
  ViewSubmitAction,
} from "@slack/bolt";
import type { AppHomeOpenedEvent } from "@slack/types";
import { createSlackClientMock, type MockSlackClient } from "./testSlackClient.js";

/**
 * The canonical Bolt app fake: a real `App` with every method deeply mocked. Registration is
 * read back off the mock, so a handler under test is the one Bolt itself would have received:
 *
 *     const app = createSlackAppMock();
 *     registerRetryHandler(app, deps);
 *     const [constraints, listener] = app.action.mock.calls[0];
 *
 * The app never connects — no receiver is started and no token is used.
 */
export function createSlackAppMock() {
  return vi.mockObject(new App({ token: "xoxb-test", signingSecret: "test-signing-secret" }));
}

export type MockSlackApp = ReturnType<typeof createSlackAppMock>;

export type BlockActionArgs = SlackActionMiddlewareArgs<BlockAction<ButtonAction>> &
  AllMiddlewareArgs;

export type ViewSubmitArgs = SlackViewMiddlewareArgs<ViewSubmitAction> & AllMiddlewareArgs;

export type AppHomeOpenedArgs = SlackEventMiddlewareArgs<"app_home_opened"> & AllMiddlewareArgs;

/**
 * A complete set of listener arguments for a block-action handler, typed as Bolt types them.
 * A test names only what its claim depends on; `ack`, `respond`, `say` and `next` are mocks it
 * can assert on directly (`args.ack.mock.calls`).
 */
export function createBlockActionArgs(
  opts: {
    value?: string;
    actionId?: string;
    userId?: string;
    channelId?: string;
    messageTs?: string;
    triggerId?: string;
    client?: MockSlackClient;
  } = {},
) {
  const action: ButtonAction = {
    type: "button",
    action_id: opts.actionId ?? "test_action",
    block_id: "test_block",
    value: opts.value ?? "",
    text: { type: "plain_text", text: "Test" },
    action_ts: opts.messageTs ?? "1700000000.000100",
  };

  const body: BlockAction<ButtonAction> = {
    type: "block_actions",
    actions: [action],
    user: { id: opts.userId ?? "U_TEST", username: "tester", name: "tester", team_id: "T_TEST" },
    team: { id: "T_TEST", domain: "test" },
    token: "test-token",
    response_url: "https://slack.test/respond",
    trigger_id: opts.triggerId ?? "trigger-1",
    api_app_id: "A_TEST",
    container: { type: "message", message_ts: opts.messageTs ?? "1700000000.000100" },
    channel: { id: opts.channelId ?? "C_TEST", name: "general" },
    message: { type: "message", ts: opts.messageTs ?? "1700000000.000100", text: "" },
    is_enterprise_install: false,
    state: { values: {} },
  };

  return {
    payload: action,
    action,
    body,
    ack: vi.fn<BlockActionArgs["ack"]>(),
    respond: vi.fn<BlockActionArgs["respond"]>(),
    say: vi.fn<BlockActionArgs["say"]>(),
    next: vi.fn<BlockActionArgs["next"]>(),
    client: opts.client ?? createSlackClientMock(),
    logger: silentLogger(),
    context: { isEnterpriseInstall: false },
  } satisfies BlockActionArgs;
}

/**
 * A complete set of listener arguments for a view-submission handler, typed as Bolt types them.
 * `values` supplies the block/action state a test cares about; every other Bolt-required field
 * on the view and body gets a plausible literal.
 */
export function createViewSubmitArgs(
  opts: {
    callbackId?: string;
    values?: ViewOutput["state"]["values"];
    privateMetadata?: string;
    userId?: string;
    client?: MockSlackClient;
  } = {},
) {
  const view: ViewOutput = {
    id: "V_TEST",
    callback_id: opts.callbackId ?? "test_view",
    team_id: "T_TEST",
    app_id: "A_TEST",
    bot_id: "B_TEST",
    title: { type: "plain_text", text: "Test" },
    type: "modal",
    blocks: [],
    close: null,
    submit: null,
    state: { values: opts.values ?? {} },
    hash: "test-hash",
    private_metadata: opts.privateMetadata ?? "",
    root_view_id: null,
    previous_view_id: null,
    clear_on_close: false,
    notify_on_close: false,
  };

  const body: ViewSubmitAction = {
    type: "view_submission",
    team: { id: "T_TEST", domain: "test" },
    user: { id: opts.userId ?? "U_TEST", name: "tester", team_id: "T_TEST" },
    view,
    api_app_id: "A_TEST",
    token: "test-token",
    trigger_id: "trigger-1",
    is_enterprise_install: false,
  };

  return {
    payload: view,
    view,
    body,
    ack: vi.fn<ViewSubmitArgs["ack"]>(),
    respond: vi.fn<ViewSubmitArgs["respond"]>(),
    client: opts.client ?? createSlackClientMock(),
    logger: silentLogger(),
    context: { isEnterpriseInstall: false },
    next: vi.fn<ViewSubmitArgs["next"]>(),
  } satisfies ViewSubmitArgs;
}

/** A complete set of listener arguments for an `app_home_opened` event handler. */
export function createAppHomeOpenedArgs(opts: { userId?: string; client?: MockSlackClient } = {}) {
  const event: AppHomeOpenedEvent = {
    type: "app_home_opened",
    user: opts.userId ?? "U_TEST",
    channel: "D_TEST",
    tab: "home",
    event_ts: "1700000000.000100",
  };

  const body: EnvelopedEvent<AppHomeOpenedEvent> = {
    token: "test-token",
    team_id: "T_TEST",
    api_app_id: "A_TEST",
    event,
    type: "event_callback",
    event_id: "Ev_TEST",
    event_time: 1700000000,
  };

  return {
    payload: event,
    event,
    body,
    say: vi.fn<AppHomeOpenedArgs["say"]>(),
    client: opts.client ?? createSlackClientMock(),
    logger: silentLogger(),
    context: { isEnterpriseInstall: false },
    next: vi.fn<AppHomeOpenedArgs["next"]>(),
  } satisfies AppHomeOpenedArgs;
}

/** What a handler passed to `respond(...)`, normalized across its string and object forms. */
export function respondedWith(args: ReturnType<typeof createBlockActionArgs>, index = 0) {
  const arg = args.respond.mock.calls[index]?.[0];
  return typeof arg === "string" ? { text: arg } : arg;
}

function silentLogger(): AllMiddlewareArgs["logger"] {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
    getLevel: vi.fn(),
    setName: vi.fn(),
  };
}
