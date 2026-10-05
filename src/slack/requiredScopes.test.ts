import { describe, expect, expectTypeOf, it } from "vitest";
import type { Config } from "../config.js";
import {
  CORE_EVENTS,
  CORE_SCOPES,
  manifestFeatures,
  requiredBotEvents,
  requiredBotScopes,
  type ManifestFeatureSource,
  type ManifestFeatures,
} from "./requiredScopes.js";

const NO_FEATURES: ManifestFeatures = {
  directMessages: false,
  dmType: "assistant",
  mentions: false,
  autoRespond: false,
  publicSearch: false,
  investigations: false,
  canvases: "off",
  lists: "off",
};

const DM_CORE_SCOPES = ["im:history", "im:read", "mpim:history", "mpim:read"];

describe("manifestFeatures", () => {
  it("defaults every feature to off and dmType to assistant", () => {
    expect(manifestFeatures({})).toEqual(NO_FEATURES);
  });

  it("reads each feature from its config key", () => {
    expect(
      manifestFeatures({
        directMessages: { enabled: true, dmType: "agent" },
        mentions: { enabled: true },
        autoRespond: { enabled: true },
        allowPublicSearch: true,
        investigations: { enabled: true },
        canvases: { mode: "write" },
        lists: { mode: "write" },
      }),
    ).toEqual({
      directMessages: true,
      dmType: "agent",
      mentions: true,
      autoRespond: true,
      publicSearch: true,
      investigations: true,
      canvases: "write",
      lists: "write",
    });
  });

  it("accepts the validated Config as its source", () => {
    expectTypeOf<Config>().toExtend<ManifestFeatureSource>();
  });
});

describe("requiredBotScopes", () => {
  it("returns the core scopes plus im:write, sorted, when no feature is enabled", () => {
    const expected = [...CORE_SCOPES, "im:write"].sort((a, b) => a.localeCompare(b));
    expect(requiredBotScopes(NO_FEATURES)).toEqual(expected);
  });

  it("always includes im:write", () => {
    expect(requiredBotScopes(NO_FEATURES)).toContain("im:write");
    expect(requiredBotScopes({ ...NO_FEATURES, directMessages: true })).toContain("im:write");
  });

  it.each(["assistant", "agent"] as const)(
    "adds the DM scopes and assistant:write for dmType %s",
    (dmType) => {
      const scopes = requiredBotScopes({ ...NO_FEATURES, directMessages: true, dmType });
      expect(scopes).toEqual(expect.arrayContaining([...DM_CORE_SCOPES, "assistant:write"]));
    },
  );

  it("adds the DM scopes without assistant:write for dmType classic", () => {
    const scopes = requiredBotScopes({ ...NO_FEATURES, directMessages: true, dmType: "classic" });
    expect(scopes).toEqual(expect.arrayContaining(DM_CORE_SCOPES));
    expect(scopes).not.toContain("assistant:write");
  });

  it("omits the DM scopes when direct messages are disabled, whatever the dmType", () => {
    const scopes = requiredBotScopes({ ...NO_FEATURES, dmType: "agent" });
    for (const scope of [...DM_CORE_SCOPES, "assistant:write"]) {
      expect(scopes).not.toContain(scope);
    }
  });

  it("adds app_mentions:read for mentions", () => {
    expect(requiredBotScopes(NO_FEATURES)).not.toContain("app_mentions:read");
    expect(requiredBotScopes({ ...NO_FEATURES, mentions: true })).toContain("app_mentions:read");
  });

  it("adds search:read.public for public search", () => {
    expect(requiredBotScopes(NO_FEATURES)).not.toContain("search:read.public");
    expect(requiredBotScopes({ ...NO_FEATURES, publicSearch: true })).toContain(
      "search:read.public",
    );
  });

  it("adds channels:join for investigations", () => {
    expect(requiredBotScopes(NO_FEATURES)).not.toContain("channels:join");
    expect(requiredBotScopes({ ...NO_FEATURES, investigations: true })).toContain("channels:join");
  });

  it("adds only canvases:read for canvases mode read", () => {
    const scopes = requiredBotScopes({ ...NO_FEATURES, canvases: "read" });
    expect(scopes).toContain("canvases:read");
    expect(scopes).not.toContain("canvases:write");
  });

  it("adds canvases:read and canvases:write for canvases mode write", () => {
    const scopes = requiredBotScopes({ ...NO_FEATURES, canvases: "write" });
    expect(scopes).toEqual(expect.arrayContaining(["canvases:read", "canvases:write"]));
  });

  it("adds no canvas scope when canvases is off or absent", () => {
    for (const features of [NO_FEATURES, manifestFeatures({})]) {
      const scopes = requiredBotScopes(features);
      expect(scopes).not.toContain("canvases:read");
      expect(scopes).not.toContain("canvases:write");
    }
  });

  it("adds only lists:read for lists mode read", () => {
    const scopes = requiredBotScopes({ ...NO_FEATURES, lists: "read" });
    expect(scopes).toContain("lists:read");
    expect(scopes).not.toContain("lists:write");
  });

  it("adds lists:read and lists:write for lists mode write", () => {
    const scopes = requiredBotScopes({ ...NO_FEATURES, lists: "write" });
    expect(scopes).toEqual(expect.arrayContaining(["lists:read", "lists:write"]));
  });

  it("adds no list scope when lists is off or absent", () => {
    for (const features of [NO_FEATURES, manifestFeatures({})]) {
      const scopes = requiredBotScopes(features);
      expect(scopes).not.toContain("lists:read");
      expect(scopes).not.toContain("lists:write");
    }
  });

  it("adds no scope for autoRespond", () => {
    expect(requiredBotScopes({ ...NO_FEATURES, autoRespond: true })).toEqual(
      requiredBotScopes(NO_FEATURES),
    );
  });

  it("returns each scope once, sorted, with every feature enabled", () => {
    const scopes = requiredBotScopes({
      directMessages: true,
      dmType: "assistant",
      mentions: true,
      autoRespond: true,
      publicSearch: true,
      investigations: true,
      canvases: "write",
      lists: "write",
    });
    expect(new Set(scopes).size).toBe(scopes.length);
    expect(scopes).toEqual([...scopes].sort((a, b) => a.localeCompare(b)));
  });
});

