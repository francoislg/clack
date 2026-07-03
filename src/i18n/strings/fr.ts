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
  "home.status.skill_count_suffix": " ({count} compétences)",
  "home.status.clack_plugins_block": ":package: *Plugins :*\n{list}",
  "home.status.clack_plugins_header": ":package: *Plugins :*",
  "home.status.clack_plugin_entry": "• *{name}* ({count} outils)",
  "home.status.clack_plugin_error": "{reasons}",
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
  "home.workers.auto_respond_label": "Réponse automatique",
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
  "home.auto_respond.header": "Réponse automatique",
  "home.auto_respond.conversations_header": "*Conversations suivies*",
  "home.auto_respond.conversation_level": "attention : {level}",
  "home.auto_respond.conversation_expires": "expire dans {time}",
  "home.auto_respond.conversation_dormant": "en veille — se réengagera si la conversation reprend",
  "home.auto_respond.conversation_sessions": "{count} session(s) liée(s)",
  "home.auto_respond.stop_following": "Ne plus suivre",
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
  "home.scheduled.ran_without_responses_suffix": " _(exécuté sans réponses)_",
  "home.scheduled.one_time_suffix": " · _ponctuel_",
  "home.scheduled.plugin_suffix": " · _plugin : {plugin}_",
  "home.scheduled.jitter_suffix": " · décalage : {minutes}m",
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
  "home.scheduled.jitter_label": "Décalage aléatoire (minutes, optionnel)",
  "home.scheduled.jitter_placeholder": "p.ex. 5",
  "home.scheduled.jitter_hint":
    "Étale chaque exécution d'un décalage aléatoire allant jusqu'à ce nombre de minutes après l'heure programmée, pour qu'un message récurrent ne tombe pas toujours pile à l'heure ronde. 0 ou vide = exécution exactement à l'heure. Max 30.",
  "home.scheduled.jitter_modal_label": "Décalage aléatoire",
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
  "home.scheduled.plugin_modal_title": "Programmation plugin",
  "home.scheduled.plugin_modal_intro":
    "Lecture seule — ce message programmé est réconcilié depuis la config plugin. Pour modifier la programmation ou le prompt, éditez `data/config.json`.",
  "home.scheduled.plugin_pause_explanation":
    "Mettre en pause empêche cette programmation de s'exécuter jusqu'à la reprise. La config plugin reste inchangée — la prochaine réconciliation ne la réactivera pas.",

  // ─── Action buttons ────────────────────────────────────────────────
  "blocks.action_label_choice": "Sélectionner",
  "blocks.action_label_followup": "Continuer",
  "blocks.action_label_post_to": "Publier dans le fil",
  "blocks.action_label_change": "Démarrer le changement",
  "blocks.action_label_config_update": "Appliquer la modification",
  "blocks.action_label_config_revert": "Retirer la personnalisation",
  "blocks.action_label_config_delete": "Supprimer le fichier",
  "blocks.action_label_update": "Mettre à jour",

  // ─── Error blocks ──────────────────────────────────────────────────
  "blocks.crash_error": ":warning: Claude semble avoir crashé, vous pouvez réessayer.",
  "blocks.try_again_button": "🔄 Réessayer",
  "blocks.usage_limit_error":
    "😴 Claude n'a plus d'utilisation disponible pour le moment — de retour vers {resetTime}.",
  "blocks.usage_limit_error_no_reset":
    "😴 Claude n'a plus d'utilisation disponible pour le moment — veuillez réessayer plus tard.",

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

  // ─── Owner escalation DM (submit_response.escalate_to_owner) ────────
  "owner_escalation.header": ":rotating_light: Clack a rencontré un problème et vous a prévenu",
  "owner_escalation.context": "De *{user}* dans {channel}",
  "owner_escalation.session": "Session : `{sessionId}`",

  // ─── Change-workflow queue / failure messages ──────────────────────
  "changes.queue.next_in_line":
    ":hourglass_flowing_sand: En attente d'un worker sur `{repo}` — prochain dans la file.",
  "changes.queue.queued_at":
    ":hourglass_flowing_sand: En file (position {position}) pour un worker sur `{repo}`.",
  "changes.create_workspace_failed": "Échec de création du workspace : {error}",

  // ─── Tester ("test this PR" runs) ────────────────────────────────────
  "tester.not_enabled":
    "La fonctionnalité de test n'est pas activée ou est mal configurée (voir `config.tester`).",
  "tester.sidecar_unreachable":
    ":warning: Le sidecar Playwright est injoignable à `{url}` — le test n'a pas démarré. Le conteneur `clack-playwright` est-il en marche ?",
  "tester.busy":
    ":hourglass_flowing_sand: Un test est déjà en cours. Réessayez quand il sera terminé.",
  "tester.gate_failed":
    "Le test s'est terminé sans livrer d'enregistrement ni de rapport d'état, et une tentative de reprise corrective n'a rien livré non plus. Consultez le journal d'exécution pour voir ce que le test faisait au moment de l'arrêt.",
  "homeTab.workers.testing_count": "{count} en test",

  // ─── Spinoff (split a slice into a separate sibling PR) ─────────────
  "changes.spinoff.patch_apply_failed":
    "Impossible d'appliquer les modifications détachées depuis `{path}` : {error}. Le correctif y a été conservé pour récupération.",
  "changes.spinoff.sibling_thread_intro":
    ":scissors: Détachement d'un changement distinct : *{description}* (`{branch}`)",
  "changes.spinoff.posted_in_parent":
    ":scissors: *{description}* a été détaché vers un changement distinct → {link}",
  "changes.spinoff.spun_off_from": "Détaché depuis {link}",

  // ─── Failed-change recovery ────────────────────────────────────────
  "changes.recovery.prompt":
    "Vous pouvez reprendre ce changement là où il s'est arrêté, le recommencer à zéro (le travail en cours sera jeté), ou l'abandonner et libérer le workspace.",
  "changes.recovery.continue_button": "♻️ Reprendre",
  "changes.recovery.start_over_button": "🔄 Recommencer (jette le travail)",
  "changes.recovery.discard_button": "🗑️ Abandonner",

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
  "errors.config_override_removed":
    "La personnalisation de `{file}` a été retirée ; le fichier utilise maintenant la valeur par défaut.",
  "errors.config_file_deleted": "`{file}` a été supprimé.",
  "errors.config_delete_failed": "Échec de suppression de `{file}` : {error}",
  "errors.auto_execute_failed": "Échec de l'exécution automatique : {error}",
  "errors.auto_post_no_content":
    "Publication automatique impossible : contenu de la réponse introuvable.",
  "errors.auto_post_failed": "Échec de publication : {error}",

  // ─── Compétences créées par l'utilisateur ──────────────────────────
  "userSkills.created": "La compétence `{slug}` a été créée.",
  "userSkills.create_failed": "Échec de création de la compétence `{slug}` : {error}",
  "userSkills.updated": "La compétence `{slug}` a été mise à jour.",
  "userSkills.update_failed": "Échec de mise à jour de la compétence `{slug}` : {error}",
  "userSkills.disabled": "La compétence `{slug}` a été désactivée.",
  "userSkills.disable_failed": "Échec de désactivation de la compétence `{slug}` : {error}",
  "userSkills.restored": "La compétence `{slug}` a été restaurée.",
  "userSkills.restore_failed": "Échec de restauration de la compétence `{slug}` : {error}",
  "userSkills.deleted": "La compétence `{slug}` a été supprimée définitivement.",
  "userSkills.delete_failed": "Échec de suppression de la compétence `{slug}` : {error}",
  "userSkills.permission_denied":
    "Vous n'avez pas la permission de modifier la compétence `{slug}`. Seul le propriétaire ou un administrateur peut la modifier.",
  "userSkills.expired": "Désolé, cette demande de compétence a expiré. Veuillez réessayer.",
  "userSkills.section_header": "Compétences",
  "userSkills.section_subheader":
    "Compétences créées par l'organisation, disponibles à Claude dans chaque session.",
  "userSkills.empty_state":
    "Aucune compétence pour l'instant. Cliquez sur *+ Créer une compétence* pour en ajouter une.",
  "userSkills.create_button": "+ Créer une compétence",
  "userSkills.edit_button": "Modifier",
  "userSkills.disable_button": "Désactiver",
  "userSkills.restore_button": "Restaurer",
  "userSkills.disable_confirm_text": "Désactiver `{slug}` ?",
  "userSkills.delete_button": "Supprimer",
  "userSkills.delete_confirm_title": "Supprimer la compétence ?",
  "userSkills.delete_confirm_text":
    "Supprimer définitivement `{slug}` ? Ses fichiers seront effacés et l'action est irréversible.",
  "userSkills.disabled_badge": "(désactivée)",
  "userSkills.editable_badge": "(modifiable par tous)",
  "userSkills.owner_label": "Propriétaire",
  "userSkills.modal_create_title": "Créer une compétence",
  "userSkills.modal_edit_title": "Modifier la compétence",
  "userSkills.modal_name_label": "Nom",
  "userSkills.modal_name_placeholder": "minuscules-avec-tirets",
  "userSkills.modal_name_hint":
    "1-64 caractères, minuscules a-z/0-9/tirets. Ne peut commencer/terminer par un tiret ni contenir `--`.",
  "userSkills.modal_description_label": "Quand l'utiliser",
  "userSkills.modal_description_hint":
    "Description du déclencheur (max 1024 caractères). Indique à Claude quand cette compétence est appropriée.",
  "userSkills.modal_body_label": "Contenu",
  "userSkills.modal_body_hint":
    "Le contenu complet du SKILL.md (markdown). Chargé à la demande quand Claude utilise cette compétence.",
  "userSkills.modal_body_too_long":
    ":warning: *Le contenu fait {length} caractères — trop long pour être édité dans ce modal (max {max}).* Demandez plutôt à Clack de le modifier (ex. DM à Clack : _« mets à jour le contenu de la compétence `<slug>` pour… »_). Enregistrer ici ne mettra à jour que la description ; le contenu sera préservé.",
  "userSkills.modal_editable_label": "Autorisations",
  "userSkills.modal_editable_option":
    "Autoriser tout le monde à modifier le contenu de cette compétence",
  "userSkills.modal_editable_hint":
    "Une fois activé, tout membre peut modifier la description et le contenu. La désactivation, la restauration et ce réglage restent réservés au propriétaire/admin.",
  "userSkills.label.creating": "Création de la compétence `{slug}`",
  "userSkills.label.updating": "Mise à jour de la compétence `{slug}`",
  "userSkills.label.disabling": "Désactivation de la compétence `{slug}`",
  "userSkills.label.restoring": "Restauration de la compétence `{slug}`",
  "userSkills.label.listing": "Liste des compétences utilisateur",
  "userSkills.label.loading": "Chargement de la compétence `{slug}`",

  // ─── Slack Assistant ───────────────────────────────────────────────
  "assistant.greeting": "Bonjour ! Posez-moi n'importe quelle question sur le code.",
  "assistant.thinking_status": "Réflexion…",
  "assistant.prompt_check_recent_title": "Vérifier les messages récents",
  "assistant.prompt_check_recent_message":
    "Vérifie les messages récents du canal et résume ce qui se discute",
  "assistant.prompt_capabilities_title": "Que peux-tu faire...?",
  "assistant.prompt_capabilities_message":
    "Que peux-tu faire ? Regarde les outils dont tu disposes et donne-moi un résumé concis et global des principales choses pour lesquelles tu peux m'aider.",
  "assistant.prompt_debug_title": "Aide-moi à déboguer un problème",
  "assistant.prompt_debug_message":
    "Aide-moi à déboguer un problème. Pose-moi des questions générales pour comprendre ce qui ne va pas avant de creuser.",
  "assistant.prompt_funny_title": "Écris-moi une blague",
  "assistant.prompt_funny_message": "Écris-moi une blague.",
  "assistant.fallback_image_only": "Réponds à partir de l'image (ou des images) jointe(s).",

  // ─── Streaming task card ───────────────────────────────────────────
  "streamer.acknowledged": "Bien reçu, je m'en occupe…",
  "streamer.continuing": "Reprise du flux précédent…",

  // ─── DM-first reaction synthesis ───────────────────────────────────
  "dm.synthesis.accept": "Accepter",
  "dm.synthesis.edit": "Modifier",
  "dm.synthesis.reject": "Rejeter",
  "dm.synthesis.update_original": "Mettre à jour la publication d'origine",
  "dm.synthesis.post_new": "Publier une nouvelle réponse",
  "dm.synthesis.cancel": "Annuler",

  // ─── DM action notices & confirmations ─────────────────────────────
  "dm.session_expired": "Désolé, cette session a expiré. Veuillez réessayer.",
  "dm.stale_button":
    ":warning: Ce bouton provient d'une réponse plus ancienne et ne peut plus être publié. Redemandez à Clack pour obtenir une nouvelle copie.",
  "dm.answer_shared": ":white_check_mark: Réponse partagée.",
  "dm.post_failed": ":warning: Échec de la publication. Le bot n'a peut-être pas accès à ce canal.",
  "dm.answer_posted":
    ":white_check_mark: Réponse publiée dans le canal. Vous pouvez continuer à l'affiner ici au besoin.",
  "dm.edit_expired": "Désolé, cette session a expiré ou n'a aucune réponse à modifier.",
  "dm.edit_modal_title": "Modifier avant de partager",
  "dm.edit_modal_submit": "Partager",
  "dm.edit_modal_answer_label": "Réponse",
  "dm.edited_posted": ":white_check_mark: Réponse modifiée publiée dans le fil d'origine.",
  "dm.discarded": "Compris, abandonné.",
  "dm.original_updated": ":white_check_mark: Publication d'origine mise à jour.",
  "dm.new_reply_posted": ":white_check_mark: Nouvelle réponse publiée dans le fil d'origine.",

  // ─── Change-action & config-update notices ─────────────────────────
  "errors.change_action_permission_denied":
    "Vous n'avez pas la permission d'effectuer des actions de modification. Rôle dev ou supérieur requis.",
  "errors.change_action_expired": "Désolé, cette action a expiré. Veuillez réessayer.",
  "errors.no_active_change_thread": "Aucune modification active dans ce fil.",
  "errors.config_update_permission_denied":
    "Vous n'avez pas la permission de modifier la configuration. Rôle admin ou supérieur requis.",
  "errors.config_update_request_expired":
    "Désolé, cette demande de mise à jour de configuration a expiré. Veuillez réessayer.",
  "errors.message_read_failed":
    "Désolé, je n'ai pas pu lire le message. Assurez-vous que je suis invité dans ce canal.",

  // ─── Error report (DM) ─────────────────────────────────────────────
  "errors.report_header": "⚠️ Rapport d'erreur",
  "errors.report_body": "Une erreur est survenue lors du traitement de votre demande.",
  "errors.report_fallback":
    "Rapport d'erreur - Une erreur est survenue lors du traitement de votre demande.",
  "errors.report_session_id_label": "ID de session :",
  "errors.report_error_label": "Erreur :",
  "errors.report_analysis_label": "Analyse :",

  // ─── Post-response follow-up nudge ─────────────────────────────────
  "response.ready_followup": "Réponse prête ! Besoin d'autre chose ?",

  // ─── Streaming task-card titles ────────────────────────────────────
  "streamer.analyzing": "Analyse en cours…",
  "streamer.working_on": "Travail sur {branch}",
  "streamer.testing": "Test de {branch}",
  "streamer.tool_label_checking": "Vérification de {name}",
  "streamer.tool_label_running": "Exécution de {tool}",

  // ─── Scheduled reminder attribution ────────────────────────────────
  "reminder.attribution_prefix": "🔔 Rappel de {user} :",
};
