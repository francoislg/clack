import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import type { Block, KnownBlock, PlanBlock, TaskCardBlock } from "@slack/types";
import { SlackStreamer, type SlackStreamerLogger } from "./slackStreamer.js";
import {
  makeClient,
  makeMockChatStreamer,
  makeSlackError,
  type MockChatStreamer,
} from "./slackStreamerTestHelpers.js";
import type { MockSlackClient } from "../slack/testSlackClient.js";
import type { TaskCardTransport } from "../config.js";

const HANDOVER_MS = 270_000;
const TS = "111.222";

type UpdateArgs = NonNullable<Parameters<MockSlackClient["chat"]["update"]>[0]>;

let logger: {
  warn: Mock<SlackStreamerLogger["warn"]>;
  error: Mock<SlackStreamerLogger["error"]>;
};

beforeEach(() => {
  vi.useFakeTimers();
  logger = { warn: vi.fn(), error: vi.fn() };
});

afterEach(() => {
  vi.useRealTimers();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function setup(opts?: { transport?: TaskCardTransport; deferUntilFirstTask?: boolean }): {
  streamer: SlackStreamer;
  chatStreamer: MockChatStreamer;
  client: MockSlackClient;
} {
  const chatStreamer = makeMockChatStreamer();
  chatStreamer.append.mockResolvedValue({ ok: true, ts: TS });
  const client = makeClient({ chatStreamer });
  const streamer = new SlackStreamer({
    client,
    channel: "C_CHAN",
    threadTs: "1234.5678",
    teamId: "T_TEAM",
    logger,
    deferUntilFirstTask: opts?.deferUntilFirstTask,
    taskCardTransport: opts?.transport ?? "streamThenUpdate",
  });
  return { streamer, chatStreamer, client };
}

function updateArgs(client: MockSlackClient, index: number): UpdateArgs {
  const args = client.chat.update.mock.calls.at(index)?.[0];
  if (!args) throw new Error(`no chat.update call at ${index}`);
  return args;
}

function blocksOf(args: UpdateArgs): (KnownBlock | Block)[] {
  return "blocks" in args ? (args.blocks ?? []) : [];
}

function isPlan(block: KnownBlock | Block | undefined): block is PlanBlock {
  return block?.type === "plan";
}

type PlanTask = NonNullable<PlanBlock["tasks"]>[number];

function isTaskCard(task: PlanTask): task is TaskCardBlock {
  return task.type === "task_card";
}

function planOf(args: UpdateArgs): PlanBlock & { tasks: TaskCardBlock[] } {
  const plan = blocksOf(args)[0];
  if (!isPlan(plan)) throw new Error("first block is not a plan");
  return { ...plan, tasks: (plan.tasks ?? []).filter(isTaskCard) };
}

function startTool(streamer: SlackStreamer, taskId: string): void {
  streamer.handleEvent({
    type: "tool_start",
    taskId,
    toolName: "mcp__clack__list_repositories",
    toolArgs: {},
  });
}

describe("SlackStreamer taskCardTransport", () => {
  it("default transport never stops the stream or updates the message", async () => {
    const { streamer, chatStreamer, client } = setup({ transport: "stream" });
    await streamer.start();
    startTool(streamer, "task-a");

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(chatStreamer.stop).not.toHaveBeenCalled();
    expect(client.chat.update).not.toHaveBeenCalled();
    await streamer.stop();
  });

  it("streams until the handover, then seals the stream and renders the card", async () => {
    const { streamer, chatStreamer, client } = setup();
    await streamer.start();
    startTool(streamer, "task-a");

    await vi.advanceTimersByTimeAsync(HANDOVER_MS - 1);
    expect(chatStreamer.stop).not.toHaveBeenCalled();
    expect(client.chat.update).not.toHaveBeenCalled();
    expect(chatStreamer.append).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(chatStreamer.stop).toHaveBeenCalledTimes(1);
    expect(chatStreamer.stop).toHaveBeenCalledWith();
    const args = updateArgs(client, 0);
    expect(args).toMatchObject({ channel: "C_CHAN", ts: TS });
    const plan = planOf(args);
    expect(plan.tasks.map((task) => task.task_id)).toEqual(["__thinking__", "task-a"]);
    expect(plan.tasks[1].status).toBe("in_progress");
  });

  it("routes tool events to chat.update after the handover", async () => {
    const { streamer, chatStreamer, client } = setup();
    await streamer.start();
    await vi.advanceTimersByTimeAsync(HANDOVER_MS);
    const appendsAtHandover = chatStreamer.append.mock.calls.length;
    const updatesAtHandover = client.chat.update.mock.calls.length;

    startTool(streamer, "task-a");
    await flush();
    streamer.handleEvent({ type: "tool_end", taskId: "task-a" });
    await flush();

    expect(chatStreamer.append.mock.calls.length).toBe(appendsAtHandover);
    expect(client.chat.update.mock.calls.length).toBe(updatesAtHandover + 2);
    const task = planOf(updateArgs(client, -1)).tasks.find((t) => t.task_id === "task-a");
    expect(task?.status).toBe("complete");
  });

  it("keepalive ticks after the handover update the elapsed-decorated title", async () => {
    const { streamer, client } = setup();
    await streamer.start();
    startTool(streamer, "task-a");
    await vi.advanceTimersByTimeAsync(HANDOVER_MS);
    const updatesAtHandover = client.chat.update.mock.calls.length;

    await vi.advanceTimersByTimeAsync(15_000);

    expect(client.chat.update.mock.calls.length).toBe(updatesAtHandover + 1);
    const task = planOf(updateArgs(client, -1)).tasks.find((t) => t.task_id === "task-a");
    expect(task?.title).toMatch(/⏱ 4m 45s$/);
  });

  it("stop({ blocks }) after the handover finalizes with the card and the answer", async () => {
    const { streamer, client } = setup();
    await streamer.start();
    await vi.advanceTimersByTimeAsync(HANDOVER_MS);

    const answer: KnownBlock = { type: "section", text: { type: "mrkdwn", text: "Answer" } };
    await streamer.stop({ blocks: [answer] });

    const args = updateArgs(client, -1);
    expect(args.ts).toBe(TS);
    expect(blocksOf(args).slice(1)).toEqual([answer]);
    const thinking = planOf(args).tasks[0];
    expect(thinking).toMatchObject({ task_id: "__thinking__", status: "complete" });
    expect(streamer.hasFailed).toBe(false);
    expect(streamer.getMessageTs()).toBe(TS);
    expect(streamer.getAllMessageTss()).toEqual([TS]);
  });

  it("an idle keepalive tick after the handover makes no chat.update", async () => {
    const { streamer, client } = setup();
    await streamer.start();
    await vi.advanceTimersByTimeAsync(HANDOVER_MS);
    const updatesAtHandover = client.chat.update.mock.calls.length;

    await vi.advanceTimersByTimeAsync(60_000);

    expect(client.chat.update.mock.calls.length).toBe(updatesAtHandover);
    await streamer.stop();
  });

  it("stop() after the handover force-completes in-flight tasks in one final update", async () => {
    const { streamer, client } = setup();
    await streamer.start();
    startTool(streamer, "task-a");
    await vi.advanceTimersByTimeAsync(HANDOVER_MS);
    const updatesAtHandover = client.chat.update.mock.calls.length;

    await streamer.stop();

    expect(client.chat.update.mock.calls.length).toBe(updatesAtHandover + 1);
    const task = planOf(updateArgs(client, -1)).tasks.find((t) => t.task_id === "task-a");
    expect(task?.status).toBe("complete");
  });

  it("hands over instead of rolling over when a recoverable append fails", async () => {
    const { streamer, chatStreamer, client } = setup();
    await streamer.start();
    chatStreamer.append.mockRejectedValueOnce(makeSlackError("message_not_in_streaming_state"));

    startTool(streamer, "task-a");
    await flush();

    expect(client.chatStream).toHaveBeenCalledTimes(1);
    expect(chatStreamer.stop).not.toHaveBeenCalled();
    const plan = planOf(updateArgs(client, -1));
    expect(plan.tasks.map((task) => task.task_id)).toEqual(["__thinking__", "task-a"]);
    expect(streamer.hasFailed).toBe(false);
  });

  it("fails when chat.update rejects", async () => {
    const { streamer, client } = setup();
    client.chat.update.mockRejectedValue(new Error("boom"));
    await streamer.start();

    await vi.advanceTimersByTimeAsync(HANDOVER_MS);

    expect(streamer.hasFailed).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to update task card:",
      expect.any(Error),
      expect.objectContaining({ delivery: "update" }),
    );
  });

  it("with deferUntilFirstTask, hands over 270s after the card commits", async () => {
    const { streamer, chatStreamer, client } = setup({ deferUntilFirstTask: true });
    await streamer.start();

    await vi.advanceTimersByTimeAsync(HANDOVER_MS + 30_000);
    expect(chatStreamer.stop).not.toHaveBeenCalled();
    expect(client.chat.update).not.toHaveBeenCalled();

    startTool(streamer, "task-a");
    await vi.advanceTimersByTimeAsync(HANDOVER_MS - 1);
    expect(chatStreamer.stop).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(chatStreamer.stop).toHaveBeenCalledTimes(1);
    expect(updateArgs(client, 0).ts).toBe(TS);
  });

  it("stop() racing an in-flight handover ends in one final update and no append", async () => {
    const { streamer, chatStreamer, client } = setup();
    let releaseStop: () => void = () => {};
    chatStreamer.stop.mockReturnValue(
      new Promise((resolve) => {
        releaseStop = () => resolve({ ok: true });
      }),
    );
    await streamer.start();
    await vi.advanceTimersByTimeAsync(HANDOVER_MS);
    expect(chatStreamer.stop).toHaveBeenCalledTimes(1);
    const appendsBeforeStop = chatStreamer.append.mock.calls.length;

    const answer: KnownBlock = { type: "section", text: { type: "mrkdwn", text: "Answer" } };
    const stopping = streamer.stop({ blocks: [answer] });
    releaseStop();
    await stopping;

    expect(chatStreamer.append.mock.calls.length).toBe(appendsBeforeStop);
    expect(chatStreamer.stop).toHaveBeenCalledTimes(1);
    const finals = client.chat.update.mock.calls.filter(([args]) => blocksOf(args).length > 1);
    expect(finals).toHaveLength(1);
    expect(blocksOf(updateArgs(client, -1)).slice(1)).toEqual([answer]);
    expect(streamer.hasFailed).toBe(false);
  });

  it("rolls over when the first append fails before the message ts is known", async () => {
    const { streamer, chatStreamer, client } = setup();
    chatStreamer.append.mockRejectedValueOnce(makeSlackError("message_not_in_streaming_state"));

    await streamer.start();

    expect(client.chatStream).toHaveBeenCalledTimes(2);
    expect(chatStreamer.stop).not.toHaveBeenCalled();
    expect(client.chat.update).not.toHaveBeenCalled();
    expect(streamer.hasFailed).toBe(false);
  });

  it("a stale-generation failure replays onto the rolled-over stream instead of handing over", async () => {
    const { streamer, chatStreamer, client } = setup();
    let rejectA: (error: Error) => void = () => {};
    let rejectB: (error: Error) => void = () => {};
    chatStreamer.append
      .mockResolvedValueOnce(null)
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectA = reject;
        }),
      )
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectB = reject;
        }),
      );
    await streamer.start();
    expect(streamer.getMessageTs()).toBeUndefined();

    startTool(streamer, "task-a");
    startTool(streamer, "task-b");
    rejectA(makeSlackError("message_not_in_streaming_state"));
    await flush();
    expect(client.chatStream).toHaveBeenCalledTimes(2);
    expect(streamer.getMessageTs()).toBe(TS);
    const appendsBeforeB = chatStreamer.append.mock.calls.length;

    rejectB(makeSlackError("message_not_in_streaming_state"));
    await flush();

    expect(client.chatStream).toHaveBeenCalledTimes(2);
    expect(client.chat.update).not.toHaveBeenCalled();
    expect(chatStreamer.stop).not.toHaveBeenCalled();
    const replayed = chatStreamer.append.mock.calls.slice(appendsBeforeB);
    expect(replayed).toHaveLength(1);
    expect(replayed[0][0].chunks?.map((c) => ("id" in c ? c.id : undefined))).toContain("task-b");
    expect(streamer.hasFailed).toBe(false);
  });

  it("an append landing while the handover's update is pending gets a follow-up update", async () => {
    const { streamer, client } = setup();
    let releaseUpdate: () => void = () => {};
    client.chat.update.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseUpdate = () => resolve({ ok: true });
      }),
    );
    await streamer.start();
    startTool(streamer, "task-a");
    await vi.advanceTimersByTimeAsync(HANDOVER_MS);
    expect(client.chat.update).toHaveBeenCalledTimes(1);

    streamer.handleEvent({ type: "tool_end", taskId: "task-a" });
    releaseUpdate();
    await flush();

    expect(client.chat.update).toHaveBeenCalledTimes(2);
    const task = planOf(updateArgs(client, 1)).tasks.find((t) => t.task_id === "task-a");
    expect(task?.status).toBe("complete");
  });

  it("logs a rejected stream stop before the handover and still updates the card", async () => {
    const { streamer, chatStreamer, client } = setup();
    const error = new Error("already sealed");
    chatStreamer.stop.mockRejectedValue(error);
    await streamer.start();

    await vi.advanceTimersByTimeAsync(HANDOVER_MS);

    expect(logger.warn).toHaveBeenCalledWith(
      "Chat stream stop before handover failed (likely already sealed):",
      error,
      expect.objectContaining({ delivery: "update" }),
    );
    expect(client.chat.update).toHaveBeenCalledTimes(1);
    expect(streamer.hasFailed).toBe(false);
  });

  it("stop() before the handover seals the stream once and cancels the handover timer", async () => {
    const { streamer, chatStreamer, client } = setup();
    await streamer.start();
    startTool(streamer, "task-a");
    await vi.advanceTimersByTimeAsync(HANDOVER_MS - 30_000);

    await streamer.stop();
    expect(chatStreamer.stop).toHaveBeenCalledTimes(1);
    expect(client.chat.update).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(HANDOVER_MS);
    expect(chatStreamer.stop).toHaveBeenCalledTimes(1);
    expect(client.chat.update).not.toHaveBeenCalled();
  });

  it("fails when the final chat.update after a handover rejects", async () => {
    const { streamer, client } = setup();
    await streamer.start();
    await vi.advanceTimersByTimeAsync(HANDOVER_MS);
    expect(streamer.hasFailed).toBe(false);
    client.chat.update.mockRejectedValueOnce(new Error("boom"));

    const answer: KnownBlock = { type: "section", text: { type: "mrkdwn", text: "Answer" } };
    await streamer.stop({ blocks: [answer] });

    expect(streamer.hasFailed).toBe(true);
  });

  it("an in-flight append failing after the handover flushes instead of handing over again", async () => {
    const { streamer, chatStreamer, client } = setup();
    await streamer.start();
    let rejectAppend: (error: Error) => void = () => {};
    chatStreamer.append.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectAppend = reject;
      }),
    );
    startTool(streamer, "task-a");

    await vi.advanceTimersByTimeAsync(HANDOVER_MS);
    expect(chatStreamer.stop).toHaveBeenCalledTimes(1);
    const updatesAtHandover = client.chat.update.mock.calls.length;
    expect(updatesAtHandover).toBeGreaterThan(0);

    rejectAppend(makeSlackError("message_not_in_streaming_state"));
    await flush();

    expect(chatStreamer.stop).toHaveBeenCalledTimes(1);
    expect(client.chat.update.mock.calls.length).toBe(updatesAtHandover + 1);
    expect(updateArgs(client, -1).ts).toBe(TS);
    expect(streamer.hasFailed).toBe(false);
  });

  it("fails the handover when the stream never reported a message ts", async () => {
    const { streamer, chatStreamer, client } = setup();
    chatStreamer.append.mockResolvedValue({ ok: true });
    await streamer.start();

    await vi.advanceTimersByTimeAsync(HANDOVER_MS);

    expect(streamer.hasFailed).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      "Task card handover has no message ts",
      expect.any(Object),
    );
    expect(client.chat.update).not.toHaveBeenCalled();
  });

  it("the handover waits for an in-flight rollover and targets the rolled-over message", async () => {
    const { streamer, chatStreamer, client } = setup();
    let resolveContinuation: () => void = () => {};
    chatStreamer.append
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(makeSlackError("message_not_in_streaming_state"))
      .mockResolvedValueOnce({ ok: true })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveContinuation = () => resolve({ ok: true, ts: "999.000" });
        }),
      );
    await streamer.start();
    expect(streamer.getMessageTs()).toBeUndefined();

    startTool(streamer, "task-a");
    await flush();
    expect(client.chatStream).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(HANDOVER_MS);
    expect(client.chat.update).not.toHaveBeenCalled();

    resolveContinuation();
    await flush();

    expect(streamer.hasFailed).toBe(false);
    expect(updateArgs(client, 0).ts).toBe("999.000");
  });
});
