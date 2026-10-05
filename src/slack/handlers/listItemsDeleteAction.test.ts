import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { BlockAction } from "@slack/bolt";
import type { ChatPostEphemeralArguments } from "@slack/web-api";
import type { StagedListItemsDeleteIntent } from "../../tools/types.js";
import { meetsMinimumRole } from "../../permissions.js";
import { slackErrorCode } from "../../slackErrors.js";
import { stripClickedButton } from "../stripClickedButton.js";
import { t } from "../../i18n/t.js";
import {
  registerListItemsDeleteActionHandler,
  type ListItemsDeleteActionDeps,
} from "./listItemsDeleteAction.js";
import { createBlockActionArgs, createSlackAppMock } from "../testBoltApp.js";

type MockedDeps = {
  [K in keyof ListItemsDeleteActionDeps]: Mock<ListItemsDeleteActionDeps[K]>;
};

const LIST_ID = "F0456ABC";
const THREAD_TS = "1700000000.000001";

const INTENT: StagedListItemsDeleteIntent = {
  type: "list_items_delete",
  listId: LIST_ID,
  items: [
    { id: "Rec1", label: "Buy milk" },
    { id: "Rec2", label: "Buy eggs" },
  ],
};

const SUMMARY_SECTION = { type: "section", text: { type: "mrkdwn", text: "Ready to remove" } };

/** A posted confirmation message, matching what `stripClickedButton` expects. */
function makeConfirmMessage(): NonNullable<BlockAction["message"]> {
  return {
    type: "message",
    ts: "1700000000.000100",
    text: "Remove these items?",
    blocks: [
      SUMMARY_SECTION,
      { type: "divider" },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: "clack_list_items_delete_0",
            text: { type: "plain_text", text: "Delete Items" },
          },
        ],
      },
    ],
  };
}

function makeDeps(): MockedDeps {
  return {
    getRole: vi.fn<ListItemsDeleteActionDeps["getRole"]>(async () => "dev"),
    getConfig: vi.fn<ListItemsDeleteActionDeps["getConfig"]>(() => ({
      lists: { mode: "write" },
    })),
    meetsMinimumRole: vi.fn<ListItemsDeleteActionDeps["meetsMinimumRole"]>(meetsMinimumRole),
    decodeActionValue: vi.fn<ListItemsDeleteActionDeps["decodeActionValue"]>(() => ({
      sessionId: "session-1",
      ref: "r1",
    })),
    restoreSession: vi.fn<ListItemsDeleteActionDeps["restoreSession"]>(async () => ({
      channelId: "C001",
      threadTs: THREAD_TS,
      userId: "U001",
    })),
    getSession: vi.fn<ListItemsDeleteActionDeps["getSession"]>(async () => null),
    getStagedIntent: vi.fn<ListItemsDeleteActionDeps["getStagedIntent"]>(async () => INTENT),
    consumeStagedIntent: vi.fn<ListItemsDeleteActionDeps["consumeStagedIntent"]>(
      async () => INTENT,
    ),
    checkFileAccess: vi.fn<ListItemsDeleteActionDeps["checkFileAccess"]>(async () => ({
      allowed: true,
      botAccess: "write",
      creator: "U001",
    })),
    deleteItems: vi.fn<ListItemsDeleteActionDeps["deleteItems"]>(async () => {}),
    stripClickedButton: vi.fn<ListItemsDeleteActionDeps["stripClickedButton"]>(stripClickedButton),
    slackErrorCode: vi.fn<ListItemsDeleteActionDeps["slackErrorCode"]>(slackErrorCode),
    errorMessage: vi.fn<ListItemsDeleteActionDeps["errorMessage"]>((err) =>
      err instanceof Error ? err.message : String(err),
    ),
  };
}

/** Extract `text` from a `chat.postEphemeral` call, narrowing across its content-shape union. */
function ephemeralText(call: ChatPostEphemeralArguments): string | undefined {
  return "text" in call ? call.text : undefined;
}

