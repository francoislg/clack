/**
 * Direct-to-Slack strings for the idler plugin (management-tool confirmations). EN is
 * authoritative; FR is best-effort. The summary digest is Claude-authored and stays English
 * (rendered in the configured language by Claude), so it is not routed through here.
 */

export const en: Record<string, string> = {
  idler_enabled: "Idler enabled.",
  idler_disabled: "Idler disabled.",
  config_updated: "Idler configuration updated.",
  repo_added: "Repo {repo} added to the idler allowlist.",
  repo_removed: "Repo {repo} removed from the idler allowlist.",
  repo_not_found: "Repo {repo} is not in the allowlist.",
  channel_added: "Discovery channel {id} added.",
  channel_removed: "Discovery channel {id} removed.",
  channel_not_found: "Discovery channel {id} is not configured.",
  idea_cleared: "Work unit {key} removed from the ledger.",
  idea_not_found: "No work unit with key {key}.",
  validation_failed: "Configuration validation failed: {message}",
};

export const fr: Record<string, string> = {
  idler_enabled: "Idler activé.",
  idler_disabled: "Idler désactivé.",
  config_updated: "Configuration de l'idler mise à jour.",
  repo_added: "Dépôt {repo} ajouté à la liste autorisée de l'idler.",
  repo_removed: "Dépôt {repo} retiré de la liste autorisée de l'idler.",
  repo_not_found: "Le dépôt {repo} n'est pas dans la liste autorisée.",
  channel_added: "Canal de découverte {id} ajouté.",
  channel_removed: "Canal de découverte {id} retiré.",
  channel_not_found: "Le canal de découverte {id} n'est pas configuré.",
  idea_cleared: "Unité de travail {key} retirée du registre.",
  idea_not_found: "Aucune unité de travail avec la clé {key}.",
  validation_failed: "Échec de la validation de la configuration : {message}",
};
