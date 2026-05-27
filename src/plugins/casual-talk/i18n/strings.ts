/**
 * Direct-to-Slack strings for the casual-talk plugin. EN is authoritative; FR
 * is best-effort. Tool descriptions and Claude-facing prompt content are NOT
 * routed through here — they stay English by design (per repo i18n rules).
 */

export const en: Record<string, string> = {
  // Tool result messages
  config_replaced: "Casual-talk configuration replaced.",
  channel_added: "Channel {id} added.",
  channel_already_present: "Channel {id} was already configured — updated its prompt suggestion.",
  channel_removed: "Channel {id} removed.",
  channel_not_found: "Channel {id} is not configured.",
  prompt_suggestion_set: "Prompt suggestion for {id} updated.",
  prompt_suggestion_cleared: "Prompt suggestion for {id} cleared.",
  topic_added: "Small-talk topic added: {topic}.",
  topic_already_present: "Small-talk topic was already in the list — no change.",
  topic_removed: "Small-talk topic removed: {topic}.",
  topic_not_found: "Topic '{topic}' is not in the list.",
  rate_set_named: "Expected rate set to '{rate}'.",
  rate_set_die: "Die size set to 1/{die} per tick.",
  work_hours_set: "Work hours updated: {start}-{end} {tz} on days [{days}].",
  enabled: "Casual-talk enabled.",
  disabled: "Casual-talk disabled.",
  already_enabled: "Casual-talk is already enabled.",
  already_disabled: "Casual-talk is already disabled.",

  // Validation errors
  validation_failed: "Configuration validation failed: {message}",
};

export const fr: Record<string, string> = {
  config_replaced: "Configuration casual-talk remplacée.",
  channel_added: "Canal {id} ajouté.",
  channel_already_present: "Canal {id} était déjà configuré — suggestion de prompt mise à jour.",
  channel_removed: "Canal {id} retiré.",
  channel_not_found: "Canal {id} n'est pas configuré.",
  prompt_suggestion_set: "Suggestion de prompt pour {id} mise à jour.",
  prompt_suggestion_cleared: "Suggestion de prompt pour {id} effacée.",
  topic_added: "Sujet small-talk ajouté : {topic}.",
  topic_already_present: "Sujet small-talk était déjà dans la liste — aucun changement.",
  topic_removed: "Sujet small-talk retiré : {topic}.",
  topic_not_found: "Sujet '{topic}' n'est pas dans la liste.",
  rate_set_named: "Taux attendu défini à '{rate}'.",
  rate_set_die: "Taille du dé définie à 1/{die} par tick.",
  work_hours_set: "Heures de travail mises à jour : {start}-{end} {tz} les jours [{days}].",
  enabled: "Casual-talk activé.",
  disabled: "Casual-talk désactivé.",
  already_enabled: "Casual-talk est déjà activé.",
  already_disabled: "Casual-talk est déjà désactivé.",
  validation_failed: "Échec de la validation de la configuration : {message}",
};
