import type { StringKey } from "./en.js";

export const fr: Partial<Record<StringKey, string>> = {
  // ─── Self-test ─────────────────────────────────────────────────────
  "_selftest.plain": "Le module de localisation est branché.",
  "_selftest.one_var": "Bonjour, {name} !",
  "_selftest.two_vars": "Dépôt {repo} sur la branche {branch}.",
  "_selftest.numeric": "Compte : {count}",

  // ─── Common labels ─────────────────────────────────────────────────
  "common.save": "Enregistrer",
  "common.cancel": "Annuler",
  "common.close": "Fermer",
  "common.back": "Retour",
  "common.edit": "Modifier",
  "common.delete": "Supprimer",
  "common.create": "Créer",
  "common.submit": "Envoyer",
  "common.remove": "Retirer",
  "common.none": "_Aucun_",
  "common.none_paren": "_(aucun)_",

  // ─── Migration banner ──────────────────────────────────────────────
  "home.migration.title": ":warning: *Erreur de migration*",
  "home.migration.entry": "• *{name}* (v{version}) : {error}",
  "home.migration.admin_hint":
    "_Consultez les logs pour les détails et redémarrez Clack après avoir résolu le problème._",

  // ─── Role badge ────────────────────────────────────────────────────
  "home.role.system": "Système",
  "home.role.owner": "Propriétaire",
  "home.role.admin": "Admin",
  "home.role.dev": "Dev",
  "home.role.member": "Membre",
  "home.role.badge": "{emoji} *Votre rôle :* {label}",

  // ─── Claim ownership ───────────────────────────────────────────────
  "home.ownership.disabled_owner":
    ":warning: Le propriétaire actuel est inactif. En tant qu'admin, vous pouvez en revendiquer la propriété.",
  "home.ownership.no_owner":
    ":wave: *Bienvenue !* Ce bot n'a pas encore de propriétaire. Revendiquez-le pour le gérer.",
  "home.ownership.claim_button": "Revendiquer la propriété",

  // ─── Role management ───────────────────────────────────────────────
  "home.roles.header": "Gestion des rôles",
  "home.roles.owner_line": ":crown: *Propriétaire :* {mention}",
  "home.roles.transfer_button": "Transférer",
  "home.roles.admins_line": ":shield: *Admins :* {list}",
  "home.roles.devs_line": ":computer: *Devs :* {list}",
  "home.roles.add_admin": "+ Ajouter un admin",
  "home.roles.remove_admin": "- Retirer un admin",
  "home.roles.add_dev": "+ Ajouter un dev",
  "home.roles.remove_dev": "- Retirer un dev",

  // ─── Configuration ─────────────────────────────────────────────────
  "home.config.header": "Configuration",
  "home.config.edit_role_button": "{prefix}Modifier la config {label}",
  "home.config.edit_pre_analysis_button": "{prefix}Modifier le contexte de pré-analyse",
  "home.config.edit_repo_button": ":file_folder: Modifier la config de {repo}",
  "home.config.personal_preferences_button": ":gear: Préférences personnelles",
  "home.config.chat_hint":
    "_Discutez avec moi pour modifier les fichiers de config principaux (config.json, mcp.json, .env, tool mappings) ou redémarrer l'app._",
  "home.config.role_suffix": "Config",
  "home.config.too_large": "_Trop volumineux pour l'éditeur modal_",
  "home.config.chat_to_edit": "Modifier via le chat",
  "home.config.create_new_file": "+ Créer un nouveau fichier",
  "home.config.instructions_title": "{dir}/ Instructions",
  "home.config.default_only": "_Par défaut — aucune surcharge_",
  "home.config.content_label": "Contenu",
  "home.config.reset_to_default": "Réinitialiser",
  "home.config.delete_file": "Supprimer le fichier",
  "home.config.create_override": "Créer une surcharge",
  "home.config.create_new_file_title": "Créer un nouveau fichier",
  "home.config.filename_label": "Nom de fichier",
  "home.config.filename_placeholder": "mes-instructions",
  "home.config.filename_hint": "L'extension .md est ajoutée automatiquement",
  "home.config.content_placeholder": "Saisissez le contenu des instructions…",

  // ─── Status ────────────────────────────────────────────────────────
  "home.status.header": "Statut",
  "home.status.repositories_block": ":file_folder: *Dépôts :*\n{list}",
  "home.status.repo_access_writable": "_lecture : {read} · écriture : {write}_",
  "home.status.repo_access_readonly": "_lecture : {read} · lecture seule_",
  "home.status.access_all": "tous",
  "home.status.access_plus": "{role}+",
  "home.status.mcp_servers_block":
    ":electric_plug: *Serveurs MCP :*\n• *Toujours chargés :* {always}\n• *À la demande :* {onDemand}",
  "home.status.skill_plugins_block": ":jigsaw: *Skill Plugins :*\n{sections}",
  "home.status.skill_eager_section": "_Eager (toujours chargés) :_\n{list}",
  "home.status.skill_lazy_section": "_Lazy (à la demande via load_skill) :_\n{list}",
  "home.status.skill_plugin_entry": "• *{name}*{suffix}",
  "home.status.skill_count_suffix": " ({count} skills)",
  "home.status.clack_plugins_block": ":package: *Plugins :*\n{list}",
  "home.status.clack_plugin_entry": "• *{name}* ({count} outils)",
  "home.status.trigger_methods": ":zap: *Modes de déclenchement :* {methods}",
  "home.status.trigger_reaction": ":{emoji}: Réaction",
  "home.status.trigger_dm": ":speech_balloon: Messages directs",
  "home.status.trigger_mention": ":mega: @Mentions",

  // ─── Workers ───────────────────────────────────────────────────────
  "home.workers.header": "Workers",
  "home.workers.no_active_changes": "_Aucune demande de changement active._",
  "home.workers.no_workers_yet": "_Aucun worker provisionné — la première demande en créera un._",
  "home.workers.no_workers_for_repo":
    "_Aucun worker pour ce dépôt — sera provisionné à la première acquisition._",
  "home.workers.status_line": "• Statut : {label}",
  "home.workers.branch_line": "• Branche : `{branch}`",
  "home.workers.repo_line": "• Dépôt : {repo}",
  "home.workers.by_line": "• Par : {by}",
  "home.workers.auto_respond_label": "Auto-Respond",
  "home.workers.thread_line": "• Fil : <{url}|Voir le fil>",
  "home.workers.pr_line": "\n• PR : <{url}|Voir la PR>",
  "home.workers.counts":
    ":large_green_circle: {idle} libres · :hammer_and_wrench: {busy} occupés · :hourglass_flowing_sand: {init} en cours d'init · :warning: {quar} en quarantaine · :x: {failed} en échec · :bookmark_tabs: {queued} en file",
  "home.workers.detached": "(détaché)",
  "home.workers.session_suffix": " · session `{id}`",
  "home.workers.setup_incomplete_suffix": " · setup incomplet",
  "home.workers.worker_line":
    "{emoji} `{id}` · {status} · branche `{branch}`{claimed}{setup} · dernière utilisation {when}",
  "home.workers.discard_restore": "Annuler & restaurer",
  "home.workers.discard_title": "Annuler les changements locaux ?",
  "home.workers.discard_text":
    "Ceci exécute `git reset --hard HEAD` et `git clean -fd` sur `{id}`. Les changements non commités seront perdus.",
  "home.workers.discard_confirm": "Annuler",
  "home.workers.queued_entry":
    ":bookmark_tabs: en file : branche `{branch}` · session `{session}` · depuis {when}",

  // ─── Help ──────────────────────────────────────────────────────────
  "home.help.header": "Aide",
  "home.help.how_to_use": "*Comment utiliser ce bot :*",
  "home.help.reaction":
    "• *Réaction :* Réagissez à n'importe quel message avec :{emoji}: pour me poser une question",
  "home.help.dm": "• *Message direct :* Envoyez-moi un DM avec votre question",
  "home.help.mention":
    "• *Mention :* @mentionnez-moi dans n'importe quel canal avec votre question",
  "home.help.stop":
    "• *Arrêt :* Réagissez avec :{emoji}: (ou tapez-le dans un court message) pour annuler le travail en cours et me faire taire dans un fil",
  "home.help.context": "_J'analyse votre code source et réponds à vos questions en langage clair._",

  // ─── Settings modal ────────────────────────────────────────────────
  "home.settings.title": "Paramètres",
  "home.settings.delivery_label":
    "*Livraison des réactions*\nComment souhaitez-vous recevoir les réponses lorsque vous réagissez avec l'emoji déclencheur ?",
  "home.settings.delivery_dm_label": "Message direct",
  "home.settings.delivery_dm_description":
    "Obtenez un fil DM privé pour affiner avant de partager.",
  "home.settings.delivery_thread_label": "Fil",
  "home.settings.delivery_thread_description":
    "La réponse est publiée directement dans le fil du canal.",
  "home.settings.notify_label":
    "*Notification de réponse*\nSi la réponse prend plus de 60 secondes, publier un message de suivi pour recevoir une notification Slack ?",
  "home.settings.notify_on_label": "Activé",
  "home.settings.notify_on_description":
    "Si la réponse prend plus de 60 secondes, publier un suivi pour vous notifier sur Slack.",
  "home.settings.notify_off_label": "Désactivé",
  "home.settings.notify_off_description": "Pas de message supplémentaire — juste la réponse.",

  // ─── User select / remove modals ───────────────────────────────────
  "home.user_select.label": "Sélectionner un utilisateur",
  "home.user_remove.prompt": "Sélectionnez un utilisateur à retirer :",
  "home.user_remove.placeholder": "Sélectionner un utilisateur à retirer",
  "home.user_remove.label": "Utilisateur",

  // ─── Auto-respond ──────────────────────────────────────────────────
  "home.auto_respond.header": "Auto-Respond",
  "home.auto_respond.empty": "_Aucune règle auto-respond configurée._",
  "home.auto_respond.paused_suffix": " _(en pause)_",
  "home.auto_respond.pre_analysis_suffix": " · Pré-analyse",
  "home.auto_respond.keywords_suffix": " · Mots-clés : {list}",
  "home.auto_respond.add_rule": "+ Ajouter une règle",
  "home.auto_respond.modal_title_edit": "Modifier la règle",
  "home.auto_respond.modal_title_add": "Ajouter une règle",
  "home.auto_respond.channels_label": "Canaux",
  "home.auto_respond.channels_placeholder": "Sélectionnez les canaux à surveiller",
  "home.auto_respond.users_label": "Filtrer par utilisateurs/bots (optionnel)",
  "home.auto_respond.users_placeholder": "Laisser vide pour correspondre à tous les messages",
  "home.auto_respond.keywords_label": "Mots-clés (optionnel)",
  "home.auto_respond.keywords_placeholder": "ex. CRITICAL, timeout, OOM — séparés par des virgules",
  "home.auto_respond.extra_context_label": "Contexte supplémentaire (optionnel)",
  "home.auto_respond.extra_context_placeholder":
    "ex. Ceci est une alerte d'erreur Sentry. Concentrez-vous sur la stack trace et trouvez le code concerné.",
  "home.auto_respond.pre_analysis_label": "Contexte de pré-analyse (optionnel)",
  "home.auto_respond.pre_analysis_placeholder":
    "ex. Ne répondre que si c'est une erreur actionnable — laisser vide pour ignorer la pré-analyse",
  "home.auto_respond.pre_analysis_hint":
    "Quand défini, un check IA rapide détermine si le message vaut une réponse avant de lancer la réponse complète.",
  "home.auto_respond.context_hint":
    "Le bot doit être membre des canaux sélectionnés pour recevoir les messages.",
  "home.auto_respond.disable_rule": "Désactiver la règle",
  "home.auto_respond.enable_rule": "Activer la règle",
  "home.auto_respond.delete_rule": "Supprimer la règle",
  "home.auto_respond.delete_confirm_title": "Supprimer la règle ?",
  "home.auto_respond.delete_confirm_text":
    "Ceci supprimera définitivement cette règle auto-respond.",

  // ─── Scheduled messages ────────────────────────────────────────────
  "home.scheduled.header": "Messages programmés",
  "home.scheduled.plugin_header": "Messages programmés des plugins",
  "home.scheduled.plugin_hint":
    "Lecture seule — réconciliés depuis la config plugin. Modifiez `data/config.json` pour changer la programmation/le prompt ; pause/reprise depuis ici.",
  "home.scheduled.paused_suffix": " _(en pause)_",
  "home.scheduled.skipped_suffix": " _(dernière exécution ignorée)_",
  "home.scheduled.one_time_suffix": " · _ponctuel_",
  "home.scheduled.plugin_suffix": " · _plugin : {plugin}_",
  "home.scheduled.pause": "Pause",
  "home.scheduled.resume": "Reprendre",
  "home.scheduled.modal_title_edit": "Modifier la programmation",
  "home.scheduled.modal_title_add": "Ajouter une programmation",
  "home.scheduled.name_label": "Nom",
  "home.scheduled.name_placeholder": "p.ex. Récap matinal des PR",
  "home.scheduled.name_hint":
    "Libellé court affiché dans la page d'accueil et les cartes d'outils (1-80 caractères).",
  "home.scheduled.channel_label": "Canal",
  "home.scheduled.channel_placeholder": "Sélectionnez un canal",
  "home.scheduled.cron_label": "Expression cron",
  "home.scheduled.cron_placeholder": "ex. 0 9 * * * (tous les jours à 9h)",
  "home.scheduled.cron_hint": "Cron 5 champs : minute heure jour-du-mois mois jour-de-semaine",
  "home.scheduled.prompt_label": "Prompt (contenu dynamique)",
  "home.scheduled.prompt_placeholder":
    "Que doit faire Claude ? ex. Résumer les PR mergées aujourd'hui",
  "home.scheduled.skip_label": "Conditions d'ignorer (optionnel)",
  "home.scheduled.skip_placeholder":
    "ex. Ignorer si aucune PR n'a été mergée dans les dernières 24h",
  "home.scheduled.skip_hint":
    "Quand défini, Claude évalue avant chaque exécution et peut décider de ne pas publier. Laisser vide pour toujours publier.",
  "home.scheduled.context_hint":
    "Claude génère le contenu à chaque exécution. Le bot doit être membre du canal sélectionné.",
  "home.scheduled.send_now": "Envoyer maintenant",
  "home.scheduled.send_confirm_title": "Envoyer maintenant ?",
  "home.scheduled.send_confirm_text":
    "Ceci exécute le message programmé immédiatement. La programmation régulière n'est pas affectée.",
  "home.scheduled.disable": "Désactiver",
  "home.scheduled.enable": "Activer",
  "home.scheduled.delete_confirm_title": "Supprimer le message programmé ?",
  "home.scheduled.delete_confirm_text": "Ceci supprimera définitivement ce message programmé.",

  // ─── Action buttons ────────────────────────────────────────────────
  "blocks.action_label_choice": "Sélectionner",
  "blocks.action_label_followup": "Continuer",
  "blocks.action_label_post_to": "Publier dans le fil",
  "blocks.action_label_change": "Démarrer le changement",
  "blocks.action_label_config_update": "Appliquer la modification",
  "blocks.action_label_update": "Mettre à jour",

  // ─── Error blocks ──────────────────────────────────────────────────
  "blocks.crash_error": ":warning: Claude semble avoir crashé, vous pouvez réessayer.",
  "blocks.try_again_button": "🔄 Réessayer",

  // ─── Worker quarantine DM ──────────────────────────────────────────
  "changes.quarantine.trigger_release": "fin de PR",
  "changes.quarantine.trigger_branch_switch": "changement de branche",
  "changes.quarantine.trigger_idle_release": "passage de libération à l'inactivité",
  "changes.quarantine.title": ":warning: Worker `{workerId}` en quarantaine",
  "changes.quarantine.repo": "*Dépôt :* {repo}",
  "changes.quarantine.branch": "*Branche :* {branch}",
  "changes.quarantine.trigger": "*Déclencheur :* {trigger}",
  "changes.quarantine.dirty_header": "*Fichiers suivis modifiés ({count}) :*",
  "changes.quarantine.more_files": "\n…et {n} de plus",
  "changes.quarantine.footer":
    "Le worker est exclu des acquisitions jusqu'à résolution. Annulez les changements via le bouton « Annuler & restaurer » de l'onglet Accueil (ou retirez `.clack-quarantine.json` de `{path}` manuellement) une fois votre décision prise.",
  "changes.quarantine.branch_detached": "(détaché)",

  // ─── Change-workflow queue / failure messages ──────────────────────
  "changes.queue.next_in_line":
    ":hourglass_flowing_sand: En attente d'un worker sur `{repo}` — prochain dans la file.",
  "changes.queue.queued_at":
    ":hourglass_flowing_sand: En file (position {position}) pour un worker sur `{repo}`.",
  "changes.create_workspace_failed": "Échec de création du workspace : {error}",

  // ─── Migration-failure admin DM ────────────────────────────────────
  "migrations.admin_dm":
    ":warning: *Migration échouée : {name}* (v{version})\n\n{error}\n\nConsultez les logs pour les détails et redémarrez Clack après avoir résolu le problème.",

  // ─── Handler error toasts ──────────────────────────────────────────
  "errors.session_expired": "Désolé, la session a expiré. Veuillez relancer une nouvelle requête.",
  "errors.resend_sent": "Le message a été renvoyé.",
  "errors.no_active_session": "Aucune session active trouvée pour ce fil.",
  "errors.change_failed_unexpectedly":
    "La demande de changement a échoué de façon inattendue : {error}",
  "errors.change_permission_denied":
    "Vous n'avez pas la permission de démarrer des changements. Rôle dev requis ou supérieur.",
  "errors.change_expired": "Désolé, cette demande de changement a expiré. Veuillez réessayer.",
  "errors.mention_no_question":
    "Bonjour ! Veuillez inclure une question en me mentionnant, ou mentionnez-moi dans un fil pour que je lise la conversation.",
  "errors.config_updated": "Le fichier de configuration `{file}` a été mis à jour.",
  "errors.config_update_failed": "Échec de mise à jour de `{file}` : {error}",
  "errors.auto_execute_failed": "Échec de l'exécution automatique : {error}",
  "errors.auto_post_no_content":
    "Publication automatique impossible : contenu de la réponse introuvable.",
  "errors.auto_post_failed": "Échec de publication : {error}",

  // ─── Slack Assistant ───────────────────────────────────────────────
  "assistant.greeting": "Bonjour ! Posez-moi n'importe quelle question sur le code.",
  "assistant.thinking_status": "Réflexion…",
  "assistant.prompt_check_recent_title": "Vérifier les messages récents",
  "assistant.prompt_check_recent_message":
    "Vérifie les messages récents du canal et résume ce qui se discute",
  "assistant.prompt_debug_title": "Déboguer un truc",
  "assistant.prompt_debug_message": "Aide-moi à déboguer un truc dans le code",
  "assistant.prompt_funny_title": "Raconte quelque chose de drôle",
  "assistant.prompt_funny_message": "Raconte-moi quelque chose de drôle sur le code",
  "assistant.fallback_image_only": "Réponds à partir de l'image (ou des images) jointe(s).",

  // ─── DM-first reaction synthesis ───────────────────────────────────
  "dm.synthesis.accept": "Accepter",
  "dm.synthesis.edit": "Modifier",
  "dm.synthesis.reject": "Rejeter",
  "dm.synthesis.update_original": "Mettre à jour la publication d'origine",
  "dm.synthesis.post_new": "Publier une nouvelle réponse",
  "dm.synthesis.cancel": "Annuler",
};
