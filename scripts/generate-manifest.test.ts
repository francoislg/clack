import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { generateManifest } from "./generate-manifest.js";

function getScopes(m: ReturnType<typeof generateManifest>): readonly string[] {
  return (m.oauth_config?.scopes?.bot ?? []) as readonly string[];
}

function getEvents(m: ReturnType<typeof generateManifest>): readonly string[] {
  return (m.settings?.event_subscriptions?.bot_events ?? []) as readonly string[];
}

function getAgentPrompts(
  m: ReturnType<typeof generateManifest>,
): Array<{ title: string; message: string }> {
  const features = m.features as {
    agent_view?: { suggested_prompts?: Array<{ title: string; message: string }> };
  };
  return features.agent_view?.suggested_prompts ?? [];
}

describe("generateManifest — dmType branching", () => {
  it("emits assistant scope/events/feature when dmType is assistant", () => {
    const manifest = generateManifest({
      directMessages: { enabled: true, dmType: "assistant" },
    });
    const scopes = getScopes(manifest);
    const events = getEvents(manifest);

    assert.ok(scopes.includes("im:history"));
    assert.ok(scopes.includes("im:read"));
    assert.ok(scopes.includes("mpim:history"));
    assert.ok(scopes.includes("mpim:read"));
    assert.ok(scopes.includes("assistant:write"));

    assert.ok(events.includes("message.im"));
    assert.ok(events.includes("assistant_thread_started"));
    assert.ok(events.includes("assistant_thread_context_changed"));

    assert.ok(manifest.features && "assistant_view" in manifest.features);
  });

  it("defaults to assistant mode when dmType is absent", () => {
    const manifest = generateManifest({ directMessages: { enabled: true } });
    const scopes = getScopes(manifest);
    const events = getEvents(manifest);

    assert.ok(scopes.includes("assistant:write"));
    assert.ok(events.includes("assistant_thread_started"));
    assert.ok(events.includes("assistant_thread_context_changed"));
    assert.ok(manifest.features && "assistant_view" in manifest.features);
  });

  it("omits assistant scope/events/feature when dmType is classic", () => {
    const manifest = generateManifest({
      directMessages: { enabled: true, dmType: "classic" },
    });
    const scopes = getScopes(manifest);
    const events = getEvents(manifest);

    assert.equal(scopes.includes("assistant:write"), false);
    assert.equal(events.includes("assistant_thread_started"), false);
    assert.equal(events.includes("assistant_thread_context_changed"), false);
    assert.equal(manifest.features && "assistant_view" in manifest.features, false);

    // Core DM scopes/events still present
    assert.ok(scopes.includes("im:history"));
    assert.ok(scopes.includes("im:read"));
    assert.ok(scopes.includes("mpim:history"));
    assert.ok(scopes.includes("mpim:read"));
    assert.ok(events.includes("message.im"));
  });

  it("omits all DM scopes/events when DMs are disabled regardless of dmType", () => {
    const manifestClassicDisabled = generateManifest({
      directMessages: { enabled: false, dmType: "classic" },
    });
    const manifestAssistantDisabled = generateManifest({
      directMessages: { enabled: false, dmType: "assistant" },
    });

    for (const manifest of [manifestClassicDisabled, manifestAssistantDisabled]) {
      const scopes = getScopes(manifest);
      const events = getEvents(manifest);

      assert.equal(scopes.includes("im:history"), false);
      assert.equal(scopes.includes("im:read"), false);
      assert.equal(scopes.includes("assistant:write"), false);
      assert.equal(events.includes("message.im"), false);
      assert.equal(events.includes("assistant_thread_started"), false);
      assert.equal(manifest.features && "assistant_view" in manifest.features, false);
    }
  });

  it("always includes im:write regardless of DM enablement or dmType", () => {
    const manifests = [
      generateManifest({}),
      generateManifest({ directMessages: { enabled: false } }),
      generateManifest({ directMessages: { enabled: true, dmType: "classic" } }),
      generateManifest({ directMessages: { enabled: true, dmType: "assistant" } }),
    ];
    for (const m of manifests) {
      assert.ok(getScopes(m).includes("im:write"));
    }
  });
});

describe("generateManifest — agent dmType", () => {
  it("emits agent_view (not assistant_view) with assistant:write and no thread events", () => {
    const manifest = generateManifest({
      directMessages: { enabled: true, dmType: "agent" },
    });
    const scopes = getScopes(manifest);
    const events = getEvents(manifest);

    assert.ok(manifest.features && "agent_view" in manifest.features);
    assert.equal(manifest.features && "assistant_view" in manifest.features, false);

    assert.ok(scopes.includes("assistant:write"));
    assert.ok(scopes.includes("im:history"));

    assert.ok(events.includes("message.im"));
    assert.ok(events.includes("app_home_opened"));
    assert.equal(events.includes("assistant_thread_started"), false);
    assert.equal(events.includes("assistant_thread_context_changed"), false);
  });

  it("populates agent_view.suggested_prompts with well-formed static prompts", () => {
    const manifest = generateManifest({
      directMessages: { enabled: true, dmType: "agent" },
    });
    const prompts = getAgentPrompts(manifest);

    assert.ok(prompts.length > 0);
    for (const p of prompts) {
      assert.ok(typeof p.title === "string" && p.title.length > 0);
      assert.ok(typeof p.message === "string" && p.message.length > 0);
    }
  });

  it("leaves assistant and classic emission unchanged (no agent_view)", () => {
    for (const dmType of ["assistant", "classic"] as const) {
      const manifest = generateManifest({ directMessages: { enabled: true, dmType } });
      assert.equal(manifest.features && "agent_view" in manifest.features, false);
    }
  });
});

describe("generateManifest — allowPublicSearch", () => {
  it("adds search:read.public when allowPublicSearch is true", () => {
    const manifest = generateManifest({ allowPublicSearch: true });
    assert.ok(getScopes(manifest).includes("search:read.public"));
  });

  it("omits search:read.public when allowPublicSearch is false or absent", () => {
    for (const config of [{ allowPublicSearch: false }, {}]) {
      const manifest = generateManifest(config);
      assert.equal(getScopes(manifest).includes("search:read.public"), false);
    }
  });

  it("does not change bot_events when toggled (no event subscription added)", () => {
    const enabled = generateManifest({ allowPublicSearch: true });
    const disabled = generateManifest({ allowPublicSearch: false });
    assert.deepEqual(getEvents(enabled), getEvents(disabled));
  });
});