describe("registerListItemsDeleteActionHandler", () => {
  let deps: MockedDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  /** Register on a fresh mocked app, click the button, and return the listener arguments. */
  async function click() {
    const app = createSlackAppMock();
    registerListItemsDeleteActionHandler(app, deps);
    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({
      value: "encoded-value",
      actionId: "clack_list_items_delete_0",
      userId: "U001",
      channelId: "C001",
    });
    args.body.message = makeConfirmMessage();
    await handler(args);
    return args;
  }

  function ephemerals(args: Awaited<ReturnType<typeof click>>): ChatPostEphemeralArguments[] {
    return args.client.chat.postEphemeral.mock.calls.map((call) => call[0]);
  }

  it("registers one action handler on the confirm-button pattern", () => {
    const app = createSlackAppMock();
    registerListItemsDeleteActionHandler(app, deps);

    expect(app.action).toHaveBeenCalledTimes(1);
    const [pattern] = app.action.mock.calls[0];
    expect(pattern).toBeInstanceOf(RegExp);
    if (!(pattern instanceof RegExp)) return;
    expect(pattern.test("clack_list_items_delete_42")).toBe(true);
    expect(pattern.test("clack_list_items_delete")).toBe(false);
    expect(pattern.test("clack_config_update_42")).toBe(false);
  });

  it("removes the staged items, strips the button and confirms to the clicker", async () => {
    const args = await click();

    expect(args.ack).toHaveBeenCalledTimes(1);
    expect(deps.getStagedIntent).toHaveBeenCalledWith("session-1", "r1");
    expect(deps.deleteItems).toHaveBeenCalledTimes(1);
    expect(deps.deleteItems).toHaveBeenCalledWith(args.client, LIST_ID, ["Rec1", "Rec2"]);
    expect(args.respond).toHaveBeenCalledWith({
      replace_original: true,
      text: "Remove these items?",
      blocks: [SUMMARY_SECTION],
    });
    const [notice] = ephemerals(args);
    expect(ephemerals(args)).toHaveLength(1);
    expect(notice.channel).toBe("C001");
    expect(notice.user).toBe("U001");
    expect(notice.thread_ts).toBe(THREAD_TS);
    expect(ephemeralText(notice)).toBe(
      t("errors.list_items_deleted", { count: 2, items: "Buy milk, Buy eggs" }),
    );
  });

  it("checks the clicker's own access to the List", async () => {
    const args = await click();

    expect(deps.getSession).toHaveBeenCalledWith("session-1");
    expect(deps.checkFileAccess).toHaveBeenCalledWith(
      { client: args.client, userId: "U001", role: "dev", session: undefined },
      LIST_ID,
    );
  });

  it("never lends the requester's session grants to another clicker", async () => {
    deps.restoreSession.mockResolvedValue({
      channelId: "C001",
      threadTs: THREAD_TS,
      userId: "U999",
    });

    const args = await click();

    expect(deps.getSession).not.toHaveBeenCalled();
    expect(deps.checkFileAccess).toHaveBeenCalledWith(
      { client: args.client, userId: "U001", role: "dev", session: undefined },
      LIST_ID,
    );
  });

  it("refuses a clicker below the write role and keeps the button", async () => {
    deps.getRole.mockResolvedValue("member");

    const args = await click();

    expect(deps.deleteItems).not.toHaveBeenCalled();
    expect(args.respond).not.toHaveBeenCalled();
    expect(ephemerals(args).map(ephemeralText)).toEqual([
      t("errors.list_delete_permission_denied", { role: "dev" }),
    ]);
  });

  it("applies the configured write role", async () => {
    deps.getConfig.mockReturnValue({ lists: { mode: "write", writeRole: "admin" } });

    const args = await click();

    expect(deps.deleteItems).not.toHaveBeenCalled();
    expect(ephemerals(args).map(ephemeralText)).toEqual([
      t("errors.list_delete_permission_denied", { role: "admin" }),
    ]);
  });

  it("does not throw when the outcome notice cannot be posted after the deletion", async () => {
    const app = createSlackAppMock();
    registerListItemsDeleteActionHandler(app, deps);
    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({
      value: "encoded-value",
      actionId: "clack_list_items_delete_0",
      userId: "U001",
      channelId: "C001",
    });
    args.body.message = makeConfirmMessage();
    args.client.chat.postEphemeral.mockRejectedValue(new Error("ratelimited"));

    await expect(handler(args)).resolves.toBeUndefined();
    expect(deps.deleteItems).toHaveBeenCalledWith(args.client, LIST_ID, ["Rec1", "Rec2"]);
  });

  it("does nothing beyond the ack when the click carries no button value", async () => {
    const app = createSlackAppMock();
    registerListItemsDeleteActionHandler(app, deps);
    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({ value: "", actionId: "clack_list_items_delete_0" });

    await handler(args);

    expect(args.ack).toHaveBeenCalledTimes(1);
    expect(deps.decodeActionValue).not.toHaveBeenCalled();
    expect(deps.getRole).not.toHaveBeenCalled();
    expect(deps.deleteItems).not.toHaveBeenCalled();
  });

  it("removes nothing when a concurrent click already claimed the deletion", async () => {
    deps.consumeStagedIntent.mockResolvedValue(null);

    const args = await click();

    expect(deps.consumeStagedIntent).toHaveBeenCalledWith("session-1", "r1");
    expect(deps.deleteItems).not.toHaveBeenCalled();
    expect(args.respond).not.toHaveBeenCalled();
    expect(ephemerals(args).map(ephemeralText)).toEqual([t("errors.list_delete_request_expired")]);
  });

  it("refuses a clicker without access to the List and keeps the button", async () => {
    deps.checkFileAccess.mockResolvedValue({ allowed: false, reason: "no_evidence" });

    const args = await click();

    expect(deps.consumeStagedIntent).not.toHaveBeenCalled();
    expect(deps.deleteItems).not.toHaveBeenCalled();
    expect(args.respond).not.toHaveBeenCalled();
    expect(ephemerals(args).map(ephemeralText)).toEqual([t("errors.list_delete_access_denied")]);
    expect(ephemerals(args)[0].thread_ts).toBe(THREAD_TS);
  });

  it.each([
    { title: "read", lists: { mode: "read" as const } },
    { title: "off", lists: { mode: "off" as const } },
    { title: "absent", lists: undefined },
  ])("removes nothing when the lists mode is $title", async ({ lists }) => {
    deps.getConfig.mockReturnValue({ lists });

    const args = await click();

    expect(deps.deleteItems).not.toHaveBeenCalled();
    expect(deps.getStagedIntent).not.toHaveBeenCalled();
    expect(args.respond).not.toHaveBeenCalled();
    expect(ephemerals(args).map(ephemeralText)).toEqual([t("errors.list_delete_unavailable")]);
  });

  it("tells the clicker the request expired when the intent is gone", async () => {
    deps.getStagedIntent.mockResolvedValue(null);

    const args = await click();

    expect(deps.deleteItems).not.toHaveBeenCalled();
    expect(deps.checkFileAccess).not.toHaveBeenCalled();
    expect(ephemerals(args).map(ephemeralText)).toEqual([t("errors.list_delete_request_expired")]);
  });

  it("tells the clicker the request expired when the ref is another intent type", async () => {
    deps.getStagedIntent.mockResolvedValue({
      type: "config_update",
      operation: "write",
      file: "instructions.md",
      content: "x",
    });

    const args = await click();

    expect(deps.deleteItems).not.toHaveBeenCalled();
    expect(ephemerals(args).map(ephemeralText)).toEqual([t("errors.list_delete_request_expired")]);
  });

  it("reports a Slack failure by its error code without rethrowing", async () => {
    deps.deleteItems.mockRejectedValue(
      Object.assign(new Error("An API error occurred"), { data: { error: "item_not_found" } }),
    );

    const args = await click();

    expect(ephemerals(args).map(ephemeralText)).toEqual([
      t("errors.list_delete_failed", { error: "item_not_found" }),
    ]);
  });

  it("reports a non-Slack failure by its message without rethrowing", async () => {
    deps.deleteItems.mockRejectedValue(new Error("network down"));

    const args = await click();

    expect(ephemerals(args).map(ephemeralText)).toEqual([
      t("errors.list_delete_failed", { error: "network down" }),
    ]);
  });

  it("does nothing beyond the ack when the ref is missing", async () => {
    deps.decodeActionValue.mockReturnValue({ sessionId: "session-1" });

    const args = await click();

    expect(args.ack).toHaveBeenCalledTimes(1);
    expect(deps.restoreSession).not.toHaveBeenCalled();
    expect(deps.deleteItems).not.toHaveBeenCalled();
    expect(ephemerals(args)).toEqual([]);
  });

  it("removes nothing when the session cannot be restored", async () => {
    deps.restoreSession.mockResolvedValue(undefined);

    const args = await click();

    expect(deps.getStagedIntent).not.toHaveBeenCalled();
    expect(deps.deleteItems).not.toHaveBeenCalled();
    expect(args.respond).not.toHaveBeenCalled();
    expect(ephemerals(args)).toEqual([]);
  });
});
