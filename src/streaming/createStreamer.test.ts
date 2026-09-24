import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig, type Config } from "../config.js";
import { createSlackClientMock } from "../slack/testSlackClient.js";
import { stub } from "../testStubs.js";
import { createConfiguredStreamer } from "./createStreamer.js";
import { SlackStreamer, type SlackStreamerOptions } from "./slackStreamer.js";

vi.mock("../config.js");
vi.mock("./slackStreamer.js");

describe("createConfiguredStreamer", () => {
  let opts: SlackStreamerOptions;

  beforeEach(() => {
    opts = {
      client: createSlackClientMock(),
      channel: "C1",
      threadTs: "1.1",
      thinkingTitle: "Working",
    };
  });

  it("passes the configured task-card transport alongside the given options", () => {
    vi.mocked(getConfig).mockReturnValue(
      stub<Config>({ streaming: { taskCardTransport: "streamThenUpdate" } }),
    );

    const streamer = createConfiguredStreamer(opts);

    expect(SlackStreamer).toHaveBeenCalledWith({
      ...opts,
      taskCardTransport: "streamThenUpdate",
    });
    expect(streamer).toBe(vi.mocked(SlackStreamer).mock.instances[0]);
  });

  it("defaults to the stream transport when streaming config is absent", () => {
    vi.mocked(getConfig).mockReturnValue(stub<Config>({}));

    createConfiguredStreamer(opts);

    expect(SlackStreamer).toHaveBeenCalledWith({ ...opts, taskCardTransport: "stream" });
  });
});
