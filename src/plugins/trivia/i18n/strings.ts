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

  // Post-reveal "Tell me more" button (when tellMeMore is enabled) + its intro reply.
  "button.tell_me_more": "📚 Tell me more",
  "tell_me_more.intro": "{user} asked for more on this one — here we go:",

  // Static reveal results footer (replaces the live roster footer at reveal).
  "reveal.answer_was": "*Answer:* {answer}",
  "reveal.correct_label": "✅ *Correct:* {names}",
  "reveal.incorrect_label": "❌ *Incorrect:* {names}",
  "reveal.no_answer_label": "🤷 *Didn't answer:* {names}",
  "reveal.n_incorrect": "❌ {count} got it wrong",
  "reveal.n_no_answer": "🤷 {count} didn't answer",

  // Top-level pointer rendered in the `in-thread` finalRevealSummary mode, telling
  // readers the full verdict/WHY/voter breakdown is in the thread. Travels the
  // via-Claude path: the reveal prompt dictates it verbatim into a `context` block.
  "reveal.see_in_thread": "💬 Full reveal in the thread 👇",

  // Reveal leaderboard table row labels + season-finale podium labels. These travel the
  // via-Claude path (Claude authors the `table`/podium via `submit_response`), but the prompt
  // dictates them verbatim into cells/lines, so Claude copies the token without translating.
  // Pre-localizing them here turns that verbatim-copy into the delivery mechanism. EN values
  // MUST equal the prior prompt literals so English output stays byte-stable.
  "leaderboard.this_round": "This Round",
  "leaderboard.current_season": "Current Season",
  "leaderboard.all_time": "All Time",
  "leaderboard.first_place": "First place",
  "leaderboard.second_place": "Second place",
  "leaderboard.third_place": "Third place",
  "leaderboard.participation": "Participation",

  // Hint button + inline label + ephemeral fallback (see `trivia-question-hints`).
  "button.hint": "💡 Get Hint!",
  "hint.inline_prefix": "💡 _Hint:_ {text}",
  "hint.ephemeral_prefix": "💡 *Hint:* {text}",
  "hint.missing": "No hint available for this question.",
  "hint.modal_title": "💡 Hint",

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
  "label.update_question": "Authoring trivia card narrative — {game}",
  "label.post_questions": "Posting trivia question — {game}",
  "label.find_previous": "Searching past trivia questions — {game}",
  "label.find_previous_subjects": "Checking for repeat image subjects — {subjectId}",
  "label.question_history": "Loading trivia question history — {game}",
  "label.compute_answers": "Scoring trivia reveal — {game}",
  "label.update_answers_block": "Updating trivia question cards — {game}",
  "label.override_answer": "Overriding trivia answer — {game}",
  "label.remove_cheat": "Removing trivia cheat report — {game}",
  "label.start_new_season": "Rolling over trivia season — {game}",
  "label.retrieve_scores": "Retrieving trivia scores — {game}",
  "label.list_games": "Listing trivia games",
  "label.explain_cascade": "Explaining trivia cascade — {game}",
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

  "button.tell_me_more": "📚 En savoir plus",
  "tell_me_more.intro": "{user} veut en savoir plus sur celle-ci — c'est parti :",

  "reveal.answer_was": "*Réponse :* {answer}",
  "reveal.correct_label": "✅ *Correct :* {names}",
  "reveal.incorrect_label": "❌ *Incorrect :* {names}",
  "reveal.no_answer_label": "🤷 *Sans réponse :* {names}",
  "reveal.n_incorrect": "❌ {count} se sont trompés",
  "reveal.n_no_answer": "🤷 {count} n'ont pas répondu",

  "reveal.see_in_thread": "💬 La révélation complète dans le fil 👇",

  "leaderboard.this_round": "Ce tour",
  "leaderboard.current_season": "Saison en cours",
  "leaderboard.all_time": "Cumulatif",
  "leaderboard.first_place": "Première place",
  "leaderboard.second_place": "Deuxième place",
  "leaderboard.third_place": "Troisième place",
  // "leaderboard.participation" intentionally omitted — identical to EN ("Participation"), falls back.

  "button.hint": "💡 Indice !",
  "hint.inline_prefix": "💡 _Indice :_ {text}",
  "hint.ephemeral_prefix": "💡 *Indice :* {text}",
  "hint.missing": "Aucun indice disponible pour cette question.",
  "hint.modal_title": "💡 Indice",

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
  "label.update_question": "Rédaction du récit de la carte trivia — {game}",
  "label.post_questions": "Publication de la question trivia — {game}",
  "label.find_previous": "Recherche de questions trivia passées — {game}",
  "label.find_previous_subjects": "Vérification des sujets d'image déjà utilisés — {subjectId}",
  "label.question_history": "Chargement de l'historique des questions trivia — {game}",
  "label.compute_answers": "Calcul des réponses trivia — {game}",
  "label.update_answers_block": "Mise à jour des cartes de questions trivia — {game}",
  "label.override_answer": "Correction d'une réponse trivia — {game}",
  "label.remove_cheat": "Retrait d'un signalement de triche trivia — {game}",
  "label.start_new_season": "Clôture de la saison trivia — {game}",
  "label.retrieve_scores": "Récupération des scores trivia — {game}",
  "label.list_games": "Liste des jeux trivia",
  "label.explain_cascade": "Explication de la cascade trivia — {game}",
  "label.upsert_game": "Mise à jour du jeu trivia — {name}",
  "label.delete_game": "Suppression du jeu trivia — {name}",
  "label.set_workspace_config": "Mise à jour de la config trivia (espace de travail)",
  "label.check_season": "Vérification du statut de la saison trivia — {game}",
  "label.upsert_season": "Mise à jour de la saison trivia — {game}/{slug}",
  "label.delete_season": "Suppression de la saison trivia — {game}/{slug}",
  "label.list_seasons": "Liste des saisons trivia — {game}",
};
