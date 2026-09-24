import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import type { KnownBlock, PlanBlock, TaskCardBlock } from "@slack/types";
import { CardUpdater } from "./cardUpdater.js";
import type { SlackStreamerLogger } from "./slackStreamer.js";
import { TaskCardProjection } from "./taskCardProjection.js";
import { notificationText } from "../slack/messagePoster.js";
import { createSlackClientMock, type MockSlackClient } from "../slack/testSlackClient.js";

vi.mock("../slack/messagePoster.js", () => ({ notificationText: vi.fn() }));

const TS = "111.222";
const PLAN: PlanBlock & { tasks: TaskCardBlock[] } = { type: "plan", title: "Progress", tasks: [] };

type UpdateResult = Awaited<ReturnType<MockSlackClient["chat"]["update"]>>;

let client: MockSlackClient;
let logger: { warn: Mock<SlackStreamerLogger["warn"]>; error: Mock<SlackStreamerLogger["error"]> };
let diagnostics: Mock<() => object>;
let toPlanBlock: Mock<TaskCardProjection["toPlanBlock"]>;

beforeEach(() => {
  client = createSlackClientMock();
  client.chat.update.mockResolvedValue({ ok: true });
  logger = { warn: vi.fn(), error: vi.fn() };
  diagnostics = vi.fn(() => ({ delivery: "update" }));
  toPlanBlock = vi.spyOn(TaskCardProjection.prototype, "toPlanBlock").mockReturnValue(PLAN);
  vi.mocked(notificationText).mockReturnValue("");
});

function makeUpdater(): CardUpdater {
  const updater = new CardUpdater({ client, channel: "C_CHAN", logger, diagnostics });
  updater.attach(TS);
  return updater;
}

function deferred(): { promise: Promise<UpdateResult>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<UpdateResult>((r) => {
    resolve = () => r({ ok: true });
  });
  return { promise, resolve };
}

