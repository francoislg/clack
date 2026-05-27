/**
 * Trivia plugin translation table. EN is authoritative — every key registered here
 * MUST exist in `en`. FR keys are partial; any key missing from `fr` falls back to
 * the EN value at lookup time (with a one-time warn from the SDK).
 *
 * Keys are namespaced by surface (`roster.*`, `modal.*`, `button.*`, etc.) so that
 * future additions don't collide. Registered with the plugin SDK at plugin init
 * via `sdk.registerDictionary({ en, fr })`.
 *
 * Placeholder convention: `{name}` — interpolated by `sdk.t(key, { name: "..." })`.
 */

export const en = {
  // Live roster footer rendered under freeform question cards.
  "roster.answered_label": "📝 *Answered:*",
  "roster.no_answers_yet": "(no answers yet)",

  // Boolean question buttons.
  "button.true": "👍 TRUE",
  "button.false": "👎 FALSE",

  // Freeform "open modal" button.
  "button.answer": "Answer",

  // Freeform modal — shared.
  "modal.question_header": "Question ({category})",

  // Freeform modal — active (editable) view.
  "modal.title_active": "Trivia — your answer",
  "modal.submit": "Submit answer",
  "modal.cancel": "Cancel",
  "modal.input_label": "Your answer",
  "modal.input_placeholder": "Type your answer",
  "modal.input_hint": "You can re-open this modal and edit your answer until the reveal.",

  // Freeform modal — locked (post-reveal) view.
  "modal.title_locked": "Trivia — answered",
  "modal.close": "Close",
  "modal.verdict_no_submission": ":no_entry_sign: You did not submit an answer for this question.",
  "modal.verdict_awaiting": ":hourglass_flowing_sand: Your answer: *{answer}* — awaiting reveal",
  "modal.verdict_correct": ":white_check_mark: Your answer: *{answer}* — correct!",
  "modal.verdict_incorrect": ":x: Your answer: *{answer}* — incorrect",

  // Freeform answer validation errors (modal field + ephemeral).
  "error.empty_answer": "Type an answer before submitting.",
  "error.question_gone": "This question no longer exists.",
  "error.answers_closed_question": "Answers are now closed for this question.",
  "error.answers_closed_round": "Answers are closed for this round.",

  // Owner cheat-report DM.
  "cheat.report_title": "🚨 Trivia cheat report",
};

export const fr: Partial<Record<keyof typeof en, string>> = {
  "roster.answered_label": "📝 *Réponses :*",
  "roster.no_answers_yet": "(aucune réponse pour l'instant)",

  "button.true": "👍 VRAI",
  "button.false": "👎 FAUX",

  "button.answer": "Répondre",

  "modal.question_header": "Question ({category})",

  "modal.title_active": "Trivia — votre réponse",
  "modal.submit": "Envoyer la réponse",
  "modal.cancel": "Annuler",
  "modal.input_label": "Votre réponse",
  "modal.input_placeholder": "Tapez votre réponse",
  "modal.input_hint":
    "Vous pouvez rouvrir cette fenêtre et modifier votre réponse jusqu'à la révélation.",

  "modal.title_locked": "Trivia — répondu",
  "modal.close": "Fermer",
  "modal.verdict_no_submission":
    ":no_entry_sign: Vous n'avez pas envoyé de réponse pour cette question.",
  "modal.verdict_awaiting":
    ":hourglass_flowing_sand: Votre réponse : *{answer}* — en attente de la révélation",
  "modal.verdict_correct": ":white_check_mark: Votre réponse : *{answer}* — correct !",
  "modal.verdict_incorrect": ":x: Votre réponse : *{answer}* — incorrect",

  "error.empty_answer": "Entrez une réponse avant d'envoyer.",
  "error.question_gone": "Cette question n'existe plus.",
  "error.answers_closed_question": "Les réponses sont maintenant closes pour cette question.",
  "error.answers_closed_round": "Les réponses sont closes pour cette manche.",

  "cheat.report_title": "🚨 Rapport de triche au trivia",
};