describe("requiredBotEvents", () => {
  it("returns the core events, sorted, when no feature is enabled", () => {
    expect(requiredBotEvents(NO_FEATURES)).toEqual(
      [...CORE_EVENTS].sort((a, b) => a.localeCompare(b)),
    );
  });

  it("adds message.im and the assistant thread events for dmType assistant", () => {
    const events = requiredBotEvents({ ...NO_FEATURES, directMessages: true });
    expect(events).toEqual(
      expect.arrayContaining([
        "message.im",
        "assistant_thread_started",
        "assistant_thread_context_changed",
      ]),
    );
  });

  it.each(["classic", "agent"] as const)(
    "adds message.im without the assistant thread events for dmType %s",
    (dmType) => {
      const events = requiredBotEvents({ ...NO_FEATURES, directMessages: true, dmType });
      expect(events).toContain("message.im");
      expect(events).not.toContain("assistant_thread_started");
      expect(events).not.toContain("assistant_thread_context_changed");
    },
  );

  it("adds app_mention for mentions", () => {
    expect(requiredBotEvents({ ...NO_FEATURES, mentions: true })).toContain("app_mention");
  });

  it("adds no event for public search", () => {
    expect(requiredBotEvents({ ...NO_FEATURES, publicSearch: true })).toEqual(
      requiredBotEvents(NO_FEATURES),
    );
  });

  it("adds no event for canvases", () => {
    expect(requiredBotEvents({ ...NO_FEATURES, canvases: "write" })).toEqual(
      requiredBotEvents(NO_FEATURES),
    );
  });

  it("adds no event for lists", () => {
    expect(requiredBotEvents({ ...NO_FEATURES, lists: "write" })).toEqual(
      requiredBotEvents(NO_FEATURES),
    );
  });

  it.each(["autoRespond", "investigations"] as const)(
    "adds message.channels and message.groups for %s",
    (feature) => {
      const events = requiredBotEvents({ ...NO_FEATURES, [feature]: true });
      expect(events).toEqual(expect.arrayContaining(["message.channels", "message.groups"]));
    },
  );

  it("lists message.channels and message.groups once when autoRespond and investigations are both enabled", () => {
    const events = requiredBotEvents({ ...NO_FEATURES, autoRespond: true, investigations: true });
    expect(events.filter((e) => e === "message.channels")).toHaveLength(1);
    expect(events.filter((e) => e === "message.groups")).toHaveLength(1);
  });
});
