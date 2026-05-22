import { describe, it } from "node:test";
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

/** Keys that are intentionally absent from FR (used by the fallback-to-EN test). */
const INTENTIONAL_FR_OMISSIONS = new Set<StringKey>(["_selftest.missing_in_fr"]);

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
    });
  }
});
