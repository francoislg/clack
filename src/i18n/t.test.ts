import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { t, _setLanguageOverrideForTesting, _resetFallbackWarnings } from "./t.js";

describe("t() — translation helper", () => {
  beforeEach(() => {
    _setLanguageOverrideForTesting(null);
    _resetFallbackWarnings();
  });

  afterEach(() => {
    _setLanguageOverrideForTesting(null);
    _resetFallbackWarnings();
  });

  describe("EN (default)", () => {
    it("returns the EN value for a no-placeholder key", () => {
      assert.equal(t("_selftest.plain"), "Localization helper is wired up.");
    });

    it("interpolates a single placeholder", () => {
      assert.equal(t("_selftest.one_var", { name: "Ada" }), "Hello, Ada!");
    });

    it("interpolates multiple placeholders", () => {
      assert.equal(
        t("_selftest.two_vars", { repo: "clack", branch: "main" }),
        "Repo clack on branch main.",
      );
    });

    it("coerces numeric placeholder values to strings", () => {
      assert.equal(t("_selftest.numeric", { count: 42 }), "Count: 42");
    });
  });

  describe("FR (override)", () => {
    beforeEach(() => {
      _setLanguageOverrideForTesting("fr");
    });

    it("returns the FR value for a no-placeholder key", () => {
      assert.equal(t("_selftest.plain"), "Le module de localisation est branché.");
    });

    it("interpolates placeholders against the FR template", () => {
      assert.equal(t("_selftest.one_var", { name: "Ada" }), "Bonjour, Ada !");
    });

    it("preserves placeholder names exactly when interpolating", () => {
      assert.equal(
        t("_selftest.two_vars", { repo: "clack", branch: "main" }),
        "Dépôt clack sur la branche main.",
      );
    });
  });

  describe("fallback to EN", () => {
    beforeEach(() => {
      _setLanguageOverrideForTesting("fr");
    });

    it("returns EN value when key is absent from FR dictionary", () => {
      assert.equal(t("_selftest.missing_in_fr"), "This key intentionally has no FR translation.");
    });
  });

  describe("pre-config-load safety", () => {
    it("does not throw when t() is called before config is loaded", () => {
      // The override mechanism bypasses getConfig() entirely, but we also need to
      // verify the natural path (no override + no loaded config) returns EN safely.
      _setLanguageOverrideForTesting(null);
      assert.doesNotThrow(() => t("_selftest.plain"));
    });
  });
});
