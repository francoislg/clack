export const en = {
  // ─── Self-test (used by t.test.ts and parity.test.ts) ──────────────
  "_selftest.plain": "Localization helper is wired up.",
  "_selftest.one_var": "Hello, {name}!",
  "_selftest.two_vars": "Repo {repo} on branch {branch}.",
  "_selftest.numeric": "Count: {count}",
  "_selftest.missing_in_fr": "This key intentionally has no FR translation.",

  // ─── Common labels reused across the UI ────────────────────────────
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.back": "Back",
  "common.edit": "Edit",
  "common.delete": "Delete",
  "common.create": "Create",
  "common.submit": "Submit",
  "common.remove": "Remove",
  "common.none": "_None_",
  "common.none_paren": "_(none)_",

  // ─── Home Tab: migration banner ────────────────────────────────────
  "home.migration.title": ":warning: *Migration Error*",
  "home.migration.entry": "• *{name}* (v{version}): {error}",
  "home.migration.admin_hint":
    "_Check the logs for details and restart Clack after resolving the issue._",

  // ─── Home Tab: role badge ──────────────────────────────────────────
  "home.role.system": "System",
  "home.role.owner": "Owner",
  "home.role.admin": "Admin",
  "home.role.dev": "Dev",
  "home.role.member": "Member",
  "home.role.badge": "{emoji} *Your Role:* {label}",

  // ─── Home Tab: claim ownership ─────────────────────────────────────
  "home.ownership.disabled_owner":
    ":warning: The current owner is inactive. As an admin, you can claim ownership.",
  "home.ownership.no_owner":
    ":wave: *Welcome!* This bot has no owner yet. Claim ownership to manage it.",
  "home.ownership.claim_button": "Claim Ownership",

  // ─── Home Tab: role management ─────────────────────────────────────
  "home.roles.header": "Role Management",
  "home.roles.owner_line": ":crown: *Owner:* {mention}",
  "home.roles.transfer_button": "Transfer",
  "home.roles.admins_line": ":shield: *Admins:* {list}",
  "home.roles.devs_line": ":computer: *Devs:* {list}",
  "home.roles.add_admin": "+ Add Admin",
  "home.roles.remove_admin": "- Remove Admin",
  "home.roles.add_dev": "+ Add Dev",
  "home.roles.remove_dev": "- Remove Dev",

  // ─── Home Tab: configuration section ───────────────────────────────
  "home.config.header": "Configuration",
  "home.config.edit_role_button": "{prefix}Edit {label}",
  "home.config.edit_pre_analysis_button": "{prefix}Edit Pre-Analysis Context",
  "home.config.edit_repo_button": ":file_folder: Edit {repo} Config",
  "home.config.personal_preferences_button": ":gear: Personal Preferences",
  "home.config.chat_hint":
    "_Chat with me to edit core config files (config.json, mcp.json, .env, tool mappings) or restart the app._",
  "home.config.role_suffix": "Config",
  "home.config.too_large": "_Too large for modal editor_",
  "home.config.chat_to_edit": "Chat to Edit",
  "home.config.create_new_file": "+ Create New File",
  "home.config.instructions_title": "{dir}/ Instructions",
  "home.config.default_only": "_Default — no custom override_",
  "home.config.content_label": "Content",
  "home.config.reset_to_default": "Reset to Default",
  "home.config.delete_file": "Delete File",
  "home.config.create_override": "Create Override",
  "home.config.create_new_file_title": "Create New File",
  "home.config.filename_label": "Filename",
  "home.config.filename_placeholder": "my-instructions",
  "home.config.filename_hint": ".md extension is added automatically",
  "home.config.content_placeholder": "Enter instruction content...",

  // ─── Home Tab: status section ──────────────────────────────────────
  "home.status.header": "Status",
  "home.status.repositories_block": ":file_folder: *Repositories:*\n{list}",
  "home.status.repo_access_writable": "_read: {read} · write: {write}_",
  "home.status.repo_access_readonly": "_read: {read} · read-only_",
  "home.status.access_all": "all",
  "home.status.access_plus": "{role}+",
  "home.status.mcp_servers_block":
    ":electric_plug: *MCP Servers:*\n• *Always loaded:* {always}\n• *On demand:* {onDemand}",
  "home.status.skill_plugins_block": ":jigsaw: *Skill Plugins:*\n{sections}",
  "home.status.skill_eager_section": "_Eager (always loaded):_\n{list}",
  "home.status.skill_lazy_section": "_Lazy (on-demand via load_skill):_\n{list}",
  "home.status.skill_plugin_entry": "• *{name}*{suffix}",
  "home.status.skill_count_suffix": " ({count} skills)",
  "home.status.clack_plugins_block": ":package: *Plugins:*\n{list}",
  "home.status.clack_plugin_entry": "• *{name}* ({count} tools)",
  "home.status.trigger_methods": ":zap: *Trigger Methods:* {methods}",
  "home.status.trigger_reaction": ":{emoji}: Reaction",
  "home.status.trigger_dm": ":speech_balloon: Direct Messages",
  "home.status.trigger_mention": ":mega: @Mentions",

  // ─── Home Tab: workers section ─────────────────────────────────────
  "home.workers.header": "Workers",
  "home.workers.no_active_changes": "_No active change requests._",
  "home.workers.no_workers_yet":
    "_No workers provisioned yet — first change request will create one._",
  "home.workers.no_workers_for_repo":
    "_No workers yet for this repo — will provision on first acquire._",
  "home.workers.status_line": "• Status: {label}",
  "home.workers.branch_line": "• Branch: `{branch}`",
  "home.workers.repo_line": "• Repo: {repo}",
  "home.workers.by_line": "• By: {by}",
  "home.workers.auto_respond_label": "Auto-Respond",
  "home.workers.thread_line": "• Thread: <{url}|View thread>",
  "home.workers.pr_line": "\n• PR: <{url}|View PR>",
  "home.workers.counts":
    ":large_green_circle: {idle} idle · :hammer_and_wrench: {busy} busy · :hourglass_flowing_sand: {init} initializing · :warning: {quar} quarantined · :x: {failed} failed · :bookmark_tabs: {queued} queued",
  "home.workers.detached": "(detached)",
  "home.workers.session_suffix": " · session `{id}`",
  "home.workers.setup_incomplete_suffix": " · setup not complete",
  "home.workers.worker_line":
    "{emoji} `{id}` · {status} · branch `{branch}`{claimed}{setup} · last used {when}",
  "home.workers.discard_restore": "Discard & restore",
  "home.workers.discard_title": "Discard local changes?",
  "home.workers.discard_text":
    "This runs `git reset --hard HEAD` and `git clean -fd` on `{id}`. Uncommitted changes will be lost.",
  "home.workers.discard_confirm": "Discard",
  "home.workers.queued_entry":
    ":bookmark_tabs: queued: branch `{branch}` · session `{session}` · since {when}",

  // ─── Home Tab: help section ────────────────────────────────────────
  "home.help.header": "Help",
  "home.help.how_to_use": "*How to use this bot:*",
  "home.help.reaction": "• *Reaction:* React to any message with :{emoji}: to ask about it",
  "home.help.dm": "• *Direct Message:* Send me a DM with your question",
  "home.help.mention": "• *Mention:* @mention me in any channel with your question",
  "home.help.stop":
    "• *Stop:* React with :{emoji}: (or type it inline in a short message) to cancel current work and silence me in a thread",
  "home.help.context": "_I analyze your codebase and answer questions in plain language._",

  // ─── Home Tab: settings modal ──────────────────────────────────────
  "home.settings.title": "Settings",
  "home.settings.delivery_label":
    "*Reaction delivery*\nHow would you like to receive answers when you react with the trigger emoji?",
  "home.settings.delivery_dm_label": "Direct Message",
  "home.settings.delivery_dm_description": "Get a private DM thread to refine before sharing.",
  "home.settings.delivery_thread_label": "Thread",
  "home.settings.delivery_thread_description": "Answer posted directly in the channel thread.",
  "home.settings.notify_label":
    "*Response notification*\nIf the response takes longer than 60 seconds, post a follow-up message so you get a Slack notification?",
  "home.settings.notify_on_label": "On",
  "home.settings.notify_on_description":
    "If the response takes longer than 60 seconds, post a follow-up so you get a Slack notification.",
  "home.settings.notify_off_label": "Off",
  "home.settings.notify_off_description": "No extra message — just the streamed answer.",

  // ─── Home Tab: user select / remove modals ─────────────────────────
  "home.user_select.label": "Select User",
  "home.user_remove.prompt": "Select a user to remove:",
  "home.user_remove.placeholder": "Select user to remove",
  "home.user_remove.label": "User",

  // ─── Home Tab: auto-respond ────────────────────────────────────────
  "home.auto_respond.header": "Auto-Respond",
  "home.auto_respond.empty": "_No auto-respond rules configured._",
  "home.auto_respond.paused_suffix": " _(paused)_",
  "home.auto_respond.pre_analysis_suffix": " · Pre-analysis",
  "home.auto_respond.keywords_suffix": " · Keywords: {list}",
  "home.auto_respond.add_rule": "+ Add Rule",
  "home.auto_respond.modal_title_edit": "Edit Rule",
  "home.auto_respond.modal_title_add": "Add Rule",
  "home.auto_respond.channels_label": "Channels",
  "home.auto_respond.channels_placeholder": "Select channels to watch",
  "home.auto_respond.users_label": "Filter by users/bots (optional)",
  "home.auto_respond.users_placeholder": "Leave empty to match all messages",
  "home.auto_respond.keywords_label": "Keywords (optional)",
  "home.auto_respond.keywords_placeholder": "e.g., CRITICAL, timeout, OOM — comma-separated",
  "home.auto_respond.extra_context_label": "Extra context (optional)",
  "home.auto_respond.extra_context_placeholder":
    "e.g., This is a Sentry error alert. Focus on the stack trace and find the relevant code path.",
  "home.auto_respond.pre_analysis_label": "Pre-analysis context (optional)",
  "home.auto_respond.pre_analysis_placeholder":
    "e.g., Only respond if this is an actionable error — leave empty to skip pre-analysis",
  "home.auto_respond.pre_analysis_hint":
    "When set, a fast AI check determines if the message is worth responding to before launching a full response.",
  "home.auto_respond.context_hint":
    "The bot must be a member of selected channels to receive messages.",
  "home.auto_respond.disable_rule": "Disable Rule",
  "home.auto_respond.enable_rule": "Enable Rule",
  "home.auto_respond.delete_rule": "Delete Rule",
  "home.auto_respond.delete_confirm_title": "Delete rule?",
  "home.auto_respond.delete_confirm_text": "This will permanently remove this auto-respond rule.",

  // ─── Home Tab: scheduled messages ──────────────────────────────────
  "home.scheduled.header": "Scheduled Messages",
  "home.scheduled.plugin_header": "Plugin Scheduled Messages",
  "home.scheduled.plugin_hint":
    "Read-only — these are reconciled from plugin config. Edit `data/config.json` to change schedule/prompt; pause/resume from here.",
  "home.scheduled.paused_suffix": " _(paused)_",
  "home.scheduled.skipped_suffix": " _(last run skipped)_",
  "home.scheduled.one_time_suffix": " · _one-time_",
  "home.scheduled.plugin_suffix": " · _plugin: {plugin}_",
  "home.scheduled.pause": "Pause",
  "home.scheduled.resume": "Resume",
  "home.scheduled.modal_title_edit": "Edit Schedule",
  "home.scheduled.modal_title_add": "Add Schedule",
  "home.scheduled.name_label": "Name",
  "home.scheduled.name_placeholder": "e.g. Morning PR roundup",
  "home.scheduled.name_hint": "Short label shown in the Home Tab and tool task cards (1-80 chars).",
  "home.scheduled.channel_label": "Channel",
  "home.scheduled.channel_placeholder": "Select a channel",
  "home.scheduled.cron_label": "Cron Expression",
  "home.scheduled.cron_placeholder": "e.g. 0 9 * * * (daily at 9am)",
  "home.scheduled.cron_hint": "5-field cron: minute hour day-of-month month day-of-week",
  "home.scheduled.prompt_label": "Prompt (dynamic content)",
  "home.scheduled.prompt_placeholder":
    "What should Claude do? e.g. Summarize merged PRs from today",
  "home.scheduled.skip_label": "Skip conditions (optional)",
  "home.scheduled.skip_placeholder": "e.g. Skip if no PRs were merged in the last 24 hours",
  "home.scheduled.skip_hint":
    "When set, Claude evaluates these before each run and may skip posting. Leave empty to always post.",
  "home.scheduled.context_hint":
    "Claude will generate content each time this runs. The bot must be a member of the selected channel.",
  "home.scheduled.send_now": "Send Now",
  "home.scheduled.send_confirm_title": "Send now?",
  "home.scheduled.send_confirm_text":
    "This will execute the scheduled message immediately. The regular schedule is not affected.",
  "home.scheduled.disable": "Disable",
  "home.scheduled.enable": "Enable",
  "home.scheduled.delete_confirm_title": "Delete scheduled message?",
  "home.scheduled.delete_confirm_text": "This will permanently remove this scheduled message.",
  "home.scheduled.plugin_modal_title": "Plugin Schedule",
  "home.scheduled.plugin_modal_intro":
    "Read-only — this scheduled message is reconciled from plugin config. To change the schedule or prompt, edit `data/config.json`.",
  "home.scheduled.plugin_pause_explanation":
    "Pausing stops this schedule from firing until you resume it. The plugin config is unchanged — the next reconcile will not bring it back.",

  // ─── Action buttons (default labels for submit_response actions) ───
  "blocks.action_label_choice": "Select",
  "blocks.action_label_followup": "Continue",
  "blocks.action_label_post_to": "Post to thread",
  "blocks.action_label_change": "Start Change",
  "blocks.action_label_config_update": "Apply Update",
  "blocks.action_label_update": "Update",

  // ─── Error blocks ──────────────────────────────────────────────────
  "blocks.crash_error": ":warning: Claude seems to have crashed, maybe try again?",
  "blocks.try_again_button": "🔄 Try Again",

  // ─── Worker quarantine DM ──────────────────────────────────────────
  "changes.quarantine.trigger_release": "PR completion",
  "changes.quarantine.trigger_branch_switch": "branch switch",
  "changes.quarantine.trigger_idle_release": "idle-release sweep",
  "changes.quarantine.title": ":warning: Worker `{workerId}` quarantined",
  "changes.quarantine.repo": "*Repo:* {repo}",
  "changes.quarantine.branch": "*Branch:* {branch}",
  "changes.quarantine.trigger": "*Trigger:* {trigger}",
  "changes.quarantine.dirty_header": "*Dirty tracked files ({count}):*",
  "changes.quarantine.more_files": "\n…and {n} more",
  "changes.quarantine.footer":
    'The worker is excluded from acquire until cleared. Discard the changes via the Home Tab "Discard & restore" button (or remove `.clack-quarantine.json` from `{path}` manually) once you\'ve decided what to do.',
  "changes.quarantine.branch_detached": "(detached)",

  // ─── Change-workflow queue / failure messages ──────────────────────
  "changes.queue.next_in_line":
    ":hourglass_flowing_sand: Waiting for a worker on `{repo}` — next in line.",
  "changes.queue.queued_at":
    ":hourglass_flowing_sand: Queued at position {position} for a worker on `{repo}`.",
  "changes.create_workspace_failed": "Failed to create workspace: {error}",

  // ─── Migration-failure admin DM ────────────────────────────────────
  "migrations.admin_dm":
    ":warning: *Migration failed: {name}* (v{version})\n\n{error}\n\nCheck the logs for details and restart Clack after resolving the issue.",

  // ─── Handler error toasts ──────────────────────────────────────────
  "errors.session_expired": "Sorry, the session has expired. Please start a new query.",
  "errors.resend_sent": "The message was sent again.",
  "errors.no_active_session": "Could not find an active session for this thread.",
  "errors.change_failed_unexpectedly": "Change request failed unexpectedly: {error}",
  "errors.change_permission_denied":
    "You don't have permission to start changes. Requires dev role or higher.",
  "errors.change_expired": "Sorry, this change request has expired. Please try again.",
  "errors.mention_no_question":
    "Hi! Please include a question when mentioning me, or tag me in a thread and I'll read the conversation.",
  "errors.config_updated": "Configuration file `{file}` has been updated.",
  "errors.config_update_failed": "Failed to update `{file}`: {error}",
  "errors.auto_execute_failed": "Auto-execute failed: {error}",
  "errors.auto_post_no_content": "Could not auto-post: response content was not found.",
  "errors.auto_post_failed": "Failed to post: {error}",

  // ─── User-created skills ───────────────────────────────────────────
  "userSkills.created": "Skill `{slug}` has been created.",
  "userSkills.create_failed": "Failed to create skill `{slug}`: {error}",
  "userSkills.updated": "Skill `{slug}` has been updated.",
  "userSkills.update_failed": "Failed to update skill `{slug}`: {error}",
  "userSkills.disabled": "Skill `{slug}` has been disabled.",
  "userSkills.disable_failed": "Failed to disable skill `{slug}`: {error}",
  "userSkills.restored": "Skill `{slug}` has been restored.",
  "userSkills.restore_failed": "Failed to restore skill `{slug}`: {error}",
  "userSkills.permission_denied":
    "You don't have permission to edit skill `{slug}`. Only the owner or an admin can edit.",
  "userSkills.expired": "Sorry, this skill request has expired. Please try again.",
  "userSkills.section_header": "Skills",
  "userSkills.section_subheader": "Org-authored skills available to Claude in every session.",
  "userSkills.empty_state": "No user skills yet. Click *+ Create skill* to add the first one.",
  "userSkills.create_button": "+ Create skill",
  "userSkills.edit_button": "Edit",
  "userSkills.disable_button": "Disable",
  "userSkills.restore_button": "Restore",
  "userSkills.disabled_badge": "(disabled)",
  "userSkills.owner_label": "Owner",
  "userSkills.modal_create_title": "Create skill",
  "userSkills.modal_edit_title": "Edit skill",
  "userSkills.modal_name_label": "Name",
  "userSkills.modal_name_placeholder": "lowercase-with-hyphens",
  "userSkills.modal_name_hint":
    "1-64 chars, lowercase a-z/0-9/hyphens. Cannot start/end with a hyphen or contain `--`.",
  "userSkills.modal_description_label": "When to use",
  "userSkills.modal_description_hint":
    "Trigger description (max 1024 chars). Tells Claude when this skill is the right fit.",
  "userSkills.modal_body_label": "Body",
  "userSkills.modal_body_hint":
    "The full SKILL.md content (markdown). Loaded on demand when Claude reaches for this skill.",
  "userSkills.modal_body_too_long":
    ":warning: *Body is {length} chars — too long to edit in this modal (max {max}).* Ask Clack to edit it instead (e.g. DM Clack: _“update the `<slug>` skill body to…”_). Saving here will only update the description; the body will be preserved.",
  "userSkills.label.creating": "Creating skill `{slug}`",
  "userSkills.label.updating": "Updating skill `{slug}`",
  "userSkills.label.disabling": "Disabling skill `{slug}`",
  "userSkills.label.restoring": "Restoring skill `{slug}`",
  "userSkills.label.listing": "Listing user skills",
  "userSkills.label.loading": "Loading skill `{slug}`",

  // ─── Slack Assistant ───────────────────────────────────────────────
  "assistant.greeting": "Hi! Ask me anything about the codebase.",
  "assistant.thinking_status": "Thinking...",
  "assistant.prompt_check_recent_title": "Check recent messages",
  "assistant.prompt_check_recent_message":
    "Check the recent messages in the channel and summarize what's being discussed",
  "assistant.prompt_debug_title": "Debug something",
  "assistant.prompt_debug_message": "Help me debug something in the codebase",
  "assistant.prompt_funny_title": "Tell me something funny",
  "assistant.prompt_funny_message": "Tell me something funny about the codebase",
  "assistant.fallback_image_only": "Answer based on the attached image(s).",

  // ─── DM-first reaction synthesis ───────────────────────────────────
  "dm.synthesis.accept": "Accept",
  "dm.synthesis.edit": "Edit",
  "dm.synthesis.reject": "Reject",
  "dm.synthesis.update_original": "Update original post",
  "dm.synthesis.post_new": "Post new reply",
  "dm.synthesis.cancel": "Cancel",
} as const;

export type StringKey = keyof typeof en;