describe("CardUpdater", () => {
  it("apply passes chunks through to the projection", () => {
    const apply = vi.spyOn(TaskCardProjection.prototype, "apply");
    const updater = makeUpdater();
    const chunks = [
      { type: "task_update" as const, id: "a", title: "A", status: "in_progress" as const },
    ];

    updater.apply(chunks);

    expect(apply).toHaveBeenCalledWith(chunks);
  });

  it("flush renders the plan block titled with the plan title", async () => {
    const updater = makeUpdater();

    await expect(updater.flush()).resolves.toBe(true);

    expect(toPlanBlock).toHaveBeenCalledWith("Progress");
    expect(client.chat.update).toHaveBeenCalledWith({
      channel: "C_CHAN",
      ts: TS,
      text: "Progress",
      blocks: [PLAN],
    });
  });

  it("coalesces flushes during an in-flight update into one follow-up", async () => {
    const first = deferred();
    client.chat.update.mockReturnValueOnce(first.promise);
    const updater = makeUpdater();

    const a = updater.flush();
    const b = updater.flush();
    const c = updater.flush();
    expect(b).toBe(a);
    expect(c).toBe(a);
    first.resolve();
    await a;

    expect(client.chat.update).toHaveBeenCalledTimes(2);
  });

  it("markDirty during an in-flight update adds one follow-up iteration", async () => {
    const first = deferred();
    client.chat.update.mockReturnValueOnce(first.promise);
    const updater = makeUpdater();

    const flushing = updater.flush();
    updater.markDirty();
    first.resolve();
    await flushing;

    expect(client.chat.update).toHaveBeenCalledTimes(2);
  });

  it("whenIdle waits for the in-flight update", async () => {
    const first = deferred();
    client.chat.update.mockReturnValueOnce(first.promise);
    const updater = makeUpdater();
    const idle = vi.fn();

    const flushing = updater.flush();
    const waiting = updater.whenIdle().then(idle);
    await Promise.resolve();
    expect(idle).not.toHaveBeenCalled();
    first.resolve();
    await Promise.all([flushing, waiting]);

    expect(idle).toHaveBeenCalledTimes(1);
  });

  it("a failed update logs, resolves false, and makes further flushes no-ops", async () => {
    const error = new Error("boom");
    client.chat.update.mockRejectedValueOnce(error);
    const updater = makeUpdater();

    await expect(updater.flush()).resolves.toBe(false);
    await expect(updater.flush()).resolves.toBe(false);
    await expect(updater.finalize()).resolves.toBe(false);

    expect(client.chat.update).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("Failed to update task card:", error, {
      delivery: "update",
    });
  });

  it("finalize with markdownText adds a markdown block and uses it as text", async () => {
    const updater = makeUpdater();

    await expect(updater.finalize({ markdownText: "Done." })).resolves.toBe(true);

    expect(client.chat.update).toHaveBeenCalledWith({
      channel: "C_CHAN",
      ts: TS,
      text: "Done.",
      blocks: [PLAN, { type: "markdown", text: "Done." }],
    });
  });

  it("finalize with blocks uses the answer's notification text", async () => {
    const answer: KnownBlock = { type: "section", text: { type: "mrkdwn", text: "Answer" } };
    vi.mocked(notificationText).mockReturnValue("Answer");
    const updater = makeUpdater();

    await updater.finalize({ blocks: [answer] });

    expect(notificationText).toHaveBeenCalledWith([answer]);
    expect(client.chat.update).toHaveBeenCalledWith({
      channel: "C_CHAN",
      ts: TS,
      text: "Answer",
      blocks: [PLAN, answer],
    });
  });

  it("finalize with no opts falls back to the plan title", async () => {
    const updater = makeUpdater();

    await updater.finalize();

    expect(client.chat.update).toHaveBeenCalledWith({
      channel: "C_CHAN",
      ts: TS,
      text: "Progress",
      blocks: [PLAN],
    });
  });

  it("finalize waits for the in-flight update", async () => {
    const first = deferred();
    client.chat.update.mockReturnValueOnce(first.promise);
    const updater = makeUpdater();

    const flushing = updater.flush();
    const finalizing = updater.finalize({ markdownText: "Done." });
    await Promise.resolve();
    expect(client.chat.update).toHaveBeenCalledTimes(1);
    first.resolve();
    await Promise.all([flushing, finalizing]);

    expect(client.chat.update).toHaveBeenCalledTimes(2);
    expect(client.chat.update.mock.calls.at(-1)?.[0]).toMatchObject({ text: "Done." });
  });

  it("the coalesced follow-up update carries the latest projection", async () => {
    const v1: PlanBlock & { tasks: TaskCardBlock[] } = { ...PLAN, title: "v1" };
    const v2: PlanBlock & { tasks: TaskCardBlock[] } = { ...PLAN, title: "v2" };
    toPlanBlock.mockReturnValueOnce(v1).mockReturnValueOnce(v2);
    const first = deferred();
    client.chat.update.mockReturnValueOnce(first.promise);
    const updater = makeUpdater();

    const flushing = updater.flush();
    updater.flush();
    first.resolve();
    await flushing;

    expect(client.chat.update).toHaveBeenCalledTimes(2);
    expect(client.chat.update.mock.calls[0]?.[0]).toMatchObject({ blocks: [v1] });
    expect(client.chat.update.mock.calls[1]?.[0]).toMatchObject({ blocks: [v2] });
  });

  it("flush and finalize before attach make no update and resolve true", async () => {
    const updater = new CardUpdater({ client, channel: "C_CHAN", logger, diagnostics });

    await expect(updater.flush()).resolves.toBe(true);
    await expect(updater.finalize({ markdownText: "Done." })).resolves.toBe(true);

    expect(client.chat.update).not.toHaveBeenCalled();
  });

  it("finalize with markdownText and blocks renders both, texted by the markdown", async () => {
    const answer: KnownBlock = { type: "section", text: { type: "mrkdwn", text: "Answer" } };
    vi.mocked(notificationText).mockReturnValue("Answer");
    const updater = makeUpdater();

    await updater.finalize({ markdownText: "Done.", blocks: [answer] });

    expect(client.chat.update).toHaveBeenCalledWith({
      channel: "C_CHAN",
      ts: TS,
      text: "Done.",
      blocks: [PLAN, { type: "markdown", text: "Done." }, answer],
    });
  });
});
