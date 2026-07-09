import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { en, type StringKey } from "./strings/en.js";
import { fr } from "./strings/fr.js";

const PLACEHOLDER_RE = /\{([^{}\s]+)\}/g;

function extractPlaceholders(template: string): Set<string> {
  const out = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    out.add(match[1]);
  }
  return out;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function isStringKey(value: string): value is StringKey {
  return Object.prototype.hasOwnProperty.call(en, value);
}

/**
 * Translation-completeness guard. Returns the keys whose translated value is a
 * present, non-empty string identical to the EN value and is NOT allowlisted.
 * Shared by the real-dictionary parity test and the synthetic guard scenarios so
 * the assertion and its proof exercise the exact same logic.
 */
function findIdenticalToEn(
  enMap: Record<string, string>,
  dict: Partial<Record<string, string>>,
  allow: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const key of Object.keys(enMap)) {
    if (allow.has(key)) continue;
    const translated = dict[key];
    if (translated !== undefined && translated !== "" && translated === enMap[key]) {
      out.push(key);
    }
  }
  return out;
}

/** Keys that are intentionally absent from FR (used by the fallback-to-EN test). */
const INTENTIONAL_FR_OMISSIONS = new Set<StringKey>(["_selftest.missing_in_fr"]);

/**
 * Translation-completeness allowlist: keys whose translated value is allowed to
 * equal the EN value. Only legitimately-identical entries belong here — proper
 * names / brand terms, French cognates spelled identically, and values made up
 * solely of markup + `{var}` placeholders. Everything else MUST differ from EN,
 * which catches "fake translations" (a key wired through t() but never actually
 * translated, e.g. a French value left as the English term).
 */
const IDENTICAL_OK = new Set<StringKey>([
  // Proper / role names kept verbatim in French.
  "home.role.admin",
  "home.role.dev",
  // French cognates spelled identically.
  "home.config.header", // "Configuration"
  "home.config.role_suffix", // "Config"
  "home.config.instructions_title", // "{dir}/ Instructions"
  "home.status.trigger_mention", // ":mega: @Mentions"
  "home.workers.header", // "Workers" — technical pool term
  "home.workers.session_suffix", // " · session `{id}`"
  "home.scheduled.pause", // "Pause"
  // Markup / placeholder-only values with no translatable words.
  "home.status.access_plus", // "{role}+"
  "home.status.skill_plugin_entry", // "• *{name}*{suffix}"
  "home.status.clack_plugin_error", // "{reasons}"
  "home.usage.window_unknown", // "{type}" — echoes the raw SDK rate-limit type
]);

const NON_EN_DICTIONARIES: ReadonlyArray<{
  lang: string;
  dict: Partial<Record<StringKey, string>>;
}> = [{ lang: "fr", dict: fr }];

describe("i18n dictionary parity", () => {
  for (const { lang, dict } of NON_EN_DICTIONARIES) {
    describe(`${lang} vs en`, () => {
      it(`covers every EN key (allowed omissions: ${[...INTENTIONAL_FR_OMISSIONS].join(", ") || "<none>"})`, () => {
        const missing: StringKey[] = [];
        for (const rawKey of Object.keys(en)) {
          if (!isStringKey(rawKey)) continue;
          if (INTENTIONAL_FR_OMISSIONS.has(rawKey)) continue;
          const value = dict[rawKey];
          if (value === undefined || value === "") missing.push(rawKey);
        }
        assert.deepEqual(
          missing,
          [],
          `${lang}: missing translations for keys: ${missing.join(", ")}`,
        );
      });

      it("has no keys absent from EN", () => {
        const extra: string[] = [];
        for (const key of Object.keys(dict)) {
          if (!(key in en)) extra.push(key);
        }
        assert.deepEqual(extra, [], `${lang}: extra keys not in EN: ${extra.join(", ")}`);
      });

      it("uses the same placeholder tokens per key", () => {
        const mismatches: string[] = [];
        for (const rawKey of Object.keys(en)) {
          if (!isStringKey(rawKey)) continue;
          const translated = dict[rawKey];
          if (translated === undefined || translated === "") continue;
          const enTokens = extractPlaceholders(en[rawKey]);
          const trTokens = extractPlaceholders(translated);
          if (!sameSet(enTokens, trTokens)) {
            mismatches.push(
              `${rawKey}: en={${[...enTokens].join(",")}} vs ${lang}={${[...trTokens].join(",")}}`,
            );
          }
        }
        assert.deepEqual(
          mismatches,
          [],
          `${lang}: placeholder token mismatches:\n  ${mismatches.join("\n  ")}`,
        );
      });

      it("has no untranslated (value identical to EN) entries outside the allowlist", () => {
        const identical = findIdenticalToEn(en, dict, IDENTICAL_OK).map(
          (k) => `${k}: ${JSON.stringify(en[k as StringKey])}`,
        );
        assert.deepEqual(
          identical,
          [],
          `${lang}: values identical to EN (translate them, or add to IDENTICAL_OK if intentionally identical):\n  ${identical.join("\n  ")}`,
        );
      });

      it("IDENTICAL_OK allowlist has no stale entries", () => {
        const stale: string[] = [];
        for (const key of IDENTICAL_OK) {
          const translated = dict[key];
          // An allowlisted key is stale if it now differs from EN (no longer needs the exemption)
          // or is missing entirely (covered by other tests). Only flag the "now differs" case.
          if (translated !== undefined && translated !== "" && translated !== en[key]) {
            stale.push(key);
          }
        }
        assert.deepEqual(
          stale,
          [],
          `IDENTICAL_OK contains keys whose ${lang} value now differs from EN — remove them: ${stale.join(", ")}`,
        );
      });
    });
  }
});

describe("translation-completeness guard (synthetic)", () => {
  it("flags a non-allowlisted FR value identical to EN", () => {
    const flagged = findIdenticalToEn(
      { "home.auto_respond.header": "Auto-Respond" },
      { "home.auto_respond.header": "Auto-Respond" },
      new Set(),
    );
    assert.deepEqual(flagged, ["home.auto_respond.header"]);
  });

  it("passes an allowlisted identical value", () => {
    const flagged = findIdenticalToEn(
      { "brand.slack": "Slack" },
      { "brand.slack": "Slack" },
      new Set(["brand.slack"]),
    );
    assert.deepEqual(flagged, []);
  });

  it("ignores genuinely translated values", () => {
    const flagged = findIdenticalToEn(
      { "home.save": "Save" },
      { "home.save": "Enregistrer" },
      new Set(),
    );
    assert.deepEqual(flagged, []);
  });
});
