import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClackSdk, type ClackSdkDeps } from "./sdk.js";
import * as configModule from "../config.js";
import * as loggerModule from "../logger.js";
import type { RolesConfig } from "../roles.js";

const EMPTY_ROLES: RolesConfig = { owner: null, admins: [], devs: [] };

async function* emptyClackQuery(): AsyncGenerator<SDKMessage, void, void> {}

function makeSdk(pluginName = "test-plugin") {
  const dataDir = mkdtempSync(join(tmpdir(), "clack-sdk-i18n-"));
  const deps: ClackSdkDeps = {
    getSlackClient: () => null,
    loadRoles: async () => EMPTY_ROLES,
    openDmChannel: async () => null,
    clackQuery: () => emptyClackQuery(),
  };
  return createClackSdk(pluginName, dataDir, deps);
}

function stubConfig(language: "en" | "fr" | undefined | "throw") {
  const spy = vi.spyOn(configModule, "getConfig");
  if (language === "throw") {
    spy.mockImplementation(() => {
      throw new Error("config not loaded");
    });
  } else {
    spy.mockReturnValue({ language } as ReturnType<typeof configModule.getConfig>);
  }
  return spy;
}

describe("ClackSdk i18n", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("registerDictionary + t()", () => {
    it("returns the active-language value when registered", () => {
      stubConfig("fr");
      const { sdk } = makeSdk();
      sdk.registerDictionary({ en: { hello: "Hello" }, fr: { hello: "Bonjour" } });
      assert.equal(sdk.t("hello"), "Bonjour");
    });

    it("falls back to EN when the FR key is missing and warns once per key", () => {
      stubConfig("fr");
      const warn = vi.spyOn(loggerModule.logger, "warn").mockImplementation(() => {});
      const { sdk } = makeSdk();
      sdk.registerDictionary({
        en: { hello: "Hello", goodbye: "Goodbye" },
        fr: { hello: "Bonjour" },
      });
      assert.equal(sdk.t("goodbye"), "Goodbye");
      assert.equal(sdk.t("goodbye"), "Goodbye");
      const matching = warn.mock.calls.filter((c) =>
        c.some(
          (arg) => typeof arg === "string" && arg.includes('missing translation for key "goodbye"'),
        ),
      );
      assert.equal(matching.length, 1, "fallback warn should fire exactly once per key");
    });

    it("defaults to EN when the config has no language field", () => {
      stubConfig(undefined);
      const { sdk } = makeSdk();
      sdk.registerDictionary({ en: { hello: "Hello" }, fr: { hello: "Bonjour" } });
      assert.equal(sdk.t("hello"), "Hello");
    });

    it("defaults to EN when getConfig() throws", () => {
      stubConfig("throw");
      const { sdk } = makeSdk();
      sdk.registerDictionary({ en: { hello: "Hello" }, fr: { hello: "Bonjour" } });
      assert.equal(sdk.t("hello"), "Hello");
    });

    it("interpolates {name} placeholders", () => {
      stubConfig("en");
      const { sdk } = makeSdk();
      sdk.registerDictionary({
        en: { greet: "Hi {name}, you have {n} new messages" },
      });
      assert.equal(sdk.t("greet", { name: "Alice", n: 3 }), "Hi Alice, you have 3 new messages");
    });

    it("throws when t() is called before registerDictionary", () => {
      stubConfig("en");
      const { sdk } = makeSdk();
      assert.throws(() => sdk.t("anything"), /registerDictionary/);
    });

    it("throws when the key is missing from the EN table", () => {
      stubConfig("en");
      const { sdk } = makeSdk();
      sdk.registerDictionary({ en: { hello: "Hello" } });
      assert.throws(() => sdk.t("nonexistent"), /missing translation key "nonexistent"/);
    });

    it("isolates dictionaries per plugin instance", () => {
      stubConfig("en");
      const trivia = makeSdk("trivia").sdk;
      const weather = makeSdk("weather").sdk;
      trivia.registerDictionary({ en: { answered: "Answered" } });
      weather.registerDictionary({ en: { answered: "Replied" } });
      assert.equal(trivia.t("answered"), "Answered");
      assert.equal(weather.t("answered"), "Replied");
    });

    it("last-write-wins on a second registerDictionary call", () => {
      stubConfig("en");
      const { sdk } = makeSdk();
      sdk.registerDictionary({ en: { hello: "Hello" } });
      assert.equal(sdk.t("hello"), "Hello");
      sdk.registerDictionary({ en: { hello: "Hi" } });
      assert.equal(sdk.t("hello"), "Hi");
    });

    it("rejects a dictionary without an `en` table", () => {
      stubConfig("en");
      const { sdk } = makeSdk();
      // @ts-expect-error — exercising the runtime guard for callers that bypass the type.
      assert.throws(() => sdk.registerDictionary({ fr: { hello: "Bonjour" } }), /`en` table/);
    });
  });
});
