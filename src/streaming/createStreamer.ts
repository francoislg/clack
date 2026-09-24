import { getConfig } from "../config.js";
import { SlackStreamer, type SlackStreamerOptions } from "./slackStreamer.js";

/** Builds a `SlackStreamer` with the configured task-card transport. */
export function createConfiguredStreamer(opts: SlackStreamerOptions): SlackStreamer {
  return new SlackStreamer({
    ...opts,
    taskCardTransport: getConfig().streaming?.taskCardTransport ?? "stream",
  });
}
