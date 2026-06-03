import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { en, fr } from "./strings.js";

/**
 * Parity guard for the reveal-card strings added by `add-trivia-static-reveal-cards`.
 * Each new key MUST exist in both locales, and its FR value MUST NOT be left
 * identical to EN (these keys are all genuinely translatable — no legitimate
 * cross-locale identicals like the `{category}`-only header).
 */
const NEW_REVEAL_CARD_KEYS = [
  "button.see_your_answer",
  "button.tell_me_more",
  "tell_me_more.intro",
  "reveal.answer_was",
  "reveal.correct_label",
  "reveal.incorrect_label",
  "reveal.no_answer_label",
  "reveal.n_incorrect",
  "reveal.n_no_answer",
  "modal.title_see_answer",
] as const;

describe("reveal-card i18n parity", () => {
  for (const key of NEW_REVEAL_CARD_KEYS) {
    it(`has a distinct FR value for "${key}"`, () => {
      const enValue = en[key];
      const frValue = fr[key];
      assert.ok(enValue !== undefined, `EN missing key ${key}`);
      assert.ok(frValue !== undefined, `FR missing key ${key}`);
      assert.notEqual(frValue, enValue, `FR value for ${key} must differ from EN`);
    });
  }

  it("keeps placeholder parity on the parameterized reveal keys", () => {
    const placeholderKeys: Array<[keyof typeof en, string]> = [
      ["reveal.answer_was", "{answer}"],
      ["reveal.correct_label", "{names}"],
      ["reveal.incorrect_label", "{names}"],
      ["reveal.no_answer_label", "{names}"],
      ["reveal.n_incorrect", "{count}"],
      ["reveal.n_no_answer", "{count}"],
      ["tell_me_more.intro", "{user}"],
    ];
    for (const [key, placeholder] of placeholderKeys) {
      assert.ok(en[key].includes(placeholder), `EN ${key} missing ${placeholder}`);
      assert.ok(fr[key]?.includes(placeholder), `FR ${key} missing ${placeholder}`);
    }
  });
});
