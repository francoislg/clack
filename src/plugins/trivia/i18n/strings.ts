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

  // Post-reveal "See your answer" button appended to every question card at reveal.
  "button.see_your_answer": "🔎 See your answer",

  // Static reveal results footer (replaces the live roster footer at reveal).
  "reveal.answer_was": "*Answer:* {answer}",
  "reveal.correct_label": "✅ *Correct:* {names}",
  "reveal.incorrect_label": "❌ *Incorrect:* {names}",
  "reveal.no_answer_label": "🤷 *Didn't answer:* {names}",
  "reveal.n_incorrect": "❌ {count} got it wrong",
  "reveal.n_no_answer": "🤷 {count} didn't answer",

  // Hint button + inline label + ephemeral fallback (see `trivia-question-hints`).
  "button.hint": "💡 Get Hint!",
  "hint.inline_prefix": "💡 _Hint:_ {text}",
  "hint.ephemeral_prefix": "💡 *Hint:* {text}",
  "hint.missing": "No hint available for this question.",

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
  "modal.title_see_answer": "Trivia — your answer",
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

  // Slack task-card tool labels ({game}/{category}/{name}/{slug} interpolated by the streamer).
  "label.add_categories": "Adding trivia categories — {game}",
  "label.remove_categories": "Removing trivia categories — {game}",
  "label.get_ideas": "Getting trivia category ideas — {game}",
  "label.save_question": "Saving trivia question — {game}/{category}",
  "label.post_questions": "Posting trivia question — {game}",
  "label.find_previous": "Searching past trivia questions — {game}",
  "label.question_history": "Loading trivia question history — {game}",
  "label.process_reveal": "Processing trivia reveal — {game}",
  "label.retrieve_scores": "Retrieving trivia scores — {game}",
  "label.list_games": "Listing trivia games",
  "label.upsert_game": "Upserting trivia game — {name}",
  "label.delete_game": "Deleting trivia game — {name}",
  "label.set_workspace_config": "Updating workspace-tier trivia config",
  "label.check_season": "Checking trivia season status — {game}",
  "label.upsert_season": "Upserting trivia season — {game}/{slug}",
  "label.delete_season": "Deleting trivia season — {game}/{slug}",
  "label.list_seasons": "Listing trivia seasons — {game}",
};

export const fr: Partial<Record<keyof typeof en, string>> = {
  "roster.answered_label": "📝 *Réponses :*",
  "roster.no_answers_yet": "(aucune réponse pour l'instant)",

  "button.true": "👍 VRAI",
  "button.false": "👎 FAUX",

  "button.answer": "Répondre",

  "button.see_your_answer": "🔎 Voir votre réponse",

  "reveal.answer_was": "*Réponse :* {answer}",
  "reveal.correct_label": "✅ *Correct :* {names}",
  "reveal.incorrect_label": "❌ *Incorrect :* {names}",
  "reveal.no_answer_label": "🤷 *Sans réponse :* {names}",
  "reveal.n_incorrect": "❌ {count} se sont trompés",
  "reveal.n_no_answer": "🤷 {count} n'ont pas répondu",

  "button.hint": "💡 Indice !",
  "hint.inline_prefix": "💡 _Indice :_ {text}",
  "hint.ephemeral_prefix": "💡 *Indice :* {text}",
  "hint.missing": "Aucun indice disponible pour cette question.",

  "modal.question_header": "Question ({category})",

  "modal.title_active": "Trivia — votre réponse",
  "modal.submit": "Envoyer la réponse",
  "modal.cancel": "Annuler",
  "modal.input_label": "Votre réponse",
  "modal.input_placeholder": "Tapez votre réponse",
  "modal.input_hint":
    "Vous pouvez rouvrir cette fenêtre et modifier votre réponse jusqu'à la révélation.",

  "modal.title_locked": "Trivia — répondu",
  "modal.title_see_answer": "Trivia — votre réponse",
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

  "label.add_categories": "Ajout de catégories trivia — {game}",
  "label.remove_categories": "Suppression de catégories trivia — {game}",
  "label.get_ideas": "Recherche d'idées de catégories trivia — {game}",
  "label.save_question": "Enregistrement de la question trivia — {game}/{category}",
  "label.post_questions": "Publication de la question trivia — {game}",
  "label.find_previous": "Recherche de questions trivia passées — {game}",
  "label.question_history": "Chargement de l'historique des questions trivia — {game}",
  "label.process_reveal": "Traitement de la révélation trivia — {game}",
  "label.retrieve_scores": "Récupération des scores trivia — {game}",
  "label.list_games": "Liste des jeux trivia",
  "label.upsert_game": "Mise à jour du jeu trivia — {name}",
  "label.delete_game": "Suppression du jeu trivia — {name}",
  "label.set_workspace_config": "Mise à jour de la config trivia (espace de travail)",
  "label.check_season": "Vérification du statut de la saison trivia — {game}",
  "label.upsert_season": "Mise à jour de la saison trivia — {game}/{slug}",
  "label.delete_season": "Suppression de la saison trivia — {game}/{slug}",
  "label.list_seasons": "Liste des saisons trivia — {game}",
};
