import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { buildHintModal } from "./hintModal.js";
import type { ClackSdk } from "../../sdk.js";
import type { TriviaQuestion } from "../core/types.js";

const t: ClackSdk["t"] = (key, vars) => (vars?.text !== undefined ? `${key}:${vars.text}` : key);

function makeQuestion(overrides: Partial<TriviaQuestion>): TriviaQuestion {
  return {
    id: "QH1",
    category: "Science",
    statement: "Water boils at 100 C at sea level.",
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["💧"],
    createdAt: 0,
    ...overrides,
  };
}

function sectionTexts(view: ReturnType<typeof buildHintModal>): string[] {
  return view.blocks
    .filter((b): b is Extract<typeof b, { type: "section" }> => b.type === "section")
    .map((b) => ("text" in b && b.text !== undefined ? b.text.text : ""));
}

describe("buildHintModal", () => {
  it("renders title, question statement, and hint text when a hint is present", () => {
    const view = buildHintModal({
      question: makeQuestion({ hint: { mode: "button", text: "A primary color." } }),
      t,
    });
    assert.equal(view.type, "modal");
    assert.equal(view.title.text, "hint.modal_title");
    const texts = sectionTexts(view);
    assert.match(texts[0], /Water boils/);
    assert.match(texts[texts.length - 1], /A primary color/);
  });

  it("renders the missing-hint fallback when the question has no hint", () => {
    const view = buildHintModal({ question: makeQuestion({}), t });
    const texts = sectionTexts(view);
    assert.match(texts[0], /Water boils/);
    assert.ok(texts.includes("hint.missing"));
  });

  it("renders the missing-hint fallback when the question is undefined", () => {
    const view = buildHintModal({ question: undefined, t });
    assert.deepEqual(sectionTexts(view), ["hint.missing"]);
  });

  it("is display-only — no submit button", () => {
    const view = buildHintModal({
      question: makeQuestion({ hint: { mode: "button", text: "A primary color." } }),
      t,
    });
    assert.equal(view.submit, undefined);
    assert.equal(view.close?.text, "modal.close");
  });
});
