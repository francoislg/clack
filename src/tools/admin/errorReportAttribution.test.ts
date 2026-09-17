import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resolveErrorReportAttribution,
  type ErrorReportAttributionDeps,
} from "./errorReportAttribution.js";

const SESSION_ID = "C0EXAMPLE01-1768338604-542809-U0EXAMPLE01-1768400009272";
const DM_SESSION_ID = "D0EXAMPLE01-1778075069-394819-U0EXAMPLE03-1778075133040";

function createDeps(overrides: Partial<ErrorReportAttributionDeps> = {}) {
  const deps: ErrorReportAttributionDeps = {
    fileExists: vi.fn(async () => false),
    readFile: vi.fn(async () => "{}"),
    getSessionsDir: vi.fn(() => "/data/sessions"),
    getChannelName: vi.fn(async () => undefined),
    getDisplayName: vi.fn(async () => undefined),
    getPermalink: vi.fn(async () => undefined),
    ...overrides,
  };
  return deps;
}

function withSessionFile(context: unknown, overrides: Partial<ErrorReportAttributionDeps> = {}) {
  return createDeps({
    fileExists: vi.fn(async () => true),
    readFile: vi.fn(async () => JSON.stringify(context)),
    ...overrides,
  });
}

describe("resolveErrorReportAttribution", () => {
  let permalink: ErrorReportAttributionDeps["getPermalink"];

  beforeEach(() => {
    permalink = vi.fn(async () => "https://acme.slack.com/archives/C0EXAMPLE01/p1768338604542809");
  });

  it("reports the channel, author, and message link from the persisted session", async () => {
    const deps = withSessionFile(
      {
        channelId: "C0EXAMPLE01",
        channelName: "support",
        userId: "U0EXAMPLE01",
        displayName: "Jane Doe",
        trigger: { type: "mentions", messageTs: "1768338604.542809" },
      },
      { getPermalink: permalink },
    );

    const result = await resolveErrorReportAttribution(SESSION_ID, deps);

    expect(result).toEqual({
      channelId: "C0EXAMPLE01",
      channelName: "support",
      userId: "U0EXAMPLE01",
      displayName: "Jane Doe",
      triggerType: "mentions",
      messageLink: "https://acme.slack.com/archives/C0EXAMPLE01/p1768338604542809",
    });
    expect(permalink).toHaveBeenCalledWith("C0EXAMPLE01", "1768338604.542809");
  });

  it("resolves names through Slack when the session omits them", async () => {
    const getChannelName = vi.fn(async () => "support");
    const getDisplayName = vi.fn(async () => "Jane Doe");
    const deps = withSessionFile(
      { channelId: "C0EXAMPLE01", userId: "U0EXAMPLE01" },
      { getChannelName, getDisplayName, getPermalink: permalink },
    );

    const result = await resolveErrorReportAttribution(SESSION_ID, deps);

    expect(getChannelName).toHaveBeenCalledWith("C0EXAMPLE01");
    expect(getDisplayName).toHaveBeenCalledWith("U0EXAMPLE01");
    expect(result.channelName).toBe("support");
    expect(result.displayName).toBe("Jane Doe");
  });

  it("falls back to the sessionId when the session directory has been pruned", async () => {
    const deps = createDeps({
      getChannelName: vi.fn(async () => "support"),
      getDisplayName: vi.fn(async () => "Jane Doe"),
      getPermalink: permalink,
    });

    const result = await resolveErrorReportAttribution(SESSION_ID, deps);

    expect(result).toEqual({
      channelId: "C0EXAMPLE01",
      channelName: "support",
      userId: "U0EXAMPLE01",
      displayName: "Jane Doe",
      messageLink: "https://acme.slack.com/archives/C0EXAMPLE01/p1768338604542809",
    });
  });

  it("recovers attribution from a pruned DM session id", async () => {
    const deps = createDeps({ getPermalink: permalink });

    const result = await resolveErrorReportAttribution(DM_SESSION_ID, deps);

    expect(result.channelId).toBe("D0EXAMPLE01");
    expect(result.userId).toBe("U0EXAMPLE03");
    expect(permalink).toHaveBeenCalledWith("D0EXAMPLE01", "1778075069.394819");
  });

  it("omits the message link for a scheduled fire, which has no triggering message", async () => {
    const deps = withSessionFile(
      {
        channelId: "C0EXAMPLE02",
        channelName: "dev-updates",
        userId: "U0EXAMPLE01",
        trigger: { type: "scheduled" },
      },
      { getPermalink: permalink },
    );

    const result = await resolveErrorReportAttribution(
      "C0EXAMPLE02-1776888005-392-U0EXAMPLE01-1776888005479",
      deps,
    );

    expect(result.messageLink).toBeUndefined();
    expect(result.triggerType).toBe("scheduled");
    expect(permalink).not.toHaveBeenCalled();
  });

  it("omits the message link when Slack cannot resolve a permalink", async () => {
    const deps = withSessionFile({
      channelId: "C0EXAMPLE01",
      userId: "U0EXAMPLE01",
      messageTs: "1768338604.542809",
    });

    const result = await resolveErrorReportAttribution(SESSION_ID, deps);

    expect(result.messageLink).toBeUndefined();
    expect(result.channelId).toBe("C0EXAMPLE01");
  });

  it("returns nothing for a channelless session id with no persisted session", async () => {
    const deps = createDeps({ getPermalink: permalink });

    const result = await resolveErrorReportAttribution("channelless-job42-1776888005479", deps);

    expect(result).toEqual({});
    expect(permalink).not.toHaveBeenCalled();
  });

  it("degrades to no attribution when the session file is unparseable", async () => {
    const deps = createDeps({
      fileExists: vi.fn(async () => true),
      readFile: vi.fn(async () => "{ not json"),
      getPermalink: permalink,
    });

    const result = await resolveErrorReportAttribution("channelless-job42-1776888005479", deps);

    expect(result).toEqual({});
  });
});
