# Graph Report - claude-slack-bot  (2026-07-02)

## Corpus Check
- 688 files · ~791,948 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 10220 nodes · 17885 edges · 961 communities (688 shown, 273 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 105 edges (avg confidence: 0.68)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a6393049`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_srctools logger.ts|src/tools: logger.ts]]
- [[_COMMUNITY_trivia plugin|trivia plugin]]
- [[_COMMUNITY_CLAUDE.md Clack (Claude + Slack Bot)|CLAUDE.md: Clack (Claude + Slack Bot)]]
- [[_COMMUNITY_srcslack handlerResponse.ts|src/slack: handlerResponse.ts]]
- [[_COMMUNITY_srcslack t()|src/slack: t()]]
- [[_COMMUNITY_srcworkers errorMessage()|src/workers: errorMessage()]]
- [[_COMMUNITY_idler plugin|idler plugin]]
- [[_COMMUNITY_srcclaude main()|src/claude: main()]]
- [[_COMMUNITY_memoryRegistry roles.ts|memoryRegistry: roles.ts]]
- [[_COMMUNITY_commons-image-search plugin|commons-image-search plugin]]
- [[_COMMUNITY_srcstreaming lifecycle.ts|src/streaming: lifecycle.ts]]
- [[_COMMUNITY_sessions sessions.ts|sessions: sessions.ts]]
- [[_COMMUNITY_misc Zod schema validation|misc: Zod schema validation]]
- [[_COMMUNITY_cronJobs cronJobs.ts|cronJobs: cronJobs.ts]]
- [[_COMMUNITY_srcslack submitResponse.ts|src/slack: submitResponse.ts]]
- [[_COMMUNITY_trivia plugin|trivia plugin]]
- [[_COMMUNITY_srcmigrations types.ts|src/migrations: types.ts]]
- [[_COMMUNITY_srcclaude index.ts|src/claude: index.ts]]
- [[_COMMUNITY_userSkills userSkills.ts|userSkills: userSkills.ts]]
- [[_COMMUNITY_srcslack userSkillsHomeActions.ts|src/slack: userSkillsHomeActions.ts]]
- [[_COMMUNITY_configZod configZod.ts|configZod: configZod.ts]]
- [[_COMMUNITY_scriptsmigration-tests run.ts|scripts/migration-tests: run.ts]]
- [[_COMMUNITY_spec instruction-system|spec: instruction-system]]
- [[_COMMUNITY_srcstreaming SlackStreamer|src/streaming: SlackStreamer]]
- [[_COMMUNITY_misc function|misc: function]]
- [[_COMMUNITY_srctools aggregate.ts|src/tools: aggregate.ts]]
- [[_COMMUNITY_gemini-image plugin|gemini-image plugin]]
- [[_COMMUNITY_srcclaude SkillsManager|src/claude: SkillsManager]]
- [[_COMMUNITY_spec trivia-games|spec: trivia-games]]
- [[_COMMUNITY_scriptsgenerate-manifest.ts generate-manifest.|scripts/generate-manifest.ts: generate-manifest.]]
- [[_COMMUNITY_srcworkers WorkerQueue|src/workers: WorkerQueue]]
- [[_COMMUNITY_srctools envFile.ts|src/tools: envFile.ts]]
- [[_COMMUNITY_srctools proposeConfigUpdate.testHelpers.ts|src/tools: proposeConfigUpdate.testHelpers.ts]]
- [[_COMMUNITY_srctools configFieldSchemas.ts|src/tools: configFieldSchemas.ts]]
- [[_COMMUNITY_srcslack assistantContextStore.ts|src/slack: assistantContextStore.ts]]
- [[_COMMUNITY_spec streaming-responses|spec: streaming-responses]]
- [[_COMMUNITY_spec trivia-question-contexts|spec: trivia-question-contexts]]
- [[_COMMUNITY_docssetup-mcp-servers.md MCP Server Setup and|docs/setup-mcp-servers.md: MCP Server Setup and ]]
- [[_COMMUNITY_spec worker-cancellation|spec: worker-cancellation]]
- [[_COMMUNITY_srctools testHelpers.ts|src/tools: testHelpers.ts]]
- [[_COMMUNITY_README.md Claude Code Authentication|README.md: Claude Code Authentication]]
- [[_COMMUNITY_misc Changes Workflow System|misc: Changes Workflow System]]
- [[_COMMUNITY_spec auto-execute-actions|spec: auto-execute-actions]]
- [[_COMMUNITY_spec user-roles|spec: user-roles]]
- [[_COMMUNITY_spec pinned-mcp-installs|spec: pinned-mcp-installs]]
- [[_COMMUNITY_testUtils testUtils.ts|testUtils: testUtils.ts]]
- [[_COMMUNITY_trivia plugin|trivia plugin]]
- [[_COMMUNITY_spec file-upload|spec: file-upload]]
- [[_COMMUNITY_spec slack-file-attachments|spec: slack-file-attachments]]
- [[_COMMUNITY_spec trivia-cheating-detection|spec: trivia-cheating-detection]]
- [[_COMMUNITY_misc function|misc: function]]
- [[_COMMUNITY_misc function|misc: function]]
- [[_COMMUNITY_spec find-emoji-tool|spec: find-emoji-tool]]
- [[_COMMUNITY_spec github-mcp-auto-config|spec: github-mcp-auto-config]]
- [[_COMMUNITY_spec config-update-via-chat|spec: config-update-via-chat]]
- [[_COMMUNITY_spec config-update-via-chat|spec: config-update-via-chat]]
- [[_COMMUNITY_spec manifest-generation|spec: manifest-generation]]
- [[_COMMUNITY_spec owner-error-escalation|spec: owner-error-escalation]]
- [[_COMMUNITY_spec auto-respond|spec: auto-respond]]
- [[_COMMUNITY_spec slack-classic-dm|spec: slack-classic-dm]]
- [[_COMMUNITY_imagesclacknowledged-128.png Clacknowledged 12|images/clacknowledged-128.png: Clacknowledged 12]]
- [[_COMMUNITY_vitest.config.ts vitest.config.ts|vitest.config.ts: vitest.config.ts]]
- [[_COMMUNITY_scriptsmonday-oauth.mjs monday-oauth.mjs|scripts/monday-oauth.mjs: monday-oauth.mjs]]
- [[_COMMUNITY_openspecproject.md Project Context - Clack Bot|openspec/project.md: Project Context - Clack Bot]]
- [[_COMMUNITY_spec admin-config-tools|spec: admin-config-tools]]
- [[_COMMUNITY_spec admin-delete-message|spec: admin-delete-message]]
- [[_COMMUNITY_spec admin-edit-instructions|spec: admin-edit-instructions]]
- [[_COMMUNITY_spec admin-env-tools|spec: admin-env-tools]]
- [[_COMMUNITY_spec admin-role-tool|spec: admin-role-tool]]
- [[_COMMUNITY_spec app-lifecycle|spec: app-lifecycle]]
- [[_COMMUNITY_spec auto-respond-pre-analysis|spec: auto-respond-pre-analysis]]
- [[_COMMUNITY_spec auto-respond-tracking|spec: auto-respond-tracking]]
- [[_COMMUNITY_spec find-emoji-tool|spec: find-emoji-tool]]
- [[_COMMUNITY_spec find-user-tool|spec: find-user-tool]]
- [[_COMMUNITY_spec git-log-tools|spec: git-log-tools]]
- [[_COMMUNITY_spec github-app|spec: github-app]]
- [[_COMMUNITY_spec github-mcp-auto-config|spec: github-mcp-auto-config]]
- [[_COMMUNITY_spec instruction-variables|spec: instruction-variables]]
- [[_COMMUNITY_spec lazy-skill-loading|spec: lazy-skill-loading]]
- [[_COMMUNITY_spec manifest-generation|spec: manifest-generation]]
- [[_COMMUNITY_spec session-transcript-tool|spec: session-transcript-tool]]
- [[_COMMUNITY_spec skip-response|spec: skip-response]]
- [[_COMMUNITY_spec slack-channel-resolver|spec: slack-channel-resolver]]
- [[_COMMUNITY_spec streaming-responses|spec: streaming-responses]]
- [[_COMMUNITY_spec tool-label-config|spec: tool-label-config]]
- [[_COMMUNITY_spec trivia-categories|spec: trivia-categories]]
- [[_COMMUNITY_spec user-preferences|spec: user-preferences]]
- [[_COMMUNITY_spec instruction-variables|spec: instruction-variables]]
- [[_COMMUNITY_CLAUDE.md Session Persistence|CLAUDE.md: Session Persistence]]
- [[_COMMUNITY_spec config-update-via-chat|spec: config-update-via-chat]]
- [[_COMMUNITY_spec config-update-via-chat|spec: config-update-via-chat]]
- [[_COMMUNITY_spec manifest-generation|spec: manifest-generation]]
- [[_COMMUNITY_spec trivia-choice-questions|spec: trivia-choice-questions]]
- [[_COMMUNITY_spec trivia-prediction-questions|spec: trivia-prediction-questions]]
- [[_COMMUNITY_spec trivia-visual-questions|spec: trivia-visual-questions]]
- [[_COMMUNITY_spec owner-error-escalation|spec: owner-error-escalation]]
- [[_COMMUNITY_spec auto-respond|spec: auto-respond]]
- [[_COMMUNITY_spec repo-access-control|spec: repo-access-control]]
- [[_COMMUNITY_spec trivia-question-locking|spec: trivia-question-locking]]
- [[_COMMUNITY_spec trivia-post-game-buttons|spec: trivia-post-game-buttons]]
- [[_COMMUNITY_spec channel-context|spec: channel-context]]
- [[_COMMUNITY_spec attention-level|spec: attention-level]]
- [[_COMMUNITY_spec lazy-mcp-loading|spec: lazy-mcp-loading]]
- [[_COMMUNITY_spec thread-delivery-mode|spec: thread-delivery-mode]]
- [[_COMMUNITY_spec trivia-question-hints|spec: trivia-question-hints]]
- [[_COMMUNITY_spec cron-messages|spec: cron-messages]]
- [[_COMMUNITY_spec auto-respond-pre-analysis|spec: auto-respond-pre-analysis]]
- [[_COMMUNITY_spec repository-management|spec: repository-management]]
- [[_COMMUNITY_spec error-reporting|spec: error-reporting]]
- [[_COMMUNITY_spec conversation-stats|spec: conversation-stats]]
- [[_COMMUNITY_RepositoryConfig|RepositoryConfig]]
- [[_COMMUNITY_errorMessage|errorMessage]]
- [[_COMMUNITY_findRecentInteractions.ts|findRecentInteractions.ts]]
- [[_COMMUNITY_fetchChannelMessages.ts|fetchChannelMessages.ts]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_Requirement remember and recall query tools|Requirement: remember and recall query tools]]
- [[_COMMUNITY_scripts|scripts]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_blockSchema.ts|blockSchema.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_Requirement Schedule a Message|Requirement: Schedule a Message]]
- [[_COMMUNITY_configurationFiles.ts|configurationFiles.ts]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement ensure_pr Tool|Requirement: ensure_pr Tool]]
- [[_COMMUNITY_Requirement Stop Reaction Trigger|Requirement: Stop Reaction Trigger]]
- [[_COMMUNITY_Requirement Declarative Reconcile API On ClackSdk|Requirement: Declarative Reconcile API On ClackSdk]]
- [[_COMMUNITY_Requirement Inline Stop Emoji Detection|Requirement: Inline Stop Emoji Detection]]
- [[_COMMUNITY_homeTab.ts|homeTab.ts]]
- [[_COMMUNITY_lifecycle.ts|lifecycle.ts]]
- [[_COMMUNITY_Architecture|Architecture]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement t() Translation Helper|Requirement: t() Translation Helper]]
- [[_COMMUNITY_cronJobs.ts|cronJobs.ts]]
- [[_COMMUNITY_Requirement Update Auto-Respond Rule Tool|Requirement: Update Auto-Respond Rule Tool]]
- [[_COMMUNITY_Requirement questionType axis on question records and configuration|Requirement: questionType axis on question records and configuration]]
- [[_COMMUNITY_Requirement Find previous questions tool|Requirement: Find previous questions tool]]
- [[_COMMUNITY_query.ts|query.ts]]
- [[_COMMUNITY_testHelpers.ts|testHelpers.ts]]
- [[_COMMUNITY_app.ts|app.ts]]
- [[_COMMUNITY_startupBaselineSmoke.ts|startupBaselineSmoke.ts]]
- [[_COMMUNITY_Checklist|Checklist]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_userRegistry.ts|userRegistry.ts]]
- [[_COMMUNITY_Requirement upsert_season tool|Requirement: upsert_season tool]]
- [[_COMMUNITY_Requirement Invisible Lazy Display-Name Refresh|Requirement: Invisible Lazy Display-Name Refresh]]
- [[_COMMUNITY_mcp.ts|mcp.ts]]
- [[_COMMUNITY_homeTab.ts|homeTab.ts]]
- [[_COMMUNITY_Requirement Find Recent Interactions Tool|Requirement: Find Recent Interactions Tool]]
- [[_COMMUNITY_mcpServerManager.ts|mcpServerManager.ts]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement See your answer opens a private read-only verdict modal|Requirement: "See your answer" opens a private read-only verdict modal]]
- [[_COMMUNITY_Requirement seasons.json file schema|Requirement: seasons.json file schema]]
- [[_COMMUNITY_roles.ts|roles.ts]]
- [[_COMMUNITY_Requirement Instruction File Convention|Requirement: Instruction File Convention]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement `update_answers_block` MCP tool projects file state onto posted cards|Requirement: `update_answers_block` MCP tool projects file state onto posted cards]]
- [[_COMMUNITY_persistence.ts|persistence.ts]]
- [[_COMMUNITY_Requirement Scheduled Messages Section|Requirement: Scheduled Messages Section]]
- [[_COMMUNITY_Requirement Hoist-Disabled Install at Boot|Requirement: Hoist-Disabled Install at Boot]]
- [[_COMMUNITY_Requirement deliver_to Field Shape|Requirement: deliver_to Field Shape]]
- [[_COMMUNITY_Requirement contexts configuration axis|Requirement: contexts configuration axis]]
- [[_COMMUNITY_Requirement post_questions Stamps a Shared batchId on Every Item Posted in One Call|Requirement: post_questions Stamps a Shared batchId on Every Item Posted in One Call]]
- [[_COMMUNITY_Requirement load_skill Tool in Worker Mode|Requirement: load_skill Tool in Worker Mode]]
- [[_COMMUNITY_runner.ts|runner.ts]]
- [[_COMMUNITY_3. Reference|3. Reference]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_wikimedia.ts|wikimedia.ts]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement Worker Session Restoration on Startup|Requirement: Worker Session Restoration on Startup]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement add_reaction Tool|Requirement: add_reaction Tool]]
- [[_COMMUNITY_Requirement Topic-gated tool registration for management tools|Requirement: Topic-gated tool registration for management tools]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement Cascading judgeLeniency Axis|Requirement: Cascading judgeLeniency Axis]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement Clicking Tell me more removes the button and kicks off a thread conversation|Requirement: Clicking "Tell me more" removes the button and kicks off a thread conversation]]
- [[_COMMUNITY_Requirement Delivery Context in Claude Prompt|Requirement: Delivery Context in Claude Prompt]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement Installation Token Generation|Requirement: Installation Token Generation]]
- [[_COMMUNITY_Requirement Orchestrator provisions a standalone sibling change session per intent|Requirement: Orchestrator provisions a standalone sibling change session per intent]]
- [[_COMMUNITY_Clack|Clack]]
- [[_COMMUNITY_brave.ts|brave.ts]]
- [[_COMMUNITY_channelsCache.ts|channelsCache.ts]]
- [[_COMMUNITY_REMOVED Requirements|REMOVED Requirements]]
- [[_COMMUNITY_Requirement Centralized Block Validation With Friendly Errors|Requirement: Centralized Block Validation With Friendly Errors]]
- [[_COMMUNITY_Requirement DM Thread Refinement|Requirement: DM Thread Refinement]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_workerSkills.ts|workerSkills.ts]]
- [[_COMMUNITY_findGif.ts|findGif.ts]]
- [[_COMMUNITY_judge.ts|judge.ts]]
- [[_COMMUNITY_Requirement Config Update Detection|Requirement: Config Update Detection]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement Claude Prompt Formatting|Requirement: Claude Prompt Formatting]]
- [[_COMMUNITY_sdkMemory.ts|sdkMemory.ts]]
- [[_COMMUNITY_viewSlackFile.ts|viewSlackFile.ts]]
- [[_COMMUNITY_Create Tool Mapping|Create Tool Mapping]]
- [[_COMMUNITY_Requirement find_user Query Tool|Requirement: find_user Query Tool]]
- [[_COMMUNITY_Requirement Get ideas tool|Requirement: Get ideas tool]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_allowlist.ts|allowlist.ts]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement Image File Extraction|Requirement: Image File Extraction]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_pluginActionRegistry.ts|pluginActionRegistry.ts]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_Metabase Integration|Metabase Integration]]
- [[_COMMUNITY_ADDED Requirements|ADDED Requirements]]
- [[_COMMUNITY_Requirement Conditional Hidden Rules Config|Requirement: Conditional Hidden Rules Config]]
- [[_COMMUNITY_Requirement find_emoji Query Tool|Requirement: find_emoji Query Tool]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement Localized Home Tab Strings|Requirement: Localized Home Tab Strings]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement Plugin-Scoped File Watch API|Requirement: Plugin-Scoped File Watch API]]
- [[_COMMUNITY_Requirement GitHub-to-Slack Reviewer Resolution|Requirement: GitHub-to-Slack Reviewer Resolution]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement save_question replaces generate_question|Requirement: save_question replaces generate_question]]
- [[_COMMUNITY_Requirement `compute_answers` MCP tool|Requirement: `compute_answers` MCP tool]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_persistence.ts|persistence.ts]]
- [[_COMMUNITY_findPullRequests.ts|findPullRequests.ts]]
- [[_COMMUNITY_Requirement Upload Content to Slack|Requirement: Upload Content to Slack]]
- [[_COMMUNITY_Requirement update_user Field-Level Permission Gating|Requirement: update_user Field-Level Permission Gating]]
- [[_COMMUNITY_Requirement await_ci Tool|Requirement: await_ci Tool]]
- [[_COMMUNITY_createScheduledMessage.ts|createScheduledMessage.ts]]
- [[_COMMUNITY_t.ts|t.ts]]
- [[_COMMUNITY_mcpInstaller.ts|mcpInstaller.ts]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement Continue an Existing Pull Request|Requirement: Continue an Existing Pull Request]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement List Config Files Tool|Requirement: List Config Files Tool]]
- [[_COMMUNITY_Requirement Cron Job Execution|Requirement: Cron Job Execution]]
- [[_COMMUNITY_Requirement Query Wrapper Functions|Requirement: Query Wrapper Functions]]
- [[_COMMUNITY_Requirement Session Completion Monitor|Requirement: Session Completion Monitor]]
- [[_COMMUNITY_Requirement Per-season question format|Requirement: Per-season question format]]
- [[_COMMUNITY_019-trivia-games-migration.ts|019-trivia-games-migration.ts]]
- [[_COMMUNITY_userCache.ts|userCache.ts]]
- [[_COMMUNITY_Requirement Prompt Assembly|Requirement: Prompt Assembly]]
- [[_COMMUNITY_Requirement Autonomous Change Execution|Requirement: Autonomous Change Execution]]
- [[_COMMUNITY_Requirement On-Demand Cron Job Execution|Requirement: On-Demand Cron Job Execution]]
- [[_COMMUNITY_Requirement Repository Changes Instructions|Requirement: Repository Changes Instructions]]
- [[_COMMUNITY_Requirement GET status Snapshot|Requirement: GET /status Snapshot]]
- [[_COMMUNITY_Requirement Session Trace Retrieval Tool|Requirement: Session Trace Retrieval Tool]]
- [[_COMMUNITY_Requirement Stream Keepalive|Requirement: Stream Keepalive]]
- [[_COMMUNITY_instructions.ts|instructions.ts]]
- [[_COMMUNITY_boot.ts|boot.ts]]
- [[_COMMUNITY_cronFormatter.ts|cronFormatter.ts]]
- [[_COMMUNITY_remember.ts|remember.ts]]
- [[_COMMUNITY_Slack API Messages and Reactions|Slack API: Messages and Reactions]]
- [[_COMMUNITY_Requirement Changes Workflow Configuration|Requirement: Changes Workflow Configuration]]
- [[_COMMUNITY_Requirement Read Config File Tool|Requirement: Read Config File Tool]]
- [[_COMMUNITY_Requirement Engaged-Thread Registration Primitive|Requirement: Engaged-Thread Registration Primitive]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement load_skill Tool|Requirement: load_skill Tool]]
- [[_COMMUNITY_Requirement Unified Conversation Log|Requirement: Unified Conversation Log]]
- [[_COMMUNITY_Requirement Stream Lifecycle|Requirement: Stream Lifecycle]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_fs.ts|fs.ts]]
- [[_COMMUNITY_statusServer.ts|statusServer.ts]]
- [[_COMMUNITY_021-trivia-answers-format-rename.ts|021-trivia-answers-format-rename.ts]]
- [[_COMMUNITY_025-idler-ledger-to-memory.ts|025-idler-ledger-to-memory.ts]]
- [[_COMMUNITY_findGif.ts|findGif.ts]]
- [[_COMMUNITY_Workflow|Workflow]]
- [[_COMMUNITY_Brave (Image Search) Plugin|Brave (Image Search) Plugin]]
- [[_COMMUNITY_Gemini Image Plugin|Gemini Image Plugin]]
- [[_COMMUNITY_Tenor (GIF) Plugin|Tenor (GIF) Plugin]]
- [[_COMMUNITY_Project Context|Project Context]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement Change Request Detection|Requirement: Change Request Detection]]
- [[_COMMUNITY_Requirement create_scheduled_message Tool|Requirement: create_scheduled_message Tool]]
- [[_COMMUNITY_Requirement fetch_slack_message Query Tool|Requirement: fetch_slack_message Query Tool]]
- [[_COMMUNITY_Requirement Claude Code Subprocess Invocation|Requirement: Claude Code Subprocess Invocation]]
- [[_COMMUNITY_Requirement Tool Call Progress|Requirement: Tool Call Progress]]
- [[_COMMUNITY_Requirement System prompt advertises currently-tracked memory kinds|Requirement: System prompt advertises currently-tracked memory kinds]]
- [[_COMMUNITY_Requirement list_games surfaces plugin-managed cron job UUIDs|Requirement: list_games surfaces plugin-managed cron job UUIDs]]
- [[_COMMUNITY_Requirement Permission Predicates|Requirement: Permission Predicates]]
- [[_COMMUNITY_Deploy to GCE|Deploy to GCE]]
- [[_COMMUNITY_SKILL|SKILL.md]]
- [[_COMMUNITY_Asana Integration|Asana Integration]]
- [[_COMMUNITY_GIPHY Plugin|GIPHY Plugin]]
- [[_COMMUNITY_Authentication|Authentication]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement Thread Reply Pre-Analysis|Requirement: Thread Reply Pre-Analysis]]
- [[_COMMUNITY_Requirement Cascading Resolution|Requirement: Cascading Resolution]]
- [[_COMMUNITY_Requirement Top-Level Table Parameter|Requirement: Top-Level Table Parameter]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement Skills Section in Home Tab|Requirement: Skills Section in Home Tab]]
- [[_COMMUNITY_Requirement SDK can post a message to a channel or thread|Requirement: SDK can post a message to a channel or thread]]
- [[_COMMUNITY_Requirement Shared Per-Channel Delivery Routine|Requirement: Shared Per-Channel Delivery Routine]]
- [[_COMMUNITY_Requirement Reactive Stream Rollover|Requirement: Reactive Stream Rollover]]
- [[_COMMUNITY_Requirement Tool Mapping Config File Format|Requirement: Tool Mapping Config File Format]]
- [[_COMMUNITY_Requirement Per-Answer Reveal-Time Judging via Small Model|Requirement: Per-Answer Reveal-Time Judging via Small Model]]
- [[_COMMUNITY_Requirement Question-posting prompt step flow|Requirement: Question-posting prompt step flow]]
- [[_COMMUNITY_.oxlintrc.json|.oxlintrc.json]]
- [[_COMMUNITY_explore|explore.md]]
- [[_COMMUNITY_Workflow|Workflow]]
- [[_COMMUNITY_MCP Server Setup|MCP Server Setup]]
- [[_COMMUNITY_Requirement Auto-Respond Rule Matching|Requirement: Auto-Respond Rule Matching]]
- [[_COMMUNITY_Requirement Topic Subfolders Within Role Directories|Requirement: Topic Subfolders Within Role Directories]]
- [[_COMMUNITY_Requirement Claude-Authored Block Kit Responses|Requirement: Claude-Authored Block Kit Responses]]
- [[_COMMUNITY_Requirement Query Tools|Requirement: Query Tools]]
- [[_COMMUNITY_Requirement stop_tracking Query Tool|Requirement: stop_tracking Query Tool]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement Cron Job Skip Dates|Requirement: Cron Job Skip Dates]]
- [[_COMMUNITY_instruction-variables Specification|instruction-variables Specification]]
- [[_COMMUNITY_Requirement SDK can start a Claude Q&A turn in a thread|Requirement: SDK can start a Claude Q&A turn in a thread]]
- [[_COMMUNITY_Requirement Add categories tool|Requirement: Add categories tool]]
- [[_COMMUNITY_Requirement answersFormat is per-season, with config fallback|Requirement: answersFormat is per-season, with config fallback]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement Live-card rebuild honors answerLocked|Requirement: Live-card rebuild honors answerLocked]]
- [[_COMMUNITY_Requirement save_question slot binding|Requirement: save_question slot binding]]
- [[_COMMUNITY_Requirement propose_skill_update Tool|Requirement: propose_skill_update Tool]]
- [[_COMMUNITY_Requirement Slack Action Handler for Skill Intents|Requirement: Slack Action Handler for Skill Intents]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_github.ts|github.ts]]
- [[_COMMUNITY_024-trivia-users-to-registry.ts|024-trivia-users-to-registry.ts]]
- [[_COMMUNITY_Configuration|Configuration]]
- [[_COMMUNITY_Requirement Auto-Respond Rule Management|Requirement: Auto-Respond Rule Management]]
- [[_COMMUNITY_Requirement Thread Follow-up Commands|Requirement: Thread Follow-up Commands]]
- [[_COMMUNITY_Requirement submit_response Tool|Requirement: submit_response Tool]]
- [[_COMMUNITY_Requirement find_pull_requests Query Tool|Requirement: find_pull_requests Query Tool]]
- [[_COMMUNITY_Requirement Docker Setup Script|Requirement: Docker Setup Script]]
- [[_COMMUNITY_Requirement Activity logging and summary digest|Requirement: Activity logging and summary digest]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement Silent cron-triggered change execution|Requirement: Silent cron-triggered change execution]]
- [[_COMMUNITY_Requirement Tool Label Registry|Requirement: Tool Label Registry]]
- [[_COMMUNITY_Requirement switch_delivery_context Tool|Requirement: switch_delivery_context Tool]]
- [[_COMMUNITY_Requirement Remove categories tool|Requirement: Remove categories tool]]
- [[_COMMUNITY_Requirement Data-move via migration 019|Requirement: Data-move via migration 019]]
- [[_COMMUNITY_Requirement tellMeMore field on TriviaGame and workspace|Requirement: tellMeMore field on TriviaGame and workspace]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement Trivia Games Config Schema|Requirement: Trivia Games Config Schema]]
- [[_COMMUNITY_Requirement Default-mode processes the oldest unprocessed question|Requirement: Default-mode processes the oldest unprocessed question]]
- [[_COMMUNITY_Requirement `override_answer` admin tool sets a verdict by hand|Requirement: `override_answer` admin tool sets a verdict by hand]]
- [[_COMMUNITY_Requirement Per-fire round summary in payload|Requirement: Per-fire round summary in payload]]
- [[_COMMUNITY_Requirement Reprocess mode re-derives verdicts on retained answers (never deletes)|Requirement: Reprocess mode re-derives verdicts on retained answers (never deletes)]]
- [[_COMMUNITY_Requirement Slug Validation|Requirement: Slug Validation]]
- [[_COMMUNITY_Requirement Worker Release Lifecycle|Requirement: Worker Release Lifecycle]]
- [[_COMMUNITY_errorReports.ts|errorReports.ts]]
- [[_COMMUNITY_022-trivia-config-to-plugin.ts|022-trivia-config-to-plugin.ts]]
- [[_COMMUNITY_023-cron-config-namespace.ts|023-cron-config-namespace.ts]]
- [[_COMMUNITY_Plugin Hard Rules|Plugin Hard Rules]]
- [[_COMMUNITY_adminDeleteMessage.ts|adminDeleteMessage.ts]]
- [[_COMMUNITY_Status by surface|Status by surface]]
- [[_COMMUNITY_Requirement Auto-Respond Trigger Type|Requirement: Auto-Respond Trigger Type]]
- [[_COMMUNITY_Requirement Thread Auto-Respond|Requirement: Thread Auto-Respond]]
- [[_COMMUNITY_Requirement Role Chain Builder|Requirement: Role Chain Builder]]
- [[_COMMUNITY_Requirement PR Operations via GitHub API|Requirement: PR Operations via GitHub API]]
- [[_COMMUNITY_Requirement Worker Visibility|Requirement: Worker Visibility]]
- [[_COMMUNITY_Requirement Plugin SDK Localization|Requirement: Plugin SDK Localization]]
- [[_COMMUNITY_Requirement Atomic Batch Validation With Aggregated Errors|Requirement: Atomic Batch Validation With Aggregated Errors]]
- [[_COMMUNITY_Requirement Configurable additional_messages Cap|Requirement: Configurable additional_messages Cap]]
- [[_COMMUNITY_Requirement Image Block Source — Public URL or Slack File Reference|Requirement: Image Block Source — Public URL or Slack File Reference]]
- [[_COMMUNITY_Requirement Tool Context|Requirement: Tool Context]]
- [[_COMMUNITY_Requirement view_slack_image Query Tool|Requirement: view_slack_image Query Tool]]
- [[_COMMUNITY_Requirement Config Update Confirmation Flow|Requirement: Config Update Confirmation Flow]]
- [[_COMMUNITY_Requirement Tick-Based Scheduler|Requirement: Tick-Based Scheduler]]
- [[_COMMUNITY_Requirement Group Resolution|Requirement: Group Resolution]]
- [[_COMMUNITY_Requirement Question-posting prompt branches on suggested answersFormat and questionType|Requirement: Question-posting prompt branches on suggested answersFormat and questionType]]
- [[_COMMUNITY_Requirement User-Facing TS-Rendered Strings Are Localized|Requirement: User-Facing TS-Rendered Strings Are Localized]]
- [[_COMMUNITY_Requirement allTimeRow field on TriviaGame and workspace|Requirement: allTimeRow field on TriviaGame and workspace]]
- [[_COMMUNITY_Requirement Trivia Off-Days Config|Requirement: Trivia Off-Days Config]]
- [[_COMMUNITY_Requirement Get question history tool|Requirement: Get question history tool]]
- [[_COMMUNITY_Requirement difficultyRatio axis at season and slot tiers|Requirement: difficultyRatio axis at season and slot tiers]]
- [[_COMMUNITY_Requirement list_seasons tool|Requirement: list_seasons tool]]
- [[_COMMUNITY_Requirement liveAnswersVisible on season and slot|Requirement: liveAnswersVisible on season and slot]]
- [[_COMMUNITY_Requirement revealResponses on season and slot|Requirement: revealResponses on season and slot]]
- [[_COMMUNITY_Requirement Season tag on new records|Requirement: Season tag on new records]]
- [[_COMMUNITY_Requirement propose_skill_disable Tool|Requirement: propose_skill_disable Tool]]
- [[_COMMUNITY_Requirement Pre-Analysis Evaluation|Requirement: Pre-Analysis Evaluation]]
- [[_COMMUNITY_Requirement Changes Workflow availability by context visibility|Requirement: Changes Workflow availability by context visibility]]
- [[_COMMUNITY_Requirement ClackSdk Exposes `registerMcpServer` Returning a Handle|Requirement: ClackSdk Exposes `registerMcpServer` Returning a Handle]]
- [[_COMMUNITY_Requirement post_to Actions Carry Blocks|Requirement: post_to Actions Carry Blocks]]
- [[_COMMUNITY_Requirement Required Tools Gate on submit_response|Requirement: Required Tools Gate on submit_response]]
- [[_COMMUNITY_Requirement Send to Thread Action Type|Requirement: Send to Thread Action Type]]
- [[_COMMUNITY_Requirement Sequential Batch Delivery|Requirement: Sequential Batch Delivery]]
- [[_COMMUNITY_Requirement Action Tools|Requirement: Action Tools]]
- [[_COMMUNITY_Requirement list_scheduled_messages Tool|Requirement: list_scheduled_messages Tool]]
- [[_COMMUNITY_Requirement Cron Job Data Model|Requirement: Cron Job Data Model]]
- [[_COMMUNITY_Requirement Error Handling|Requirement: Error Handling]]
- [[_COMMUNITY_Requirement submitResponseMode CRUD|Requirement: submitResponseMode CRUD]]
- [[_COMMUNITY_Requirement GCE Deployment Script|Requirement: GCE Deployment Script]]
- [[_COMMUNITY_Requirement Role Management Section|Requirement: Role Management Section]]
- [[_COMMUNITY_Requirements|Requirements]]
- [[_COMMUNITY_Requirement Reporting controls|Requirement: Reporting controls]]
- [[_COMMUNITY_Requirement Three cooperating scheduled tasks|Requirement: Three cooperating scheduled tasks]]
- [[_COMMUNITY_Requirement USER SKILLS Subsection in the Catalog|Requirement: USER SKILLS Subsection in the Catalog]]
- [[_COMMUNITY_Requirement Encoded button action-value decode is schema-driven|Requirement: Encoded button action-value decode is schema-driven]]
- [[_COMMUNITY_Requirement Worker Flow Streaming|Requirement: Worker Flow Streaming]]
- [[_COMMUNITY_Requirement Choice option-count bounds cascade through all tiers|Requirement: Choice option-count bounds cascade through all tiers]]
- [[_COMMUNITY_Requirement save_question accepts choice-question shape|Requirement: save_question accepts choice-question shape]]
- [[_COMMUNITY_Requirement Exact-Match Pre-Check Bypasses the Reveal Judge|Requirement: Exact-Match Pre-Check Bypasses the Reveal Judge]]
- [[_COMMUNITY_Requirement finalRevealSummary field on TriviaGame and workspace|Requirement: finalRevealSummary field on TriviaGame and workspace]]
- [[_COMMUNITY_Requirement format axis at per-game tier|Requirement: format axis at per-game tier]]
- [[_COMMUNITY_Requirement includeRevealInQuestions field on TriviaGame and workspace|Requirement: includeRevealInQuestions field on TriviaGame and workspace]]
- [[_COMMUNITY_Requirement Name format validation|Requirement: Name format validation]]
- [[_COMMUNITY_Requirement revealResponses field on TriviaGame|Requirement: revealResponses field on TriviaGame]]
- [[_COMMUNITY_Requirement upsert_game CREATE requires an initial season when seasons are enabled|Requirement: upsert_game CREATE requires an initial season when seasons are enabled]]
- [[_COMMUNITY_Requirement per-question generation dispatches on a 3-axis matrix|Requirement: per-question generation dispatches on a 3-axis matrix]]
- [[_COMMUNITY_Requirement find_previous_subjects exact-match dedup tool|Requirement: find_previous_subjects exact-match dedup tool]]
- [[_COMMUNITY_Requirement save_question validates promptMedium and media|Requirement: save_question validates promptMedium and media]]
- [[_COMMUNITY_Requirement Answer-reveal prompt step flow|Requirement: Answer-reveal prompt step flow]]
- [[_COMMUNITY_Requirement Puzzle-quality gate|Requirement: Puzzle-quality gate]]
- [[_COMMUNITY_Requirement check_season_status tool|Requirement: check_season_status tool]]
- [[_COMMUNITY_Requirement delete_season tool|Requirement: delete_season tool]]
- [[_COMMUNITY_Requirement Season-finale reveal layout|Requirement: Season-finale reveal layout]]
- [[_COMMUNITY_Requirement Worker Acquire Decision Tree|Requirement: Worker Acquire Decision Tree]]
- [[_COMMUNITY_loadSkill.ts|loadSkill.ts]]
- [[_COMMUNITY_zodErrorToResult|zodErrorToResult]]
- [[_COMMUNITY_brave-image-search|brave-image-search]]
- [[_COMMUNITY_commons-image-search|commons-image-search]]
- [[_COMMUNITY_Trivia Plugin|Trivia Plugin]]
- [[_COMMUNITY_Requirement Direct-Address Override|Requirement: Direct-Address Override]]
- [[_COMMUNITY_Requirement Pre-Analysis Persistence on Session|Requirement: Pre-Analysis Persistence on Session]]
- [[_COMMUNITY_Requirement Auto-Respond Message Handler|Requirement: Auto-Respond Message Handler]]
- [[_COMMUNITY_Requirement Auto-Respond Rule UI — Pre-Analysis Context|Requirement: Auto-Respond Rule UI — Pre-Analysis Context]]
- [[_COMMUNITY_Requirement Follow-Up Session for Top-Level Posts|Requirement: Follow-Up Session for Top-Level Posts]]
- [[_COMMUNITY_Requirement Cancelled Change Status|Requirement: Cancelled Change Status]]
- [[_COMMUNITY_Requirement ClackSdk Interface|Requirement: ClackSdk Interface]]
- [[_COMMUNITY_Requirement Action Button Label Maximum Length|Requirement: Action Button Label Maximum Length]]
- [[_COMMUNITY_Requirement post_to Carries Optional Actions|Requirement: post_to Carries Optional Actions]]
- [[_COMMUNITY_Requirement Snapshot Persistence Per post_to Captures Followers|Requirement: Snapshot Persistence Per post_to Captures Followers]]
- [[_COMMUNITY_Requirement cancel_scheduled_message Tool|Requirement: cancel_scheduled_message Tool]]
- [[_COMMUNITY_Requirement Role-Based Tool Gating|Requirement: Role-Based Tool Gating]]
- [[_COMMUNITY_Requirement update_scheduled_message Supports skipConditions|Requirement: update_scheduled_message Supports skipConditions]]
- [[_COMMUNITY_Requirement Utility Queries Use clackQuery|Requirement: Utility Queries Use clackQuery]]
- [[_COMMUNITY_Requirement Config Update Auto-Execute|Requirement: Config Update Auto-Execute]]
- [[_COMMUNITY_Requirement Repository-Scoped Config File Addressing|Requirement: Repository-Scoped Config File Addressing]]
- [[_COMMUNITY_Requirement Channel Input Resolution for Scheduled Message Creation|Requirement: Channel Input Resolution for Scheduled Message Creation]]
- [[_COMMUNITY_Requirement Jittered Match-Window Offset|Requirement: Jittered Match-Window Offset]]
- [[_COMMUNITY_Requirement Schedule Name Field|Requirement: Schedule Name Field]]
- [[_COMMUNITY_Requirement Skip Conditions Field|Requirement: Skip Conditions Field]]
- [[_COMMUNITY_Requirement Configuration Section Display|Requirement: Configuration Section Display]]
- [[_COMMUNITY_Requirement Status Section|Requirement: Status Section]]
- [[_COMMUNITY_Requirement Ignored triage marker with re-evaluation on content change|Requirement: Ignored triage marker with re-evaluation on content change]]
- [[_COMMUNITY_Requirement Configurable work sources|Requirement: Configurable work sources]]
- [[_COMMUNITY_Requirement list_skill_pack_skills Tool|Requirement: list_skill_pack_skills Tool]]
- [[_COMMUNITY_Requirement Skill Plugin Registry in config.json|Requirement: Skill Plugin Registry in config.json]]
- [[_COMMUNITY_Requirement Active Change Execution State|Requirement: Active Change Execution State]]
- [[_COMMUNITY_Requirement Synthetic User Identity for Auto-Respond|Requirement: Synthetic User Identity for Auto-Respond]]
- [[_COMMUNITY_Requirement Thread Message Structure|Requirement: Thread Message Structure]]
- [[_COMMUNITY_Requirement Silent Thinking Mode|Requirement: Silent Thinking Mode]]
- [[_COMMUNITY_Requirement Arg Extraction|Requirement: Arg Extraction]]
- [[_COMMUNITY_Requirement Global Task Card Rendering Config|Requirement: Global Task Card Rendering Config]]
- [[_COMMUNITY_Requirement Per-Tool Args Enricher Hook|Requirement: Per-Tool Args Enricher Hook]]
- [[_COMMUNITY_Requirement Plugin Tool Mappings Keyed by Plugin Server Name|Requirement: Plugin Tool Mappings Keyed by Plugin Server Name]]
- [[_COMMUNITY_Requirement Template Interpolation|Requirement: Template Interpolation]]
- [[_COMMUNITY_Requirement Two-Tier Config Loading|Requirement: Two-Tier Config Loading]]
- [[_COMMUNITY_Requirement save_question validates category|Requirement: save_question validates category]]
- [[_COMMUNITY_Requirement Choice-question configuration|Requirement: Choice-question configuration]]
- [[_COMMUNITY_Requirement Reveal flow resolves question before parsing reactions|Requirement: Reveal flow resolves question before parsing reactions]]
- [[_COMMUNITY_Requirement difficultyRatio axis at workspace and per-game tiers|Requirement: difficultyRatio axis at workspace and per-game tiers]]
- [[_COMMUNITY_Requirement Hint axis at workspace and per-game tiers|Requirement: Hint axis at workspace and per-game tiers]]
- [[_COMMUNITY_Requirement liveAnswersVisible field on TriviaGame|Requirement: liveAnswersVisible field on TriviaGame]]
- [[_COMMUNITY_Requirement upsert_game surfaces cascade shadowing|Requirement: upsert_game surfaces cascade shadowing]]
- [[_COMMUNITY_Requirement image-medium questions MUST be about the image|Requirement: image-medium questions MUST be about the image]]
- [[_COMMUNITY_Requirement POST_QUESTIONS_INSTRUCTIONS queries the staged pool before generating|Requirement: POST_QUESTIONS_INSTRUCTIONS queries the staged pool before generating]]
- [[_COMMUNITY_Requirement post_questions MCP Tool|Requirement: post_questions MCP Tool]]
- [[_COMMUNITY_Requirement find_previous_questions supports filtering by posted state|Requirement: find_previous_questions supports filtering by posted state]]
- [[_COMMUNITY_Requirement save_question Accepts Freeform Fields|Requirement: save_question Accepts Freeform Fields]]
- [[_COMMUNITY_Requirement Admin instructions preserve prompt structure by default, override only on explicit structural intent|Requirement: Admin instructions preserve prompt structure by default, override only on explicit structural intent]]
- [[_COMMUNITY_Requirement Question-posting prompt renders a new-season opener on first fire|Requirement: Question-posting prompt renders a new-season opener on first fire]]
- [[_COMMUNITY_Requirement Reveal table leads with This Round|Requirement: Reveal table leads with This Round]]
- [[_COMMUNITY_Requirement Season per-slot overrides via sparse slotOverrides map|Requirement: Season per-slot overrides via sparse slotOverrides map]]
- [[_COMMUNITY_Requirement mtime-Keyed Body Cache|Requirement: mtime-Keyed Body Cache]]
- [[_COMMUNITY_Requirement User Skill Storage Layout|Requirement: User Skill Storage Layout]]
- [[_COMMUNITY_Requirement Setup-Version Invalidation|Requirement: Setup-Version Invalidation]]
- [[_COMMUNITY_trackedKinds.ts|trackedKinds.ts]]
- [[_COMMUNITY_Requirement Level-Keyed Classifier Policy|Requirement: Level-Keyed Classifier Policy]]
- [[_COMMUNITY_Requirement Temporal Proximity Signal|Requirement: Temporal Proximity Signal]]
- [[_COMMUNITY_Requirement Auto-Respond Rule Persistence|Requirement: Auto-Respond Rule Persistence]]
- [[_COMMUNITY_Requirement Chattiness Heuristic|Requirement: Chattiness Heuristic]]
- [[_COMMUNITY_Requirement Plugin Config File|Requirement: Plugin Config File]]
- [[_COMMUNITY_Requirement Change Request Feedback|Requirement: Change Request Feedback]]
- [[_COMMUNITY_Requirement Failed Change Status Is Recoverable|Requirement: Failed Change Status Is Recoverable]]
- [[_COMMUNITY_Requirement Plugin Loading Lifecycle|Requirement: Plugin Loading Lifecycle]]
- [[_COMMUNITY_Requirement Plugin MCP Server Membership Gating|Requirement: Plugin MCP Server Membership Gating]]
- [[_COMMUNITY_Requirement Change Thread Follow-Up Action Types|Requirement: Change Thread Follow-Up Action Types]]
- [[_COMMUNITY_Requirement DeliverFn Follower Path|Requirement: DeliverFn Follower Path]]
- [[_COMMUNITY_Requirement DeliverFn Supports postTopLevel Routing|Requirement: DeliverFn Supports postTopLevel Routing]]
- [[_COMMUNITY_Requirement Markdown Block Support|Requirement: Markdown Block Support]]
- [[_COMMUNITY_Requirement Optional Slack Block Kit Fields Are Preserved|Requirement: Optional Slack Block Kit Fields Are Preserved]]
- [[_COMMUNITY_Requirement post_to Carries Optional Reactions|Requirement: post_to Carries Optional Reactions]]
- [[_COMMUNITY_Requirement post_top_level Flag on submit_response|Requirement: post_top_level Flag on submit_response]]
- [[_COMMUNITY_Requirement find_changes Waiting and Freshness Reporting|Requirement: find_changes Waiting and Freshness Reporting]]
- [[_COMMUNITY_Requirement In-Process MCP Tool Server|Requirement: In-Process MCP Tool Server]]
- [[_COMMUNITY_Requirement Output Capture and Formatting|Requirement: Output Capture and Formatting]]
- [[_COMMUNITY_Requirement Cron Job CRUD Operations|Requirement: Cron Job CRUD Operations]]
- [[_COMMUNITY_Requirement Cron Job Jitter Field|Requirement: Cron Job Jitter Field]]
- [[_COMMUNITY_Requirement Auth Directory Structure|Requirement: Auth Directory Structure]]
- [[_COMMUNITY_Requirement Dockerfile|Requirement: Dockerfile]]
- [[_COMMUNITY_Requirement Pre-Swap Drain Gate|Requirement: Pre-Swap Drain Gate]]
- [[_COMMUNITY_Requirement Slack Credential Separation|Requirement: Slack Credential Separation]]
- [[_COMMUNITY_Requirement Auto-Respond Section|Requirement: Auto-Respond Section]]
- [[_COMMUNITY_Requirement Plugin Error Banner|Requirement: Plugin Error Banner]]
- [[_COMMUNITY_Requirement Schedule Rows Omit Channel Portion When Channelless|Requirement: Schedule Rows Omit Channel Portion When Channelless]]
- [[_COMMUNITY_Requirement Transfer Ownership UI|Requirement: Transfer Ownership UI]]
- [[_COMMUNITY_Requirement Stable source-keyed unit identity and dedup|Requirement: Stable source-keyed unit identity and dedup]]
- [[_COMMUNITY_Requirement Every-fire memory-maintenance pass|Requirement: Every-fire memory-maintenance pass]]
- [[_COMMUNITY_Requirement Off-hours channelless cron plugin|Requirement: Off-hours channelless cron plugin]]
- [[_COMMUNITY_Requirement Priority-ordered work-kind ladder|Requirement: Priority-ordered work-kind ladder]]
- [[_COMMUNITY_Requirement Recently-updated memory scan during sync|Requirement: Recently-updated memory scan during sync]]
- [[_COMMUNITY_Requirement Safety rails for autonomous operation|Requirement: Safety rails for autonomous operation]]
- [[_COMMUNITY_Requirement Work-state in the core memory namespace|Requirement: Work-state in the core memory namespace]]
- [[_COMMUNITY_Requirement In-Memory Thread-to-Session Index|Requirement: In-Memory Thread-to-Session Index]]
- [[_COMMUNITY_Requirement Session Timeout|Requirement: Session Timeout]]
- [[_COMMUNITY_Requirement Stream Generation Guard|Requirement: Stream Generation Guard]]
- [[_COMMUNITY_Requirement Config-Driven Tool Links|Requirement: Config-Driven Tool Links]]
- [[_COMMUNITY_Requirement Label Sanitization|Requirement: Label Sanitization]]
- [[_COMMUNITY_Requirement Bot auto-reactions sized to answersFormat|Requirement: Bot auto-reactions sized to answersFormat]]
- [[_COMMUNITY_Requirement Shape-Specific Judge Prompts|Requirement: Shape-Specific Judge Prompts]]
- [[_COMMUNITY_Requirement Game config validation is schema-driven|Requirement: Game config validation is schema-driven]]
- [[_COMMUNITY_Requirement Games registry lives in config|Requirement: Games registry lives in config]]
- [[_COMMUNITY_Requirement Per-slot axis overrides resolve from the effective format|Requirement: Per-slot axis overrides resolve from the effective format]]
- [[_COMMUNITY_Requirement theme axis at per-game tier|Requirement: theme axis at per-game tier]]
- [[_COMMUNITY_Requirement Question Spec Declares submitResponseMode skipped|Requirement: Question Spec Declares submitResponseMode "skipped"]]
- [[_COMMUNITY_Requirement Required Tools Are Limited To Always-Called Tools|Requirement: Required Tools Are Limited To Always-Called Tools]]
- [[_COMMUNITY_Requirement post_questions Accepts appendToPreviousBatch Flag|Requirement: post_questions Accepts appendToPreviousBatch Flag]]
- [[_COMMUNITY_Requirement find_previous_questions exposes derived batch facts, never the batchId|Requirement: find_previous_questions exposes derived batch facts, never the batchId]]
- [[_COMMUNITY_Requirement Find previous questions response excludes the answer key|Requirement: Find previous questions response excludes the answer key]]
- [[_COMMUNITY_Requirement `just-winners` reveal-disclosure variant|Requirement: `"just-winners"` reveal-disclosure variant]]
- [[_COMMUNITY_Requirement Legacy Trivia Cron Migration|Requirement: Legacy Trivia Cron Migration]]
- [[_COMMUNITY_Requirement Seasons configuration block|Requirement: Seasons configuration block]]
- [[_COMMUNITY_Requirement editableByAnyone Attribute|Requirement: editableByAnyone Attribute]]
- [[_COMMUNITY_Requirement Permission-Aware Edit Modal|Requirement: Permission-Aware Edit Modal]]
- [[_COMMUNITY_Requirement userSkills Config Block|Requirement: userSkills Config Block]]
- [[_COMMUNITY_Requirement Boot-Time Provisioning|Requirement: Boot-Time Provisioning]]
- [[_COMMUNITY_Requirement Branch Switching with Dirty-Worker Quarantine|Requirement: Branch Switching with Dirty-Worker Quarantine]]
- [[_COMMUNITY_Requirement Quarantine Lifecycle|Requirement: Quarantine Lifecycle]]
- [[_COMMUNITY_Requirement Resume-from-Remote-Branch Acquire|Requirement: Resume-from-Remote-Branch Acquire]]
- [[_COMMUNITY_Requirement Worker State Persistence|Requirement: Worker State Persistence]]
- [[_COMMUNITY_gce-common.sh|gce-common.sh]]
- [[_COMMUNITY_listConfigFiles.ts|listConfigFiles.ts]]
- [[_COMMUNITY_forget.ts|forget.ts]]
- [[_COMMUNITY_adminDescribeConfigFile.ts|adminDescribeConfigFile.ts]]
- [[_COMMUNITY_Requirement Direct-to-Channel Delivery via post_top_level|Requirement: Direct-to-Channel Delivery via post_top_level]]
- [[_COMMUNITY_Requirement Role Directory Structure|Requirement: Role Directory Structure]]
- [[_COMMUNITY_Requirement Two-Tier Resolution Within Each Role Level|Requirement: Two-Tier Resolution Within Each Role Level]]
- [[_COMMUNITY_Requirement Admin Tool — `add_channel`|Requirement: Admin Tool — `add_channel`]]
- [[_COMMUNITY_Requirement Admin Tool — `add_small_talk_topic` and `remove_small_talk_topic`|Requirement: Admin Tool — `add_small_talk_topic` and `remove_small_talk_topic`]]
- [[_COMMUNITY_Requirement Admin Tool — `set_casual_talk_config`|Requirement: Admin Tool — `set_casual_talk_config`]]
- [[_COMMUNITY_Requirement Admin Tool — `set_channel_prompt_suggestion`|Requirement: Admin Tool — `set_channel_prompt_suggestion`]]
- [[_COMMUNITY_Requirement Admin Tool — `toggle_builtin_fallback_topics`|Requirement: Admin Tool — `toggle_builtin_fallback_topics`]]
- [[_COMMUNITY_Requirement Cron Spec Assembly (Channelless)|Requirement: Cron Spec Assembly (Channelless)]]
- [[_COMMUNITY_Requirement ClackSdk Exposes Capability Flags|Requirement: ClackSdk Exposes Capability Flags]]
- [[_COMMUNITY_Requirement ClackSdk Exposes Plugin Error Reporting|Requirement: ClackSdk Exposes Plugin Error Reporting]]
- [[_COMMUNITY_Requirement ClackSdk Exposes User Registry Accessor|Requirement: ClackSdk Exposes User Registry Accessor]]
- [[_COMMUNITY_Requirement ClackSdk Posting Helpers Accept suppressUnfurls|Requirement: ClackSdk Posting Helpers Accept suppressUnfurls]]
- [[_COMMUNITY_Requirement Home Tab Plugin Display|Requirement: Home Tab Plugin Display]]
- [[_COMMUNITY_Requirement Plugin Contract|Requirement: Plugin Contract]]
- [[_COMMUNITY_Requirement Plugin SDK Single-Turn Claude Call|Requirement: Plugin SDK Single-Turn Claude Call]]
- [[_COMMUNITY_Requirement Plugin Tool Mapping Supports Hidden Flag|Requirement: Plugin Tool Mapping Supports Hidden Flag]]
- [[_COMMUNITY_Requirement PluginLoadResult Includes Errors|Requirement: PluginLoadResult Includes Errors]]
- [[_COMMUNITY_Requirement SDK engageThread Method|Requirement: SDK engageThread Method]]
- [[_COMMUNITY_Requirement Skill-Plugins Directory Rename|Requirement: Skill-Plugins Directory Rename]]
- [[_COMMUNITY_Requirement Centralized Block Handling Across Outbound Surfaces|Requirement: Centralized Block Handling Across Outbound Surfaces]]
- [[_COMMUNITY_Requirement Continuation Action Types|Requirement: Continuation Action Types]]
- [[_COMMUNITY_Requirement Message Preamble Renders Above Blocks|Requirement: Message Preamble Renders Above Blocks]]
- [[_COMMUNITY_Requirement Multi-Message Inside post_to|Requirement: Multi-Message Inside post_to]]
- [[_COMMUNITY_Requirement Multi-Message Top-Level Fields Gated To Scheduled Trigger|Requirement: Multi-Message Top-Level Fields Gated To Scheduled Trigger]]
- [[_COMMUNITY_Requirement Per-Message Payload Shape|Requirement: Per-Message Payload Shape]]
- [[_COMMUNITY_Requirement post_to.actions Validated Identically To Top-Level Actions|Requirement: post_to.actions Validated Identically To Top-Level Actions]]
- [[_COMMUNITY_Requirement Required Tools Supplied via Session Context|Requirement: Required Tools Supplied via Session Context]]
- [[_COMMUNITY_Requirement Shared Message-Content Schema Across submit_response and post_to|Requirement: Shared Message-Content Schema Across submit_response and post_to]]
- [[_COMMUNITY_Requirement find_session_transcript Tool Registration|Requirement: find_session_transcript Tool Registration]]
- [[_COMMUNITY_Requirement Staged Intent Storage|Requirement: Staged Intent Storage]]
- [[_COMMUNITY_Requirement PR Template Resolution|Requirement: PR Template Resolution]]
- [[_COMMUNITY_Requirement Session Context Continuation|Requirement: Session Context Continuation]]
- [[_COMMUNITY_Requirement Startup Baseline Token Smoke Test|Requirement: Startup Baseline Token Smoke Test]]
- [[_COMMUNITY_Requirement create_scheduled_message Requires a Name|Requirement: create_scheduled_message Requires a Name]]
- [[_COMMUNITY_Requirement Synchronous In-Memory Job Lookup Accessor|Requirement: Synchronous In-Memory Job Lookup Accessor]]
- [[_COMMUNITY_Requirement Create Skill Modal|Requirement: Create Skill Modal]]
- [[_COMMUNITY_Requirement Edit Skill Modal|Requirement: Edit Skill Modal]]
- [[_COMMUNITY_Requirement Migration Status Banner|Requirement: Migration Status Banner]]
- [[_COMMUNITY_Requirement Settings Modal|Requirement: Settings Modal]]
- [[_COMMUNITY_Requirement User Selection Modals|Requirement: User Selection Modals]]
- [[_COMMUNITY_Requirement Coldest-first ordering for the concierge rotation|Requirement: Coldest-first ordering for the concierge rotation]]
- [[_COMMUNITY_Requirement Concierge parks stale units via the existing sink|Requirement: Concierge parks stale units via the existing sink]]
- [[_COMMUNITY_Requirement Self-describing work-unit ledger|Requirement: Self-describing work-unit ledger]]
- [[_COMMUNITY_Requirement Sync-recomputed priority|Requirement: Sync-recomputed priority]]
- [[_COMMUNITY_Requirement Triage verdict against the codebase|Requirement: Triage verdict against the codebase]]
- [[_COMMUNITY_Requirement @claude review trigger loop|Requirement: @claude review trigger loop]]
- [[_COMMUNITY_Requirement Layered incremental sync|Requirement: Layered incremental sync]]
- [[_COMMUNITY_Requirement Two-layer instructions|Requirement: Two-layer instructions]]
- [[_COMMUNITY_Requirement AVAILABLE SKILL PACKS Catalog in the Prompt|Requirement: AVAILABLE SKILL PACKS Catalog in the Prompt]]
- [[_COMMUNITY_Requirement Thread Context Delta Tracking|Requirement: Thread Context Delta Tracking]]
- [[_COMMUNITY_Requirement Answer Delivery|Requirement: Answer Delivery]]
- [[_COMMUNITY_Requirement Freeform Answers Format Value|Requirement: Freeform Answers Format Value]]
- [[_COMMUNITY_Requirement Server-rolled choice metadata in get_ideas|Requirement: Server-rolled choice metadata in get_ideas]]
- [[_COMMUNITY_Requirement Freeform Answer Format|Requirement: Freeform Answer Format]]
- [[_COMMUNITY_Requirement Freeform Answer Submission via Slack Modal|Requirement: Freeform Answer Submission via Slack Modal]]
- [[_COMMUNITY_Requirement Freeform Re-Judging in Reprocess Mode|Requirement: Freeform Re-Judging in Reprocess Mode]]
- [[_COMMUNITY_Requirement Channel→game inference for reactive sessions|Requirement: Channel→game inference for reactive sessions]]
- [[_COMMUNITY_Requirement Enabled flag|Requirement: Enabled flag]]
- [[_COMMUNITY_Requirement list_games surfaces every registry axis|Requirement: list_games surfaces every registry axis]]
- [[_COMMUNITY_Requirement Universal `game` argument on per-game tools|Requirement: Universal `game` argument on per-game tools]]
- [[_COMMUNITY_Requirement upsert_game accepts lockCron|Requirement: upsert_game accepts lockCron]]
- [[_COMMUNITY_Requirement buildGameSpecs emits a lock spec when lockCron is set|Requirement: buildGameSpecs emits a lock spec when lockCron is set]]
- [[_COMMUNITY_Requirement buildGameSpecs emits a prep spec when prepCron is set|Requirement: buildGameSpecs emits a prep spec when prepCron is set]]
- [[_COMMUNITY_Requirement Off-Days Propagation Through Game Specs|Requirement: Off-Days Propagation Through Game Specs]]
- [[_COMMUNITY_Requirement Trivia Plugin Reconciles Schedules From Config|Requirement: Trivia Plugin Reconciles Schedules From Config]]
- [[_COMMUNITY_Requirement post_questions Uses Shared Slack Posting Helper|Requirement: post_questions Uses Shared Slack Posting Helper]]
- [[_COMMUNITY_Requirement Posted Question Threads Engage Clarification Replies|Requirement: Posted Question Threads Engage Clarification Replies]]
- [[_COMMUNITY_Requirement reveal renders attribution context block for image media|Requirement: reveal renders attribution context block for image media]]
- [[_COMMUNITY_Requirement `compute_answers` resolves and returns `finalRevealSummary`|Requirement: `compute_answers` resolves and returns `finalRevealSummary`]]
- [[_COMMUNITY_Requirement `compute_answers` resolves and returns `includeRevealInQuestions`|Requirement: `compute_answers` resolves and returns `includeRevealInQuestions`]]
- [[_COMMUNITY_Requirement Freeform Reveal Invokes Per-Answer Judge|Requirement: Freeform Reveal Invokes Per-Answer Judge]]
- [[_COMMUNITY_Requirement `processedAt` field on TriviaQuestion|Requirement: `processedAt` field on TriviaQuestion]]
- [[_COMMUNITY_Requirement Reprocess preserves manually-overridden verdicts|Requirement: Reprocess preserves manually-overridden verdicts]]
- [[_COMMUNITY_Requirement Reveal steps are atomic and independently replayable|Requirement: Reveal steps are atomic and independently replayable]]
- [[_COMMUNITY_Requirement Tool internally composes leaderboard and season-status logic|Requirement: Tool internally composes leaderboard and season-status logic]]
- [[_COMMUNITY_Requirement Dense-rank medal assignment across leaderboard rows|Requirement: Dense-rank medal assignment across leaderboard rows]]
- [[_COMMUNITY_Requirement Question-posting prompt instructs retry-with-appendToPreviousBatch|Requirement: Question-posting prompt instructs retry-with-appendToPreviousBatch]]
- [[_COMMUNITY_Requirement requiredTools per spec|Requirement: requiredTools per spec]]
- [[_COMMUNITY_Requirement Reveal prompt branches on reveals.length|Requirement: Reveal prompt branches on reveals.length]]
- [[_COMMUNITY_Requirement Reveal prompt branches the summary on `finalRevealSummary`|Requirement: Reveal prompt branches the summary on `finalRevealSummary`]]
- [[_COMMUNITY_Requirement Schedule Prompts Are Thin Dispatchers|Requirement: Schedule Prompts Are Thin Dispatchers]]
- [[_COMMUNITY_Requirement Six-Way Generation Matrix|Requirement: Six-Way Generation Matrix]]
- [[_COMMUNITY_Requirement Trivia Plugin Self-Disables When Crons Are Off|Requirement: Trivia Plugin Self-Disables When Crons Are Off]]
- [[_COMMUNITY_Requirement Apply-to-current-season clears the override|Requirement: Apply-to-current-season clears the override]]
- [[_COMMUNITY_Requirement process_reveal_answers resolves allTimeRow into showAllTimeRow|Requirement: process_reveal_answers resolves allTimeRow into showAllTimeRow]]
- [[_COMMUNITY_Requirement SeasonEntry and SeasonFormatSlot carry promptMedium cascade fields|Requirement: SeasonEntry and SeasonFormatSlot carry promptMedium cascade fields]]
- [[_COMMUNITY_Requirement upsert_season accepts promptMedium argument|Requirement: upsert_season accepts promptMedium argument]]
- [[_COMMUNITY_Requirement list_user_skills Tool|Requirement: list_user_skills Tool]]
- [[_COMMUNITY_Requirement propose_skill_create Tool|Requirement: propose_skill_create Tool]]
- [[_COMMUNITY_Requirement propose_skill_restore Tool|Requirement: propose_skill_restore Tool]]
- [[_COMMUNITY_Requirement Setting editableByAnyone from the Home Tab|Requirement: Setting editableByAnyone from the Home Tab]]
- [[_COMMUNITY_Requirement Pool Folders Exempt from Stale-Worktree Cleanup|Requirement: Pool Folders Exempt from Stale-Worktree Cleanup]]
- [[_COMMUNITY_Requirement Pool Visibility in Home Tab|Requirement: Pool Visibility in Home Tab]]
- [[_COMMUNITY_Requirement Worker Pool Configuration|Requirement: Worker Pool Configuration]]
- [[_COMMUNITY_Requirement Worker-pool state loading is schema-driven|Requirement: Worker-pool state loading is schema-driven]]
- [[_COMMUNITY_pruneArchive.ts|pruneArchive.ts]]
- [[_COMMUNITY_ClackSdkUsers|ClackSdkUsers]]
- [[_COMMUNITY_Requirement Baseline Resolution Unchanged|Requirement: Baseline Resolution Unchanged]]
- [[_COMMUNITY_Requirement Topic File Discovery in Home Tab|Requirement: Topic File Discovery in Home Tab]]
- [[_COMMUNITY_Requirement Admin Tool — `remove_channel`|Requirement: Admin Tool — `remove_channel`]]
- [[_COMMUNITY_Requirement Admin Tool — `set_expected_rate`|Requirement: Admin Tool — `set_expected_rate`]]
- [[_COMMUNITY_Requirement Admin Tool — `set_work_hours`|Requirement: Admin Tool — `set_work_hours`]]
- [[_COMMUNITY_Requirement Admin Tools — `enable` and `disable`|Requirement: Admin Tools — `enable` and `disable`]]
- [[_COMMUNITY_Requirement Built-in Fallback Topics Constant|Requirement: Built-in Fallback Topics Constant]]
- [[_COMMUNITY_Requirement Casual Posts Engage Their Thread With High Attention|Requirement: Casual Posts Engage Their Thread With High Attention]]
- [[_COMMUNITY_Requirement Casual Talk Internal Jitter Constant|Requirement: Casual Talk Internal Jitter Constant]]
- [[_COMMUNITY_Requirement i18n for Direct-to-Slack Strings|Requirement: i18n for Direct-to-Slack Strings]]
- [[_COMMUNITY_Requirement Persona Topic Instruction (Admin-Overridable)|Requirement: Persona Topic Instruction (Admin-Overridable)]]
- [[_COMMUNITY_Requirement Plugin Registration and Capability Gating|Requirement: Plugin Registration and Capability Gating]]
- [[_COMMUNITY_Requirement Built-in Plugin Registry|Requirement: Built-in Plugin Registry]]
- [[_COMMUNITY_Requirement ClackSdk Exposes Cron Reconciliation|Requirement: ClackSdk Exposes Cron Reconciliation]]
- [[_COMMUNITY_Requirement ClackSdk Exposes File Watching|Requirement: ClackSdk Exposes File Watching]]
- [[_COMMUNITY_Requirement ClackSdk Exposes Implicit Default MCP Server|Requirement: ClackSdk Exposes Implicit Default MCP Server]]
- [[_COMMUNITY_Requirement Transparent Tool Call Recording for Plugin Tools|Requirement: Transparent Tool Call Recording for Plugin Tools]]
- [[_COMMUNITY_Requirement Multi-Repository Awareness|Requirement: Multi-Repository Awareness]]
- [[_COMMUNITY_Requirement Non-Technical Response Style|Requirement: Non-Technical Response Style]]
- [[_COMMUNITY_Requirement `runClaude` MCP Server Support|Requirement: `runClaude` MCP Server Support]]
- [[_COMMUNITY_docker-deployment Specification|docker-deployment Specification]]
- [[_COMMUNITY_Requirement Artifact Registry Repository Provisioning|Requirement: Artifact Registry Repository Provisioning]]
- [[_COMMUNITY_Requirement Docker Ignore|Requirement: Docker Ignore]]
- [[_COMMUNITY_Requirement GitHub API Access via Octokit|Requirement: GitHub API Access via Octokit]]
- [[_COMMUNITY_Requirement GitHub MCP Server Binary|Requirement: GitHub MCP Server Binary]]
- [[_COMMUNITY_Requirement Edit Rule Modal|Requirement: Edit Rule Modal]]
- [[_COMMUNITY_Requirement Home Tab Event Handling|Requirement: Home Tab Event Handling]]
- [[_COMMUNITY_Requirement Full-auto approval, no human gate|Requirement: Full-auto approval, no human gate]]
- [[_COMMUNITY_Requirement Growing self-describing references|Requirement: Growing self-describing references]]
- [[_COMMUNITY_Requirement Per-reference comment idempotency|Requirement: Per-reference comment idempotency]]
- [[_COMMUNITY_Requirement Work-task authority and pre-act refresh|Requirement: Work-task authority and pre-act refresh]]
- [[_COMMUNITY_Requirement Idle is the default over manufactured work|Requirement: Idle is the default over manufactured work]]
- [[_COMMUNITY_Requirement Review requires fresh commits|Requirement: Review requires fresh commits]]
- [[_COMMUNITY_Requirement Lazy-Tagged Plugins Excluded From --plugin-dir|Requirement: Lazy-Tagged Plugins Excluded From --plugin-dir]]
- [[_COMMUNITY_Requirement Session-Level Load Tracking|Requirement: Session-Level Load Tracking]]
- [[_COMMUNITY_session-management Specification|session-management Specification]]
- [[_COMMUNITY_Requirement Session Creation|Requirement: Session Creation]]
- [[_COMMUNITY_Requirement Session Identification|Requirement: Session Identification]]
- [[_COMMUNITY_Requirement Session Restoration|Requirement: Session Restoration]]
- [[_COMMUNITY_Requirement Session Storage Directory|Requirement: Session Storage Directory]]
- [[_COMMUNITY_trivia-freeform-questions|trivia-freeform-questions]]
- [[_COMMUNITY_Requirement Freeform Generation Flow in Scheduled Prompts|Requirement: Freeform Generation Flow in Scheduled Prompts]]
- [[_COMMUNITY_Requirement Freeform Question Posting Behavior|Requirement: Freeform Question Posting Behavior]]
- [[_COMMUNITY_Requirement Resilient Verdict Resolution — Re-Ask and Never Score a Dropped Verdict Wrong|Requirement: Resilient Verdict Resolution — Re-Ask and Never Score a Dropped Verdict Wrong]]
- [[_COMMUNITY_trivia-games Specification|trivia-games Specification]]
- [[_COMMUNITY_Requirement list_games surfaces prepCron|Requirement: list_games surfaces prepCron]]
- [[_COMMUNITY_Requirement upsert_game accepts prepCron|Requirement: upsert_game accepts prepCron]]
- [[_COMMUNITY_trivia-question-posting Specification|trivia-question-posting Specification]]
- [[_COMMUNITY_Requirement revealResponses cascade accepts `just-winners`|Requirement: revealResponses cascade accepts `"just-winners"`]]
- [[_COMMUNITY_Requirement Freeform Judge Prompt Multi-Guess Rule|Requirement: Freeform Judge Prompt Multi-Guess Rule]]
- [[_COMMUNITY_Requirement Freeform Reveal Payload Carries answerText|Requirement: Freeform Reveal Payload Carries answerText]]
- [[_COMMUNITY_Requirement Answer-reveal prompt renders the `just-winners` variant|Requirement: Answer-reveal prompt renders the `"just-winners"` variant]]
- [[_COMMUNITY_Requirement Answer-reveal prompt settles or invalidates predictions before scoring|Requirement: Answer-reveal prompt settles or invalidates predictions before scoring]]
- [[_COMMUNITY_Requirement buildGameSpecs does not peek into seasons state|Requirement: buildGameSpecs does not peek into seasons state]]
- [[_COMMUNITY_Requirement Empty correct bucket renders expanded answer detail|Requirement: Empty correct bucket renders expanded answer detail]]
- [[_COMMUNITY_Requirement Reveal leaderboard labels are localized via the trivia dictionary|Requirement: Reveal leaderboard labels are localized via the trivia dictionary]]
- [[_COMMUNITY_Requirement User-skill metadata load is schema-driven|Requirement: User-skill metadata load is schema-driven]]
- [[_COMMUNITY_worker-pool Specification|worker-pool Specification]]
- [[_COMMUNITY_Requirement Quarantine sidecar load is schema-driven|Requirement: Quarantine sidecar load is schema-driven]]
- [[_COMMUNITY_Requirement Worker Identity and Folder Layout|Requirement: Worker Identity and Folder Layout]]
- [[_COMMUNITY_monday-oauth.mjs|monday-oauth.mjs]]
- [[_COMMUNITY_tsconfig.build.json|tsconfig.build.json]]
- [[_COMMUNITY_rebuild-docker-and-launch.sh|rebuild-docker-and-launch.sh]]
- [[_COMMUNITY_docker-setup.sh|docker-setup.sh]]
- [[_COMMUNITY_gce-deploy.sh|gce-deploy.sh]]
- [[_COMMUNITY_gce-fetch-session.sh|gce-fetch-session.sh]]
- [[_COMMUNITY_gce-push-config.sh|gce-push-config.sh]]
- [[_COMMUNITY_gce-sync-from-vm.sh|gce-sync-from-vm.sh]]
- [[_COMMUNITY_gce-sync-to-vm.sh|gce-sync-to-vm.sh]]
- [[_COMMUNITY_gce-update-image.sh|gce-update-image.sh]]
- [[_COMMUNITY_Action Handler Registration|Action Handler Registration]]
- [[_COMMUNITY_active-runs-registry Specification|active-runs-registry Specification]]
- [[_COMMUNITY_AGENTS|AGENTS.md]]
- [[_COMMUNITY_Answer Formats|Answer Formats]]
- [[_COMMUNITY_answerLocked Flag|answerLocked Flag]]
- [[_COMMUNITY_answersFormat Axis|answersFormat Axis]]
- [[_COMMUNITY_Asana Personal Access Token|Asana Personal Access Token]]
- [[_COMMUNITY_Attention Level Engagement|Attention Level Engagement]]
- [[_COMMUNITY_Auto-Execute Actions|Auto-Execute Actions]]
- [[_COMMUNITY_Auto-Respond Trigger Mode|Auto-Respond Trigger Mode]]
- [[_COMMUNITY_Block Kit Rendering|Block Kit Rendering]]
- [[_COMMUNITY_Blocking Migrations (Boot-Time)|Blocking Migrations (Boot-Time)]]
- [[_COMMUNITY_Git Branch Switching|Git Branch Switching]]
- [[_COMMUNITY_Brave Image Search Plugin|Brave Image Search Plugin]]
- [[_COMMUNITY_cancel_worker_run MCP Tool|cancel_worker_run MCP Tool]]
- [[_COMMUNITY_Cascade Axes|Cascade Axes]]
- [[_COMMUNITY_Cascade Axes System|Cascade Axes System]]
- [[_COMMUNITY_Trivia Cascade System (SlotSeasonGameWorkspace)|Trivia Cascade System (Slot/Season/Game/Workspace)]]
- [[_COMMUNITY_Casual Talk Plugin|Casual Talk Plugin]]
- [[_COMMUNITY_Change Workflow|Change Workflow]]
- [[_COMMUNITY_Trivia Cheating Detection|Trivia Cheating Detection]]
- [[_COMMUNITY_Clack (Claude + Slack Bot)|Clack (Claude + Slack Bot)]]
- [[_COMMUNITY_Clack - Slack Bot|Clack - Slack Bot]]
- [[_COMMUNITY_Claude Code Authentication|Claude Code Authentication]]
- [[_COMMUNITY_Claude Code Agent SDK|Claude Code Agent SDK]]
- [[_COMMUNITY_apply|apply.md]]
- [[_COMMUNITY_archive|archive.md]]
- [[_COMMUNITY_bulk-archive|bulk-archive.md]]
- [[_COMMUNITY_propose|propose.md]]
- [[_COMMUNITY_sync|sync.md]]
- [[_COMMUNITY_verify|verify.md]]
- [[_COMMUNITY_SKILL|SKILL.md]]
- [[_COMMUNITY_SKILL|SKILL.md]]
- [[_COMMUNITY_SKILL|SKILL.md]]
- [[_COMMUNITY_SKILL|SKILL.md]]
- [[_COMMUNITY_SKILL|SKILL.md]]
- [[_COMMUNITY_SKILL|SKILL.md]]
- [[_COMMUNITY_SKILL|SKILL.md]]
- [[_COMMUNITY_Cold PR Resume (resumeRemoteBranch)|Cold PR Resume (resumeRemoteBranch)]]
- [[_COMMUNITY_Commons Image Search Plugin|Commons Image Search Plugin]]
- [[_COMMUNITY_cascading configuration resolver|cascading configuration resolver]]
- [[_COMMUNITY_localization and language directives|localization and language directives]]
- [[_COMMUNITY_role-based access control|role-based access control]]
- [[_COMMUNITY_trivia cascade axis resolution|trivia cascade axis resolution]]
- [[_COMMUNITY_two-tier resolution chain|two-tier resolution chain]]
- [[_COMMUNITY_worker pool (reusabledisposable)|worker pool (reusable/disposable)]]
- [[_COMMUNITY_Conditional Hidden Rules (Task Card Visibility)|Conditional Hidden Rules (Task Card Visibility)]]
- [[_COMMUNITY_Cron Job Reconciliation|Cron Job Reconciliation]]
- [[_COMMUNITY_deliver_to Field|deliver_to Field]]
- [[_COMMUNITY_Delivery Context|Delivery Context]]
- [[_COMMUNITY_Direct Message & Mention Modes|Direct Message & Mention Modes]]
- [[_COMMUNITY_Direct-to-Slack Path|Direct-to-Slack Path]]
- [[_COMMUNITY_Dirty File Quarantine System|Dirty File Quarantine System]]
- [[_COMMUNITY_Disposable Worker Model (Default)|Disposable Worker Model (Default)]]
- [[_COMMUNITY_Docker Deployment Support|Docker Deployment Support]]
- [[_COMMUNITY_Enhancement Migrations (Post-Boot)|Enhancement Migrations (Post-Boot)]]
- [[_COMMUNITY_escalate_to_owner Field|escalate_to_owner Field]]
- [[_COMMUNITY_Freeform Answer Judging|Freeform Answer Judging]]
- [[_COMMUNITY_GitHub App Integration|GitHub App Integration]]
- [[_COMMUNITY_GitHub MCP auto-injection|GitHub MCP auto-injection]]
- [[_COMMUNITY_Idler Plugin (Off-Hours Autonomy)|Idler Plugin (Off-Hours Autonomy)]]
- [[_COMMUNITY_Two-Tier Instruction System|Two-Tier Instruction System]]
- [[_COMMUNITY_Linear OAuth2 Application Authentication|Linear OAuth2 Application Authentication]]
- [[_COMMUNITY_MCP Server Architecture|MCP Server Architecture]]
- [[_COMMUNITY_MCP Server Setup and Configuration|MCP Server Setup and Configuration]]
- [[_COMMUNITY_MCP Tools (Internal Server)|MCP Tools (Internal Server)]]
- [[_COMMUNITY_Metabase MCP Option A - jerichosequitin|Metabase MCP Option A - jerichosequitin]]
- [[_COMMUNITY_Metabase MCP Option B - CognitionAI|Metabase MCP Option B - CognitionAI]]
- [[_COMMUNITY_Migration System (Versioned)|Migration System (Versioned)]]
- [[_COMMUNITY_Monday.com MCP Integration|Monday.com MCP Integration]]
- [[_COMMUNITY_Multi-Repository Support|Multi-Repository Support]]
- [[_COMMUNITY_OAuth Token Authentication|OAuth Token Authentication]]
- [[_COMMUNITY_admin-config-tools spec|admin-config-tools spec]]
- [[_COMMUNITY_Auto Respond Rule Tools Specification (Final)|Auto Respond Rule Tools Specification (Final)]]
- [[_COMMUNITY_Auto Respond Specification (Final)|Auto Respond Specification (Final)]]
- [[_COMMUNITY_auto-respond-tracking spec|auto-respond-tracking spec]]
- [[_COMMUNITY_changes-workflow spec|changes-workflow spec]]
- [[_COMMUNITY_docker-deployment spec|docker-deployment spec]]
- [[_COMMUNITY_engaged-thread-registration spec|engaged-thread-registration spec]]
- [[_COMMUNITY_home-tab spec|home-tab spec]]
- [[_COMMUNITY_idler-plugin spec|idler-plugin spec]]
- [[_COMMUNITY_instruction-system spec|instruction-system spec]]
- [[_COMMUNITY_pinned-mcp-installs spec|pinned-mcp-installs spec]]
- [[_COMMUNITY_pr-reviewer-assignment spec|pr-reviewer-assignment spec]]
- [[_COMMUNITY_repo-instruction-files spec|repo-instruction-files spec]]
- [[_COMMUNITY_request-cancellation spec|request-cancellation spec]]
- [[_COMMUNITY_slack-classic-dm spec|slack-classic-dm spec]]
- [[_COMMUNITY_submit-response-mode spec|submit-response-mode spec]]
- [[_COMMUNITY_trivia-flexible-format spec|trivia-flexible-format spec]]
- [[_COMMUNITY_trivia-management-tools spec|trivia-management-tools spec]]
- [[_COMMUNITY_trivia-question-posting spec|trivia-question-posting spec]]
- [[_COMMUNITY_trivia-question-prep spec|trivia-question-prep spec]]
- [[_COMMUNITY_user-created-skills spec|user-created-skills spec]]
- [[_COMMUNITY_user-registry spec|user-registry spec]]
- [[_COMMUNITY_worker-ci-verification spec|worker-ci-verification spec]]
- [[_COMMUNITY_Permission System (Role-Gated)|Permission System (Role-Gated)]]
- [[_COMMUNITY_plugin-interactivity Specification|plugin-interactivity Specification]]
- [[_COMMUNITY_Plugin SDK|Plugin SDK]]
- [[_COMMUNITY_plugin-send-message Specification|plugin-send-message Specification]]
- [[_COMMUNITY_Plugin Thread Conversation Primitive|Plugin Thread Conversation Primitive]]
- [[_COMMUNITY_post_to Action|post_to Action]]
- [[_COMMUNITY_PR Reviewer Assignment (requirePRReviewers)|PR Reviewer Assignment (requirePRReviewers)]]
- [[_COMMUNITY_PR Spinoff Feature|PR Spinoff Feature]]
- [[_COMMUNITY_Prediction Question Type|Prediction Question Type]]
- [[_COMMUNITY_promptMedium Axis|promptMedium Axis]]
- [[_COMMUNITY_Query Mode (Q&A Sessions)|Query Mode (Q&A Sessions)]]
- [[_COMMUNITY_Question Types|Question Types]]
- [[_COMMUNITY_Reaction Trigger Mode|Reaction Trigger Mode]]
- [[_COMMUNITY_read_config_file MCP Tool|read_config_file MCP Tool]]
- [[_COMMUNITY_Repository Access Threshold|Repository Access Threshold]]
- [[_COMMUNITY_resolveCascade Function|resolveCascade Function]]
- [[_COMMUNITY_Reusable Worker Pool|Reusable Worker Pool]]
- [[_COMMUNITY_Admin Role|Admin Role]]
- [[_COMMUNITY_Dev Role|Dev Role]]
- [[_COMMUNITY_Member Role|Member Role]]
- [[_COMMUNITY_Owner Role|Owner Role]]
- [[_COMMUNITY_Role-Based Access Control (4 Tiers)|Role-Based Access Control (4 Tiers)]]
- [[_COMMUNITY_Runtime Status HTTP Endpoint|Runtime Status HTTP Endpoint]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_SeasonEntry|SeasonEntry]]
- [[_COMMUNITY_Trivia Seasons Feature|Trivia Seasons Feature]]
- [[_COMMUNITY_Semantic Config File Addressing|Semantic Config File Addressing]]
- [[_COMMUNITY_Session Completion Monitoring|Session Completion Monitoring]]
- [[_COMMUNITY_Session Context|Session Context]]
- [[_COMMUNITY_Session Management|Session Management]]
- [[_COMMUNITY_Session Memory with Refinements|Session Memory with Refinements]]
- [[_COMMUNITY_settle_question MCP Tool|settle_question MCP Tool]]
- [[_COMMUNITY_Silent Change Execution|Silent Change Execution]]
- [[_COMMUNITY_Slack Action Values|Slack Action Values]]
- [[_COMMUNITY_Slack App Manifest|Slack App Manifest]]
- [[_COMMUNITY_Slack Assistant|Slack Assistant]]
- [[_COMMUNITY_Slack Message Delivery|Slack Message Delivery]]
- [[_COMMUNITY_Slack Integration (Socket Mode)|Slack Integration (Socket Mode)]]
- [[_COMMUNITY_Slack Message Trigger|Slack Message Trigger]]
- [[_COMMUNITY_Direct Messages Trigger Mode|Direct Messages Trigger Mode]]
- [[_COMMUNITY_@Mentions Trigger Mode|@Mentions Trigger Mode]]
- [[_COMMUNITY_Reactions Trigger Mode|Reactions Trigger Mode]]
- [[_COMMUNITY_autoRespond.ts|autoRespond.ts]]
- [[_COMMUNITY_persistence.ts|persistence.ts]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_config.ts|config.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_config.ts|config.ts]]
- [[_COMMUNITY_errors.ts|errors.ts]]
- [[_COMMUNITY_t.ts|t.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_instructions.ts|instructions.ts]]
- [[_COMMUNITY_DEFAULT_GITHUB_REGISTRY_ENTRY|DEFAULT_GITHUB_REGISTRY_ENTRY]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_config.ts|config.ts]]
- [[_COMMUNITY_helpers.ts|helpers.ts]]
- [[_COMMUNITY_heuristic.ts|heuristic.ts]]
- [[_COMMUNITY_strings.ts|strings.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_usageInstruction.ts|usageInstruction.ts]]
- [[_COMMUNITY_findGif.ts|findGif.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_usageInstruction.ts|usageInstruction.ts]]
- [[_COMMUNITY_activity.ts|activity.ts]]
- [[_COMMUNITY_config.ts|config.ts]]
- [[_COMMUNITY_helpers.ts|helpers.ts]]
- [[_COMMUNITY_heuristic.ts|heuristic.ts]]
- [[_COMMUNITY_strings.ts|strings.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_instructions.ts|instructions.ts]]
- [[_COMMUNITY_activity.ts|activity.ts]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_registry.ts|registry.ts]]
- [[_COMMUNITY_findGif.ts|findGif.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_usageInstruction.ts|usageInstruction.ts]]
- [[_COMMUNITY_choice.ts|choice.ts]]
- [[_COMMUNITY_registry.ts|registry.ts]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_format.ts|format.ts]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_format.ts|format.ts]]
- [[_COMMUNITY_strings.ts|strings.ts]]
- [[_COMMUNITY_t.ts|t.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_TRIVIA_CHECK_INSTRUCTION|TRIVIA_CHECK_INSTRUCTION]]
- [[_COMMUNITY_registry.ts|registry.ts]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_testHelpers.ts|testHelpers.ts]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_autoRespond.ts|autoRespond.ts]]
- [[_COMMUNITY_choice.ts|choice.ts]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_homeTab.ts|homeTab.ts]]
- [[_COMMUNITY_homeTab.ts|homeTab.ts]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_text.ts|text.ts]]
- [[_COMMUNITY_helpers.ts|helpers.ts]]
- [[_COMMUNITY_text.ts|text.ts]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_loadSkill.ts|loadSkill.ts]]
- [[_COMMUNITY_testHelpers.ts|testHelpers.ts]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_loadSkill.ts|loadSkill.ts]]
- [[_COMMUNITY_errors.ts|errors.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_persistence.ts|persistence.ts]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_submit_response MCP Tool|submit_response MCP Tool]]
- [[_COMMUNITY_switch_delivery_context Tool|switch_delivery_context Tool]]
- [[_COMMUNITY_find_emoji MCP tool|find_emoji MCP tool]]
- [[_COMMUNITY_Tracked Memory Kinds|Tracked Memory Kinds]]
- [[_COMMUNITY_Trigger Types|Trigger Types]]
- [[_COMMUNITY_allTimeRow Field|allTimeRow Field]]
- [[_COMMUNITY_trivia-card-projection Specification|trivia-card-projection Specification]]
- [[_COMMUNITY_Trivia Cascade Registry|Trivia Cascade Registry]]
- [[_COMMUNITY_difficultyRatio Axis|difficultyRatio Axis]]
- [[_COMMUNITY_Enabled Flag on TriviaGame|Enabled Flag on TriviaGame]]
- [[_COMMUNITY_trivia-freeform-questions Specification|trivia-freeform-questions Specification]]
- [[_COMMUNITY_TriviaGame Registry|TriviaGame Registry]]
- [[_COMMUNITY_Hint Axis|Hint Axis]]
- [[_COMMUNITY_list_games MCP Tool|list_games MCP Tool]]
- [[_COMMUNITY_liveAnswersVisible Field|liveAnswersVisible Field]]
- [[_COMMUNITY_lockCron Optional Field|lockCron Optional Field]]
- [[_COMMUNITY_Migration 019 Trivia Games Data Move|Migration 019: Trivia Games Data Move]]
- [[_COMMUNITY_Per-Game Data Directory|Per-Game Data Directory]]
- [[_COMMUNITY_prepCron Optional Field|prepCron Optional Field]]
- [[_COMMUNITY_Trivia Question Generation Axes|Trivia Question Generation Axes]]

## God Nodes (most connected - your core abstractions)
1. `Claude Agent SDK` - 142 edges
2. `logger` - 127 edges
3. `errorMessage()` - 109 edges
4. `textResult()` - 104 edges
5. `t()` - 97 edges
6. `buildQueryTools()` - 96 edges
7. `errorResult()` - 82 edges
8. `getConfig()` - 71 edges
9. `ClackSdk` - 69 edges
10. `UserRole` - 66 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `loadConfig()`  [EXTRACTED]
  scripts/askClaude.ts → src/config.ts
- `main()` --calls--> `loadConfig()`  [EXTRACTED]
  scripts/askClaudeWorktree.ts → src/config.ts
- `main()` --calls--> `truncate()`  [EXTRACTED]
  scripts/dump-mcp-tools.ts → src/text.ts
- `buildTestTasks()` --calls--> `executeMigration()`  [EXTRACTED]
  scripts/migration-tests/run.ts → src/migrations/engine.ts
- `runFullPathTest()` --calls--> `executeMigration()`  [EXTRACTED]
  scripts/migration-tests/run.ts → src/migrations/engine.ts

## Import Cycles
- 3-file cycle: `src/plugins/trivia/answerTypes/registry.ts -> src/plugins/trivia/answerTypes/types.ts -> src/plugins/trivia/answerTypes/saveSchema.ts -> src/plugins/trivia/answerTypes/registry.ts`
- 3-file cycle: `src/plugins/trivia/answerTypes/saveSchema.ts -> src/plugins/trivia/questionTypes/registry.ts -> src/plugins/trivia/questionTypes/types.ts -> src/plugins/trivia/answerTypes/saveSchema.ts`
- 3-file cycle: `src/slack/app.ts -> src/slack/handlers/homeTab.ts -> src/slack/homeTab.ts -> src/slack/app.ts`
- 3-file cycle: `src/claude/skillsManager.ts -> src/sessions.ts -> src/tools/types.ts -> src/claude/skillsManager.ts`
- 3-file cycle: `src/workers/branchSwitch.ts -> src/workers/types.ts -> src/worktrees.ts -> src/workers/branchSwitch.ts`
- 3-file cycle: `src/config.ts -> src/configZod.ts -> src/configSchemas.ts -> src/config.ts`
- 4-file cycle: `src/plugins/trivia/answerTypes/saveSchema.ts -> src/plugins/trivia/questionTypes/registry.ts -> src/plugins/trivia/questionTypes/prediction.ts -> src/plugins/trivia/questionTypes/eventSource.ts -> src/plugins/trivia/answerTypes/saveSchema.ts`
- 4-file cycle: `src/plugins/trivia/answerTypes/saveSchema.ts -> src/plugins/trivia/questionTypes/registry.ts -> src/plugins/trivia/questionTypes/topical.ts -> src/plugins/trivia/questionTypes/eventSource.ts -> src/plugins/trivia/answerTypes/saveSchema.ts`
- 4-file cycle: `src/plugins/trivia/answerTypes/freeform.ts -> src/plugins/trivia/answerTypes/types.ts -> src/plugins/trivia/answerTypes/saveSchema.ts -> src/plugins/trivia/answerTypes/registry.ts -> src/plugins/trivia/answerTypes/freeform.ts`
- 4-file cycle: `src/plugins/trivia/answerTypes/saveSchema.ts -> src/plugins/trivia/questionTypes/registry.ts -> src/plugins/trivia/questionTypes/fact.ts -> src/plugins/trivia/questionTypes/compose.ts -> src/plugins/trivia/answerTypes/saveSchema.ts`
- 4-file cycle: `src/plugins/trivia/answerTypes/saveSchema.ts -> src/plugins/trivia/questionTypes/registry.ts -> src/plugins/trivia/questionTypes/prediction.ts -> src/plugins/trivia/questionTypes/compose.ts -> src/plugins/trivia/answerTypes/saveSchema.ts`
- 4-file cycle: `src/plugins/trivia/answerTypes/saveSchema.ts -> src/plugins/trivia/questionTypes/registry.ts -> src/plugins/trivia/questionTypes/topical.ts -> src/plugins/trivia/questionTypes/compose.ts -> src/plugins/trivia/answerTypes/saveSchema.ts`
- 4-file cycle: `src/plugins/trivia/answerTypes/boolean.ts -> src/plugins/trivia/answerTypes/types.ts -> src/plugins/trivia/answerTypes/saveSchema.ts -> src/plugins/trivia/answerTypes/registry.ts -> src/plugins/trivia/answerTypes/boolean.ts`
- 4-file cycle: `src/plugins/trivia/answerTypes/choice.ts -> src/plugins/trivia/answerTypes/types.ts -> src/plugins/trivia/answerTypes/saveSchema.ts -> src/plugins/trivia/answerTypes/registry.ts -> src/plugins/trivia/answerTypes/choice.ts`
- 4-file cycle: `src/plugins/trivia/answerTypes/saveSchema.ts -> src/plugins/trivia/questionTypes/registry.ts -> src/plugins/trivia/questionTypes/fact.ts -> src/plugins/trivia/questionTypes/types.ts -> src/plugins/trivia/answerTypes/saveSchema.ts`
- 4-file cycle: `src/plugins/trivia/answerTypes/saveSchema.ts -> src/plugins/trivia/questionTypes/registry.ts -> src/plugins/trivia/questionTypes/prediction.ts -> src/plugins/trivia/questionTypes/types.ts -> src/plugins/trivia/answerTypes/saveSchema.ts`
- 4-file cycle: `src/plugins/trivia/answerTypes/saveSchema.ts -> src/plugins/trivia/questionTypes/registry.ts -> src/plugins/trivia/questionTypes/topical.ts -> src/plugins/trivia/questionTypes/types.ts -> src/plugins/trivia/answerTypes/saveSchema.ts`
- 4-file cycle: `src/plugins/trivia/answerTypes/saveSchema.ts -> src/plugins/trivia/questionTypes/registry.ts -> src/plugins/trivia/questionTypes/types.ts -> src/plugins/trivia/answerTypes/types.ts -> src/plugins/trivia/answerTypes/saveSchema.ts`
- 4-file cycle: `src/claude/index.ts -> src/tools/server.ts -> src/tools/admin/listErrorReports.ts -> src/errorReports.ts -> src/claude/index.ts`
- 4-file cycle: `src/claude/index.ts -> src/tools/server.ts -> src/tools/admin/readErrorReport.ts -> src/errorReports.ts -> src/claude/index.ts`

## Hyperedges (group relationships)
- **MCP Configuration Shapes** — mcp_pinned_shape, mcp_legacy_shape, mcp_http_shape [EXTRACTED 1.00]
- **** — read_config_file_tool, propose_config_update_tool, list_config_files_tool [EXTRACTED 1.00]
- **** — answers_format_axis, trivia_question_type_axis, prompt_medium_axis [EXTRACTED 1.00]
- **** — trivia_list_games_tool, trivia_upsert_game_tool, trivia_game_registry [EXTRACTED 1.00]
- **** —  [INFERRED]
- **** —  [INFERRED]
- **** —  [INFERRED]
- **OpenSpec Workflow Skills** — openspec_archive_skill, openspec_bulk_archive_skill, claude_skills_openspec_explore_skill, claude_skills_openspec_propose_skill, claude_skills_openspec_sync_specs_skill, openspec_verify_skill, openspec_cli [INFERRED]
- **Trigger Modes** — reactions_trigger, dm_trigger, mentions_trigger, clack_slack_bot [INFERRED]
- **Image Search Plugins** — commons_image_search_plugin, brave_image_search_plugin, visual_trivia_questions [INFERRED]

## Communities (961 total, 273 thin omitted)

### Community 0 - "src/tools: logger.ts"
Cohesion: 0.04
Nodes (85): InteractiveHandlerDeps, ANSWER_TYPE_SAVE_FIELD_NAMES, getAllAnswerTypeHandlers(), getAnswerTypeHandler(), HANDLERS, HANDLERS_IN_ORDER, defaultGetGames(), defaultGetTriviaConfig() (+77 more)

### Community 1 - "trivia plugin"
Cohesion: 0.04
Nodes (83): Claude Agent SDK, CronJob, getJob(), JobOutcome, errorMessage(), canManageRoles(), getVisibleRepos(), ChannelResolverClient (+75 more)

### Community 2 - "CLAUDE.md: Clack (Claude + Slack Bot)"
Cohesion: 0.04
Nodes (90): createChannelsCache(), createEmojiCache(), createUsersCache(), createAddAutoRespondRuleTool(), createCancelReminderTool(), createCancelScheduledMessageTool(), createCancelWorkerRunTool(), createCreateScheduledMessageTool() (+82 more)

### Community 3 - "src/slack: handlerResponse.ts"
Cohesion: 0.10
Nodes (40): readRepoSkillBody(), ReadRepoSkillBodyResult, SkillActionDeps, registerCreateSubmit(), registerEditSubmit(), ProposeSkillCreateDeps, ProposeSkillDisableDeps, ProposeSkillRestoreDeps (+32 more)

### Community 4 - "src/slack: t()"
Cohesion: 0.04
Nodes (118): main(), parseArgs(), clearActiveChange(), TriggerType, askClaude(), AskClaudeOptions, buildSuccessResponse(), buildToolResults() (+110 more)

### Community 5 - "src/workers: errorMessage()"
Cohesion: 0.05
Nodes (41): findChangeEnabledRepo(), getChangeEnabledRepos(), isChangesEnabledForTrigger(), FollowUpInfo, isChannellessChannelId(), getWritableRepos(), NullDelivery, SilentDelivery (+33 more)

### Community 6 - "idler plugin"
Cohesion: 0.05
Nodes (47): HintInstallDeps, HintSlackClient, installHintButtonHandler(), ViewsOpenArgs, registerInteractiveHandlers(), initTriviaConfigBridge(), loadTriviaConfig(), answersSchema (+39 more)

### Community 7 - "src/claude: main()"
Cohesion: 0.07
Nodes (61): ActiveChangeState, getActiveChange(), resolveNonCollidingBranch(), ExecuteChangeOptions, SpinoffIntentData, ChangePlan, ChangeRequest, ChangeResult (+53 more)

### Community 8 - "memoryRegistry: roles.ts"
Cohesion: 0.09
Nodes (40): assembleBooleanVoters(), BOOLEAN_SAVE_FIELDS, booleanAnswerHandler, buildExcludeSet(), isScoredAnswer(), loadQuestionCheaterIds(), assembleChoiceVoters(), CHOICE_NUMBER_EMOJI (+32 more)

### Community 9 - "commons-image-search plugin"
Cohesion: 0.05
Nodes (54): allTimeRowSchema, ANSWERS_FORMAT_KEYS, answersFormatSchema, axisFieldsZod, bucketWeightsZod, choiceEmojiStyleSchema, choicesSchema, contextsSchema (+46 more)

### Community 10 - "src/streaming: lifecycle.ts"
Cohesion: 0.07
Nodes (51): addRule(), AutoRespondRulePatch, autoRespondRuleZod, AutoRespondState, autoRespondStateZod, DEFAULT_STATE, deleteRule(), findMatchingRule() (+43 more)

### Community 11 - "sessions: sessions.ts"
Cohesion: 0.09
Nodes (17): ClackSessionRun, ClaudeRunDriver, ClaudeRunHandle, ClaudeRunStatus, createRunHandle(), CreateRunHandleOptions, RunFailureError, FakeRunHandle (+9 more)

### Community 12 - "misc: Zod schema validation"
Cohesion: 0.13
Nodes (26): casualTalkConfigSchema, channelSchema, DEFAULT_CONFIG, loadConfig(), saveConfig(), workHoursSchema, errorResult(), JsonPrimitive (+18 more)

### Community 13 - "cronJobs: cronJobs.ts"
Cohesion: 0.04
Nodes (47): Purpose, Requirement: Abort Worker via Stop Reaction, Requirement: Cancel Queued Change, Requirement: cancel_worker_run MCP Tool, Requirement: Cancellation Display, Requirement: Re-Engagement via Change-Thread Button Click, Requirement: Worker Execution Handle Pipeline, Requirement: Worker Mid-Run Context Injection (+39 more)

### Community 14 - "src/slack: submitResponse.ts"
Cohesion: 0.08
Nodes (31): ClaudeMessageParser, detectPlatformError(), extractToolErrorMessage(), joinContentBlocks(), ParsedMessage, ParsedResult, PendingToolUse, stringifyToolResultContent() (+23 more)

### Community 15 - "trivia plugin"
Cohesion: 0.12
Nodes (24): JsonObject, ClackUser, UsersSurfaceDeps, UpdateUserDeps, defaultUserRegistryDeps, getRegistryPath(), getStateDir(), getUserNamespace() (+16 more)

### Community 16 - "src/migrations: types.ts"
Cohesion: 0.11
Nodes (16): findRepoByName(), switchToDefault(), AlreadyInFlight, Cancelled, DirtyWorkerQuarantined, PoolExhausted, clearQuarantineRecord(), getDirtyTrackedFiles() (+8 more)

### Community 17 - "src/claude: index.ts"
Cohesion: 0.04
Nodes (46): boot-migrations Specification, Purpose, Requirement: Admin Interaction During Migration, Requirement: Blocking Migration Execution, Requirement: Boot Migration Rewrites Legacy Cron Config Fields, Requirement: Claude-Powered Migration Execution, Requirement: Create-Migration Skill, Requirement: Enhancement Migration Execution (+38 more)

### Community 18 - "userSkills: userSkills.ts"
Cohesion: 0.04
Nodes (82): AttentionLevel, DeliveryMode, validateActionButtonLabels(), AuthoredTableBlock, Block, extractDisplayText(), validateBlocks(), validateTable() (+74 more)

### Community 19 - "src/slack: userSkillsHomeActions.ts"
Cohesion: 0.05
Nodes (46): test, test, test, test, test, test, test, test (+38 more)

### Community 20 - "configZod: configZod.ts"
Cohesion: 0.07
Nodes (41): AutoRespondRule, ActiveWorker, InstructionFileListing, InstructionFileSearchResult, failedServers, getFailedMcpServers(), getMigrationErrors(), MigrationError (+33 more)

### Community 21 - "scripts/migration-tests: run.ts"
Cohesion: 0.06
Nodes (70): clearAutoRespondCache(), getActiveChangeBranches(), startCompletionMonitor(), stopCompletionMonitor(), prepareMcpSession(), testMCP(), reinstallPinned(), clearCronJobsCache() (+62 more)

### Community 22 - "spec: instruction-system"
Cohesion: 0.10
Nodes (34): loadConfig(), loadFetchInstructions(), errorResult(), textResult(), en, fr, idlerPlugin(), computePriority() (+26 more)

### Community 23 - "src/streaming: SlackStreamer"
Cohesion: 0.12
Nodes (37): answersFormatZod, contextsZod, difficultyZod, freeformAnswerShapeZod, ParseIssue, promptMediumZod, questionTypeZod, REVEAL_RESPONSES_VALUES (+29 more)

### Community 24 - "misc: function"
Cohesion: 0.06
Nodes (62): Lang, en, StringKey, fr, activeLanguage(), Args, DICTIONARIES, fallbackWarned (+54 more)

### Community 25 - "src/tools: aggregate.ts"
Cohesion: 0.04
Nodes (44): author, dependencies, @anthropic-ai/claude-agent-sdk, cron-parser, dotenv, @giphy/js-fetch-api, @google/genai, @octokit/auth-app (+36 more)

### Community 26 - "gemini-image plugin"
Cohesion: 0.08
Nodes (42): Actor, ActorDeps, actorDisplay(), actorDmTarget(), defaultDeps, resolveJobActor(), makeChannellessChannelId(), deleteJob() (+34 more)

### Community 27 - "src/claude: SkillsManager"
Cohesion: 0.07
Nodes (32): firstInlineImage(), GeminiError, GeminiImageResult, GeminiInputImage, GenAiContents, GenAiLike, GenAiPart, GenAiResponse (+24 more)

### Community 28 - "spec: trivia-games"
Cohesion: 0.08
Nodes (40): activeChanges, ACTIVELY_EXECUTING_STATUSES, ActiveStateDeps, buildChangeSessionForPersistence(), countActiveChangesForUser(), defaultActiveStateDeps, getActiveChangeForUser(), SessionRef (+32 more)

### Community 29 - "scripts/generate-manifest.ts: generate-manifest."
Cohesion: 0.11
Nodes (28): AxisDef, AxisRegistry, CASCADE_TIER_ORDER, CascadeLadderEntry, CascadeResolution, CascadeTier, ConcreteTier, CustomResolveOpts (+20 more)

### Community 30 - "src/workers: WorkerQueue"
Cohesion: 0.08
Nodes (39): updateActiveChangeStatus(), appendExecutionLog(), CheckRunInput, CheckRunSummary, CIChecksSnapshot, CIChecksStatus, classifyCheckRuns(), defaultPrDeps (+31 more)

### Community 31 - "src/tools: envFile.ts"
Cohesion: 0.15
Nodes (24): getCronMaxRunHistory(), assertValidJitter(), CreateCronJobParams, createJob(), CronJobState, cronJobStateZod, cronJobZod, CronRun (+16 more)

### Community 32 - "src/tools: proposeConfigUpdate.testHelpers.ts"
Cohesion: 0.07
Nodes (45): ConversationMessage, ErrorReport, MessageReaction, SlackAttachment, SlackBlock, openDmChannel(), setupDmDelivery(), BlockLike (+37 more)

### Community 33 - "src/tools: configFieldSchemas.ts"
Cohesion: 0.06
Nodes (38): McpSessionSetupDeps, clackQuery(), defaultSkillsManagerDeps, defaultSkillsSessionSetupDeps, loadKey(), PackInfo, parseFrontmatter(), prepareSkillsSession() (+30 more)

### Community 34 - "src/slack: assistantContextStore.ts"
Cohesion: 0.12
Nodes (20): migration, migration, migration, migration, migration, migration, migration, migration (+12 more)

### Community 35 - "spec: streaming-responses"
Cohesion: 0.11
Nodes (34): Accumulators, bump(), Counter, createAccumulators(), finalize(), foldSession, HUMAN_INITIATED, localDayKey() (+26 more)

### Community 36 - "spec: trivia-question-contexts"
Cohesion: 0.18
Nodes (14): detachActiveChangeWorktree(), getActiveWorkers(), checkSessionCompletion(), CleanupAction, cleanupSession(), CompletionCheckResult, defaultGetReusablePool(), defaultMonitorDeps (+6 more)

### Community 37 - "docs/setup-mcp-servers.md: MCP Server Setup and "
Cohesion: 0.10
Nodes (32): McpServerRegistry, defaultMcpDeps, ExecSyncOptions, getMcpConfigPath(), isRemoteEntry(), loadStaticMcpConfig(), McpConfig, McpDeps (+24 more)

### Community 38 - "spec: worker-cancellation"
Cohesion: 0.06
Nodes (32): PersistenceDeps, AdminConfig, AssistantSuggestedPrompt, AutoRespondConfig, ChangesWorkflowConfig, ClaudeCodeConfig, DirectMessagesConfig, DmType (+24 more)

### Community 39 - "src/tools: testHelpers.ts"
Cohesion: 0.11
Nodes (15): getWorktreesDir(), RepositoryConfig, DeepenHistoryDeps, FindPullRequestsDeps, GitLogDeps, ListRepositoriesDeps, GitPushDeps, makeWorkerConfig() (+7 more)

### Community 40 - "README.md: Claude Code Authentication"
Cohesion: 0.10
Nodes (29): fetchQuestionReactions(), parseMessageCoordinates(), renderPlayerRef(), buildLockedNotice(), buildRosterBlock(), buildRosterDivider(), editRosterIntoCard(), groupRosterAnswers() (+21 more)

### Community 41 - "misc: Changes Workflow System"
Cohesion: 0.16
Nodes (8): AnswerTypeHandler, ClickableAnswerHandler, JsonValue, SubmittedAnswer, TriviaQuestion, EditRosterParams, RosterGroup, BuildSeeAnswerModalParams

### Community 42 - "spec: auto-execute-actions"
Cohesion: 0.18
Nodes (5): IdleSweepPool, runIdleSweep(), ReusableFoldersConfig, ReusablePool, Worker

### Community 43 - "spec: user-roles"
Cohesion: 0.06
Nodes (49): CronConfig, loadSlackAuth(), SlackAuthConfig, adminZod, assistantZod, emojiField(), isPlainObject(), mcpServersZod (+41 more)

### Community 44 - "spec: pinned-mcp-installs"
Cohesion: 0.12
Nodes (22): ALL_ANSWER_TYPE_SAVE_FIELDS, COMMON_SAVE_FIELDS, SAVE_QUESTION_HANDLER_FIELDS, SaveQuestionArgs, GetSavedQuestionOutcome, SaveValidationContext, TriviaQuestionBase, composeDeferred() (+14 more)

### Community 45 - "testUtils: testUtils.ts"
Cohesion: 0.14
Nodes (15): resolveTellMeMore(), en, fr, fallbackT(), interpolate(), t(), TFn, TVars (+7 more)

### Community 46 - "trivia plugin"
Cohesion: 0.07
Nodes (18): ScopedTriviaDataLayer, BaseClickContext, findGameForQuestion(), installPostGameButtons(), makeHandler(), OneShotClickContext, OneShotPostGameButton, PersistentClickContext (+10 more)

### Community 47 - "spec: file-upload"
Cohesion: 0.08
Nodes (22): SkipDate, AskClaudeOptions, AskClaudeResult, ClackSdkCapabilities, createClackSdk(), CronJobSpec, PluginDictionary, PluginLogger (+14 more)

### Community 48 - "spec: slack-file-attachments"
Cohesion: 0.10
Nodes (33): loadConfig(), errorReportZod, getErrorReportsDir(), getReportFilename(), listErrorReports(), readErrorReport(), writeErrorReport(), defaultFileExistsDeps (+25 more)

### Community 49 - "spec: trivia-cheating-detection"
Cohesion: 0.06
Nodes (34): ArchivedMemory, archivedMemoryZod, ArchiveLeanNote, ArchiveStore, archiveStoreZod, beforeExpireHooks, BeforeExpireResult, defaultMemoryRegistryDeps (+26 more)

### Community 50 - "misc: function"
Cohesion: 0.08
Nodes (6): RoleDir, ClackSdk, RegisteredInstruction, RegisteredMcpServer, buildHintModal(), BuildHintModalParams

### Community 51 - "misc: function"
Cohesion: 0.15
Nodes (35): parseTriviaConfigObject(), isRevealResponsesMode(), parseTriviaAxisBag(), validateAllTimeRowMode(), validateAnswersFormatMap(), validateChoiceEmojiStyle(), validateContextsList(), validateFinalRevealSummary() (+27 more)

### Community 52 - "spec: find-emoji-tool"
Cohesion: 0.04
Nodes (85): PreAnalysisMessage, AssistantPaneConfig, executeJob(), runJobNow(), isDev(), findSessionByThread(), isEngaged(), setAttentionLevel() (+77 more)

### Community 53 - "spec: github-mcp-auto-config"
Cohesion: 0.04
Nodes (44): memory-faculty Specification, Purpose, Requirement: Core memory store and record shape, Requirement: Daily relevance review, Requirement: Graceful permissive persistence with serialized writes, Requirement: Per-plugin namespace surface with core-first merge, Requirement: remember and recall query tools, Requirement: staleAfter expiry with pre-expire veto hook (+36 more)

### Community 54 - "spec: config-update-via-chat"
Cohesion: 0.10
Nodes (10): QuerySetup, AttachFailure, AttachResult, AttachSuccess, completeSessionStart(), defaultMcpSessionSetupDeps, McpServerManager, McpSessionSetup (+2 more)

### Community 55 - "spec: config-update-via-chat"
Cohesion: 0.07
Nodes (26): ALLOWED_BLOCK_TYPES, AuthoredImageBlock, AuthoredRichTextElement, cardBlockSchema, cardImageObjectSchema, carouselBlockSchema, contextBlockSchema, contextElementSchema (+18 more)

### Community 56 - "spec: manifest-generation"
Cohesion: 0.14
Nodes (19): createFindImageTool(), braveImageSearchPlugin(), createFindSubjectTool(), commonsImageSearchPlugin(), BUILTIN_PLUGINS, deriveLocalPluginName(), installPluginInteractivity(), isPathEntry() (+11 more)

### Community 57 - "spec: owner-error-escalation"
Cohesion: 0.08
Nodes (24): failed-change-recovery spec, Purpose, Requirement: Continue Command, Requirement: Discard Command, Requirement: Recovery Actions on Execution Failure, Requirement: Recovery Concurrency Guard, Requirement: Recovery Permissions, Requirement: Start Over Command (+16 more)

### Community 58 - "spec: auto-respond"
Cohesion: 0.07
Nodes (58): ALL_ROLE_DIRS, buildRoleChain(), InstructionFileEntry, listRoleDirFiles(), listRoleTopicDirFiles(), listSingleDirFiles(), readRoleFile(), readRoleTopicFile() (+50 more)

### Community 59 - "spec: slack-classic-dm"
Cohesion: 0.14
Nodes (20): defaultFindSubjectDeps, FindSubjectDeps, CommonsImageInfoResponse, CommonsPage, EXTENSION_MIME, ExtMetadataField, extractExtMetadata(), fetchImageBytes() (+12 more)

### Community 60 - "images/clacknowledged-128.png: Clacknowledged 12"
Cohesion: 0.10
Nodes (20): baseConfigSchema, DEFAULT_CONFIG, idlerConfigSchema, isOperational(), reportingSchema, saveConfig(), sourcesSchema, windowSchema (+12 more)

### Community 61 - "vitest.config.ts: vitest.config.ts"
Cohesion: 0.05
Nodes (43): Purpose, Requirement: Change Request Audit, Requirement: Change Request Authorization, Requirement: Disabled User Detection, Requirement: Ownership Management, Requirement: Role Hierarchy, Requirement: Role Storage, Requirement: Roles state loading is schema-driven (+35 more)

### Community 62 - "scripts/monday-oauth.mjs: monday-oauth.mjs"
Cohesion: 0.09
Nodes (35): getTaskCardMaxDetails(), ToolMapping, getLoadedPlugins(), getToolGroup(), getToolLabel(), parseToolName(), resolve(), resolveGroupMaxDetails() (+27 more)

### Community 63 - "openspec/project.md: Project Context - Clack Bot"
Cohesion: 0.15
Nodes (4): fmtElapsed(), getSlackErrorCode(), SlackStreamer, getToolDetails()

### Community 64 - "spec: admin-config-tools"
Cohesion: 0.05
Nodes (42): Purpose, Requirement: Automatic Migration Of Pre-Existing Scheduled Prompts, Requirement: Cancel a Scheduled Message, Requirement: Configuration Gate, Requirement: Cron-jobs load is schema-driven, Requirement: List Scheduled Messages, Requirement: Schedule a Message, Requirement: Scheduled Cron-Job Prompt Format Guidance Uses Blocks Vocabulary (+34 more)

### Community 65 - "spec: admin-delete-message"
Cohesion: 0.05
Nodes (41): Purpose, Requirement: Cheat data is admin-only on read, Requirement: Cheat Report Log, Requirement: Owner Notification Driven By Trivia-Check Instruction, Requirement: `remove_cheat` admin tool removes a report and decrements the counter, Requirement: Save Cheating Tool, Requirement: Trivia-Check Instruction Ships With Plugin, Requirement: TriviaUser cheatAttempts Field (+33 more)

### Community 66 - "spec: admin-edit-instructions"
Cohesion: 0.12
Nodes (21): ArrayElement, AutoRespondConfig, BotScope, buildEvents(), buildScopes(), ConfigFeatures, CORE_EVENTS, CORE_SCOPES (+13 more)

### Community 67 - "spec: admin-env-tools"
Cohesion: 0.05
Nodes (39): auto-respond-tracking Specification, Purpose, Requirement: Auto-Respond Tracking State, Requirement: Disengagement via Inline Stop Emoji, Requirement: Disengagement via Pre-Analysis, Requirement: Disengagement via Stop Reaction, Requirement: Disengagement via stop_tracking Tool, Requirement: Prompt Guidance for Disengagement (+31 more)

### Community 68 - "spec: admin-role-tool"
Cohesion: 0.05
Nodes (39): Purpose, Requirement: Channelless Delivery Context Forces Optional-Post-To Schema, Requirement: Mode Precedence Over Auto-Derivation, Requirement: Prompt Guidance for "skipped" Mode, Requirement: requiredTools Gate Runs Before the Skip Branch, Requirement: submit_response Schema Variant for "optional-post-to" Mode, Requirement: submit_response Schema Variant for "skipped" Mode, Requirement: submitResponseMode Field on Cron Jobs (+31 more)

### Community 70 - "spec: auto-respond-pre-analysis"
Cohesion: 0.18
Nodes (16): discoverWorkerSkills(), getWorkerSkillMtimeMs(), listSlugs(), readDescription(), readWorkerSkillBody(), ReadWorkerSkillBodyResult, resolveSkillPath(), WorkerSkill (+8 more)

### Community 71 - "spec: auto-respond-tracking"
Cohesion: 0.14
Nodes (21): DISMISSAL_PHRASES, DISMISSAL_PHRASES_INLINE, buildQuerySetup(), wrapDeliverWithDeliveredMark(), ALWAYS_HIDDEN_FROM_CATALOG, buildIntegrationsCatalog(), ADMIN_CLAIM_KEYWORDS, attentionLevelGuidance() (+13 more)

### Community 72 - "spec: find-emoji-tool"
Cohesion: 0.14
Nodes (15): createFindGifTool(), defaultFindGifDeps, FindGifDeps, MEDIA_TYPE, RATING, SORT, GiphyGifLike, GiphyMediaType (+7 more)

### Community 73 - "spec: find-user-tool"
Cohesion: 0.10
Nodes (31): updateThreadContext(), activeSessions, AppDeps, defaultAppDeps, decodeActionValue(), tryParseEncodedActionValue(), registerAssistant(), registerAutoRespondHandler() (+23 more)

### Community 74 - "spec: git-log-tools"
Cohesion: 0.12
Nodes (9): ChannelApiResult, ChannelsCache, ChannelsCacheClient, SlackChannelEntry, EmojiCache, EmojiCacheEntry, SlackUserEntry, UsersCache (+1 more)

### Community 75 - "spec: github-app"
Cohesion: 0.13
Nodes (18): TriviaFreeformAnswerShape, buildSingleJudgePrompt(), judgeAnswer(), JudgedSubmission, JudgePrompt, JudgeSubmission, judgeSubmissions(), JudgeVerdict (+10 more)

### Community 76 - "spec: github-mcp-auto-config"
Cohesion: 0.13
Nodes (17): VerificationCheck, CheckFailResult, CheckPassResult, CheckRunResult, defaultKillGroup(), defaultRunVerificationChecksDeps, formatSeconds(), GateRunResult (+9 more)

### Community 77 - "spec: instruction-variables"
Cohesion: 0.05
Nodes (39): Purpose, Requirement: Axis registry is compile-time exhaustive, Requirement: Cascade resolution has a single implementation, Requirement: Custom-resolution axes remain registry-enforced, Requirement: explain_cascade audit tool, Requirement: Generic cascade resolver reports value and winning tier, Requirement: Parser axis set matches CascadeAxes, Requirement: Project documentation describes the unified cascade (+31 more)

### Community 78 - "spec: lazy-skill-loading"
Cohesion: 0.10
Nodes (27): getConfiguredRepoNames(), REPO_FILE_ENUM, createProposeConfigUpdateTool(), defaultProposeConfigUpdateDeps, ProposeConfigUpdateDeps, callTool(), fakeConfig, fakeSession (+19 more)

### Community 79 - "spec: manifest-generation"
Cohesion: 0.19
Nodes (15): CascadeAxes, TriviaAxisBag, ChoiceEmojiStyle, PromptMediumWeights, TriviaAnswersFormatWeights, TriviaChoicesConfig, TriviaContextEntry, TriviaDifficultyConfig (+7 more)

### Community 80 - "spec: session-transcript-tool"
Cohesion: 0.20
Nodes (17): getStateDir(), zodErrorToResult(), ensureStateDir(), fromPersisted(), loadPoolState(), normalizeRestartStatus(), PersistedWorker, persistedWorkerZod (+9 more)

### Community 81 - "spec: skip-response"
Cohesion: 0.12
Nodes (15): actionHandlers, actionPatterns, dispatchAction(), DispatchResult, dispatchView(), findActionHandler(), findViewHandler(), logOrphanAction() (+7 more)

### Community 82 - "spec: slack-channel-resolver"
Cohesion: 0.11
Nodes (17): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution (+9 more)

### Community 83 - "spec: streaming-responses"
Cohesion: 0.16
Nodes (12): AuthoredTableCell, ALLOWED_IMAGE_KEYS, BlockValidationError, cardFieldPath(), cardLabel(), imageSourceError(), InCarouselContext, validateCard() (+4 more)

### Community 84 - "spec: tool-label-config"
Cohesion: 0.05
Nodes (53): main(), detectFollowUpCommand(), defaultRunClaudeDeps, drainStagedSpinoffs(), executeChange(), readBranchHead(), resolveChangesInstructions(), runClaude() (+45 more)

### Community 85 - "spec: trivia-categories"
Cohesion: 0.05
Nodes (39): Purpose, Requirement: close_pr Tool, Requirement: ensure_pr Tool, Requirement: git_push Tool, Requirement: merge_pr Tool, Requirement: Raw git push blocked in worker mode, Requirement: report_status Tool, Requirement: Worker Tools Never Throw (+31 more)

### Community 86 - "spec: user-preferences"
Cohesion: 0.27
Nodes (12): convertMarkdownToSlack(), splitForSlack(), prepareBlocks(), prepareCard(), prepareCarousel(), prepareContext(), prepareMarkdown(), prepareSection() (+4 more)

### Community 87 - "spec: instruction-variables"
Cohesion: 0.12
Nodes (31): canCreateUserSkill(), canDeleteUserSkill(), canEditConfig(), canEditUserSkillContent(), canManageUserSkill(), meetsMinimumRole(), ROLE_HIERARCHY, userCanEditConfig() (+23 more)

### Community 88 - "CLAUDE.md: Session Persistence"
Cohesion: 0.21
Nodes (15): setPinnedSpawnConfig(), assertSafePackageName(), assertSafeServerName(), defaultInstallAllDeps, defaultMcpInstallerDeps, ensureInstalled(), EnsureInstalledResult, InstallAllDeps (+7 more)

### Community 89 - "spec: config-update-via-chat"
Cohesion: 0.21
Nodes (11): DEFAULT_PREFERENCES, defaultUserPreferencesDeps, getPreferencesPath(), getStateDir(), loadPreferences(), PreferencesMap, preferencesMapZod, ReactionDelivery (+3 more)

### Community 91 - "spec: manifest-generation"
Cohesion: 0.19
Nodes (14): cloneValidRegistry(), isJsonObject(), JsonArray, JsonObject, JsonPrimitive, JsonValue, migration, parseMcpServerNames() (+6 more)

### Community 92 - "spec: trivia-choice-questions"
Cohesion: 0.13
Nodes (8): ConfigShape, CronJob, CronJobsFile, CronRun, FLAT_FILES, migration, QuestionRowWithTimestamps, TriviaGameRecord

### Community 93 - "spec: trivia-prediction-questions"
Cohesion: 0.05
Nodes (38): Purpose, Requirement: Image-Only Reaction Handling, Requirement: Reaction Detection, Requirement: Stop Reaction Configuration, Requirement: Stop Reaction Trigger, Requirement: Thread Context Reading, Requirement: Work Mode Reaction Trigger, Requirements (+30 more)

### Community 94 - "spec: trivia-visual-questions"
Cohesion: 0.17
Nodes (12): Tenor GIF Plugin, 1. Set the API key, 2. Enable the plugin, 3. Restart Clack, Authentication, Behavior, Configuration, Notes (+4 more)

### Community 98 - "spec: trivia-question-locking"
Cohesion: 0.27
Nodes (9): connectHttp(), connectStdio(), main(), McpConfig, McpRemoteConfig, McpServerEntry, McpStdioConfig, substituteEnvVars() (+1 more)

### Community 99 - "spec: trivia-post-game-buttons"
Cohesion: 0.05
Nodes (37): plugin-cron-reconciliation Specification, Purpose, Requirement: Boot Migration For Legacy Plugin-Managed Jobs, Requirement: CronJobSpec Jitter Passthrough, Requirement: Declarative Reconcile API On ClackSdk, Requirement: pluginManaged Field On CronJob, Requirement: Reconcile Is Gated By Plugin Self-Check, Not By Config Field, Requirement: Reconcile Runs On Plugin Init (+29 more)

### Community 100 - "spec: channel-context"
Cohesion: 0.26
Nodes (13): circularRuns(), DAY_NAME_MAP, DAY_NAMES, expandHourList(), formatDayOfWeekSuffix(), formatHour(), formatSubDaily(), humanReadableSchedule() (+5 more)

### Community 101 - "spec: attention-level"
Cohesion: 0.05
Nodes (37): Purpose, Requirement: Channel Mention Handling, Requirement: Direct Message Handling, Requirement: Image-Only DM Handling, Requirement: Image-Only Mention Handling, Requirement: Inline Stop Emoji Detection, Requirement: Message Mode Configuration, Requirement: Visible Response Updates (+29 more)

### Community 102 - "spec: lazy-mcp-loading"
Cohesion: 0.05
Nodes (36): active-runs-registry, Purpose, Requirement: Active-Runs Registry, Requirement: Atomic Slot Claim, Requirement: Handler Routing Decision, Requirement: No Untracked Duplicate Runs, Requirement: Registry Entry Start Time and Snapshot, Requirement: Registry Replaces Prior Tracking Mechanisms (+28 more)

### Community 105 - "spec: cron-messages"
Cohesion: 0.05
Nodes (36): localization Specification, Purpose, Requirement: Claude Language Directive, Requirement: Dictionary File Layout and Placeholder Parity, Requirement: Direct-to-Slack String Coverage, Requirement: Language Configuration Field, Requirement: Language Metadata Registry, Requirement: t() Translation Helper (+28 more)

### Community 106 - "spec: auto-respond-pre-analysis"
Cohesion: 0.14
Nodes (19): archive(), forgetMemory(), getMemory(), getMemoryNamespace(), listMemory(), loadMemoryStore(), mergeMemoryNamespace(), pruneArchive() (+11 more)

### Community 107 - "spec: repository-management"
Cohesion: 0.17
Nodes (9): ConfigShape, migrateSeasonEntry(), migrateSeasonsFile(), migration, QuestionRow, SeasonEntry, SeasonsFile, SeasonSlot (+1 more)

### Community 108 - "spec: error-reporting"
Cohesion: 0.24
Nodes (11): entryFor(), entryId(), foldIdlerLedgerIntoMemory(), isJsonObject(), JsonArray, JsonObjectShape, JsonPrimitive, JsonValue (+3 more)

### Community 109 - "spec: conversation-stats"
Cohesion: 0.07
Nodes (28): trivia-seasons Specification, Purpose, Requirement: Lazy per-game season bootstrap, Requirement: Per-season and per-slot `revealResponses` accept `"just-winners"`, Requirement: Season config validation is schema-driven, Requirement: Seasons leaderboard row composition (normal reveals), Requirement: Sparse-season write philosophy generalized, Requirement: trivia-check instruction advertises games and timeline management (+20 more)

### Community 110 - "RepositoryConfig"
Cohesion: 0.26
Nodes (10): buildGameSpecs(), LOCK_REQUIRED_TOOLS, PREP_REQUIRED_TOOLS, QUESTION_BASE_REQUIRED_TOOLS, questionRequiredTools(), REVEAL_REQUIRED_TOOLS, substituteGame(), warnIfPrepAfterQuestion() (+2 more)

### Community 111 - "errorMessage"
Cohesion: 0.06
Nodes (35): auto-respond-rule-tools Specification, Purpose, Requirement: Add Auto-Respond Rule Tool, Requirement: Auto-Respond Rule Tools Admin Gate, Requirement: Delete Auto-Respond Rule Tool, Requirement: Direct-Mutation Execution Model, Requirement: List Auto-Respond Rules Tool, Requirement: Toggle Auto-Respond Rule Tool (+27 more)

### Community 113 - "fetchChannelMessages.ts"
Cohesion: 0.18
Nodes (10): categories, correctness, ignorePatterns, overrides, plugins, rules, no-console, no-unused-vars (+2 more)

### Community 114 - "Requirements"
Cohesion: 0.06
Nodes (35): Purpose, Requirement: Skip Response Message Deletion, Requirement: Skip Response Prompt Guidance, Requirement: Skip Response Safeguard Validation, Requirement: Skip Response Session Handling, Requirement: Skip Response Trigger Gating, Requirements, Scenario: attention_level parameter validation (+27 more)

### Community 115 - "types.ts"
Cohesion: 0.22
Nodes (5): BeforeExpireHook, MemoryEntry, MemorySearchResult, SearchMemoryArgs, ClackSdkMemory

### Community 116 - "Requirement: remember and recall query tools"
Cohesion: 0.22
Nodes (9): defaultFindGifDeps, FindGifDeps, searchTenor(), SearchTenorParams, TenorError, TenorMediaFormatSchema, TenorResponseSchema, TenorResultSchema (+1 more)

### Community 117 - "scripts"
Cohesion: 0.25
Nodes (8): BoltPayload, ContextStoreArgs, extractThreadInfo(), keyFor(), PerThreadContextStore, ThreadContext, ThreadContextStore, ThreadInfo

### Community 118 - "Requirements"
Cohesion: 0.20
Nodes (9): 1. Parse the Slack link, 2. Locate the session, 3. Reconstruct the story, 4. Investigate the code, 5. Write the assessment, Debug a Slack session, Inputs, Notes (+1 more)

### Community 119 - "blockSchema.ts"
Cohesion: 0.13
Nodes (19): BRANCH_TYPES, ResumableSession, defaultSpinoffGitOps, SpinoffGitOps, spinoffIntentSchema, spinoffPatchPath(), getSpinoffPatchesDir(), canReadRepo() (+11 more)

### Community 120 - "index.ts"
Cohesion: 0.06
Nodes (35): Purpose, Requirement: post_questions and reveal flows are agnostic to questionType, Requirement: questionType axis on question records and configuration, Requirement: save_question validates topical fields, Requirement: suggestedQuestionType in get_ideas response, Requirement: Topical generation path uses WebSearch, Requirement: Topical question record carries source citation, Requirements (+27 more)

### Community 121 - "index.ts"
Cohesion: 0.06
Nodes (35): Per-row response, Requirement: Find previous questions tool, Scenario: Boolean rows match only on their statement, Scenario: category is not part of the keyword haystack, Scenario: Cross-game scan when `games` is omitted, Scenario: Default match is "all" — every supplied criterion must hit, Scenario: Disabled game allows cross-game search (frozen archive), Scenario: Empty arrays equal omitted arrays (+27 more)

### Community 122 - "Requirement: Schedule a Message"
Cohesion: 0.29
Nodes (9): entryFor(), foldTriviaUsersIntoRegistry(), isJsonObject(), JsonArray, JsonObjectShape, JsonPrimitive, JsonValue, migration (+1 more)

### Community 123 - "configurationFiles.ts"
Cohesion: 0.06
Nodes (32): auto-execute-actions Specification, Purpose, Requirement: Auto-Execute Flag on Ref-Based Actions, Requirement: Auto-Execute Permission Gating, Requirement: Claude Instruction Guidance for Auto-Execute, Requirement: post_to Thread Engagement, Requirements, Scenario: Ambiguous intent uses button (+24 more)

### Community 124 - "Requirements"
Cohesion: 0.31
Nodes (7): ENV_PATH, isValidEnvKey(), listEnvKeys(), loadEnvLines(), SetEnvResult, setEnvVar(), writeEnvLines()

### Community 126 - "Requirements"
Cohesion: 0.06
Nodes (32): ADDED Requirements, Purpose, Requirement: Assistant Delivery Context Preserves Pre-Localization Output, Requirement: Assistant Registration, Requirement: Assistant Thread Title, Requirement: Context Channel Tracking, Requirement: Delivery Context for Assistant, Requirement: Localized Assistant Suggested Prompts and Bot-Authored Strings (+24 more)

### Community 127 - "Requirement: ensure_pr Tool"
Cohesion: 0.31
Nodes (8): isJsonObject(), isNonEmptyJsonObject(), JsonArray, JsonObjectShape, JsonPrimitive, JsonValue, migration, relocateTriviaConfig()

### Community 128 - "Requirement: Stop Reaction Trigger"
Cohesion: 0.25
Nodes (8): isJsonObject(), JsonArray, JsonObjectShape, JsonPrimitive, JsonValue, migrateCronConfig(), MigrateResult, migration

### Community 129 - "Requirement: Declarative Reconcile API On ClackSdk"
Cohesion: 0.27
Nodes (9): activitySchema, ActivitySdk, appendActivity(), clearActivity(), entrySchema, IdlerActivity, IdlerActivityEntry, loadActivity() (+1 more)

### Community 130 - "Requirement: Inline Stop Emoji Detection"
Cohesion: 0.60
Nodes (4): CLACK_CORE_TOOL_NAMES, parseFullName(), ToolNameValidationResult, validateRequiredToolNames()

### Community 131 - "homeTab.ts"
Cohesion: 0.18
Nodes (10): Check for context, Ending Discovery, Guardrails, Handling Different Entry Points, OpenSpec Awareness, The Stance, What You Don't Have To Do, What You Might Do (+2 more)

### Community 134 - "Requirements"
Cohesion: 0.33
Nodes (5): RememberInput, defaultDeps, linkArg, referenceArg, RememberDeps

### Community 135 - "Requirement: t() Translation Helper"
Cohesion: 0.06
Nodes (32): Add Trivia Cascading Attribute, Checklist, CLAUDE.md, Decision Tree: Flat-Object vs Weighted-Roll, Final Verification Checklist, Hard Rules, Layer 1: Type Definitions, Layer 2: Domain Resolver (+24 more)

### Community 136 - "cronJobs.ts"
Cohesion: 0.05
Nodes (53): CascadeContext, ALL_TIME_ROW_KEYS, CHOICE_EMOJI_STYLE_KEYS, DEFAULT_FREEFORM_ANSWER_SHAPE_WEIGHTS, DEFAULT_HINT_CONFIG, DEFAULT_PROMPT_MEDIUM_WEIGHTS, DEFAULT_QUESTION_TYPE_WEIGHTS, DEFAULT_TELL_ME_MORE (+45 more)

### Community 139 - "Requirement: Find previous questions tool"
Cohesion: 0.06
Nodes (32): Requirement: upsert_season tool, Scenario: Add a theme to an existing season, Scenario: answersFormat with all-zero weights rejected, Scenario: answersFormat with unknown keys rejected, Scenario: Cannot mutate startedAt of an already-started season, Scenario: Clear a season's contexts by passing null, Scenario: Clear a season's format by passing null, Scenario: Clear a season's theme by passing null (+24 more)

### Community 140 - "query.ts"
Cohesion: 0.60
Nodes (5): buildTrackedMemoryKinds(), listTrackedKinds(), namespaceOf(), trackedMemoryKindsForRole(), canAccessMemory()

### Community 141 - "testHelpers.ts"
Cohesion: 0.40
Nodes (4): CronJob, CronJobsFile, CronRun, migration

### Community 142 - "app.ts"
Cohesion: 0.06
Nodes (31): Purpose, Requirement: GitHub Identity Write-Through, Requirement: Invisible Lazy Display-Name Refresh, Requirement: Persisted User Registry, Requirement: SDK Users Accessor, Requirement: Serialized Single-Writer Persistence, Requirement: Write-Through Population From Core Resolution, Requirements (+23 more)

### Community 143 - "startupBaselineSmoke.ts"
Cohesion: 0.06
Nodes (30): find-recent-interactions Specification, Purpose, Requirement: Filter by minimum creation time, Requirement: Find Recent Interactions Tool, Requirement: Result projection via include sections, Requirements, Scenario: Both sections requested, Scenario: Empty include array is treated as the default (+22 more)

### Community 144 - "Checklist"
Cohesion: 0.50
Nodes (4): Clack loading animation, Clack icon 128x128, Clack mascot with hardhat, Clack main mascot

### Community 146 - "userRegistry.ts"
Cohesion: 0.07
Nodes (29): conversation-stats Specification, Purpose, Requirement: Bounded-memory streaming scan, Requirement: Conversation-stats query tool, Requirement: Core statistics, Requirement: Display labels, Requirement: No content or topic leakage in output, Requirement: Temporal, engagement, personality, content-lite, tool, and emoji statistics (+21 more)

### Community 148 - "Requirement: Invisible Lazy Display-Name Refresh"
Cohesion: 0.67
Nodes (3): parseToolResult(), ToolResult, toolResultText()

### Community 150 - "homeTab.ts"
Cohesion: 0.05
Nodes (35): Architecture, Changes Workflow, Cold-PR resume acquire mode, Data Directory Layout, Development, graphify, Idler plugin: off-hours autonomy, Instruction System (two-tier) (+27 more)

### Community 159 - "Requirements"
Cohesion: 0.11
Nodes (18): Additional conventions, Always interpolate identifying args, argOptions, Build clickable Slack mrkdwn links whenever possible, Config schema, Create Tool Mapping, Grouping, Manual spot-check (+10 more)

### Community 160 - "Requirements"
Cohesion: 0.18
Nodes (10): Deploy to GCE, Drain phase (before swap), Failure modes (from gce-update-image.sh), Gotchas, Step 1 — kick off the deploy in the background, Step 2 — arm a Monitor with the standard phase filter, Step 3 — acknowledge each phase event tersely, Step 4 — when the bash task completes, extract the downtime (+2 more)

### Community 173 - "wikimedia.ts"
Cohesion: 0.07
Nodes (29): Slack File Attachments Specification, Purpose, Requirement: File Cache, Requirement: File Extraction from Slack Messages, Requirement: File Metadata in Prompt, Requirement: File Metadata in Thread Context, Requirement: File Viewing Tool, Requirements (+21 more)

### Community 179 - "Requirements"
Cohesion: 0.17
Nodes (12): Admin Delete Message Specification, admin-delete-message Specification, Purpose, Requirement: Delete Clack Message by URL, Requirements, Scenario: Bot not in channel, Scenario: Invalid URL, Scenario: Message already deleted (+4 more)

### Community 180 - "Requirement: add_reaction Tool"
Cohesion: 0.07
Nodes (30): Admin Edit Instructions Specification, admin-edit-instructions Specification, Purpose, Requirement: Create New Instruction File, Requirement: Delete Instruction File Override, Requirement: Edit Instructions via Slack Modal, Requirement: Instruction File Listing, Requirement: Modal Title Length (+22 more)

### Community 181 - "Requirement: Topic-gated tool registration for management tools"
Cohesion: 0.11
Nodes (18): Admin Env Tools Specification, admin-env-tools Specification, Purpose, Requirement: admin_list_env Tool, Requirement: admin_set_env Tool, Requirement: Tool Role Gating, Requirements, Scenario: Admin can use env tools (+10 more)

### Community 182 - "Requirements"
Cohesion: 0.18
Nodes (11): Admin Role Tool Specification, admin-role-tool Specification, Purpose, Requirement: admin_set_role Tool, Requirements, Scenario: Demote user to member, Scenario: Idempotent --- user already at target role, Scenario: Promote user to admin (+3 more)

### Community 184 - "Requirement: Cascading judgeLeniency Axis"
Cohesion: 0.10
Nodes (21): App Lifecycle Specification, app-lifecycle Specification, Purpose, Requirement: Always-Register Bolt Handlers, Requirement: Cache Reset Functions, Requirement: Lifecycle Module, Requirements, Scenario: Auto-respond handler checks config at invocation (+13 more)

### Community 185 - "Requirements"
Cohesion: 0.05
Nodes (41): attention-level Specification, attention-level Specification, Purpose, Requirement: Always Level Short-Circuits Pre-Analysis, Requirement: Attention Level Dial, Requirement: Attention Level Exposure Across Tool and SDK Surfaces, Requirement: Attention Level Read-Time Migration, Requirement: Channel-Engagement Gate Caps Always to High (+33 more)

### Community 186 - "Requirement: Clicking "Tell me more" removes the button and kicks off a thread conversation"
Cohesion: 0.20
Nodes (10): auto-respond-pre-analysis Specification, auto-respond-pre-analysis Specification, Purpose, Requirement: Pre-Analysis Error Handling, Requirement: Pre-Analysis Logging, Requirements, Scenario: Log pre-analysis decision, Scenario: No logging when pre-analysis not configured (+2 more)

### Community 188 - "Requirements"
Cohesion: 0.18
Nodes (11): auto-respond Specification, auto-respond Specification, Purpose, Requirement: Auto-Respond Error Handling, Requirement: Auto-Respond Logging, Requirement: Auto-respond rules load is schema-driven, Requirements, Scenario: Corrupt state degrades to no rules (+3 more)

### Community 190 - "Requirement: Orchestrator provisions a standalone sibling change session per intent"
Cohesion: 0.06
Nodes (36): channel-context Specification, channel-context Specification, Purpose, Requirement: Channel Info Cache, Requirement: Channel Name in Delivery Context, Requirement: Channel Name in MCP Tool Results, Requirement: Channel Name in Session, Requirement: fetch_channel_messages Response Echoes Queried Window (+28 more)

### Community 196 - "Requirement: DM Thread Refinement"
Cohesion: 0.18
Nodes (11): Config Update Via Chat Specification, Config Update Via Chat Specification, Purpose, Requirement: Centralized Per-Repo Instruction File Set, Requirement: Smart File Placement Instructions, Requirements, Scenario: Content fits existing file, Scenario: Content is a new distinct topic (+3 more)

### Community 198 - "Requirements"
Cohesion: 0.12
Nodes (17): cron-messages Specification, cron-messages Specification, Purpose, Requirement: Concurrency Guard, Requirement: Plugin-Managed Cron Jobs Are Not Directly Editable Via User-Facing Tools, Requirement: SkipDates Serialization, Requirement: update_scheduled_message Accepts an Optional Name, Requirements (+9 more)

### Community 200 - "workerSkills.ts"
Cohesion: 0.05
Nodes (39): error-reporting Specification, ADDED Requirements, error-reporting Specification, Purpose, Requirement: Block Posting Retry on Invalid Blocks, Requirement: Conversation Trace Capture, Requirement: DM Error Reporting, Requirement: Error-report load is schema-driven (+31 more)

### Community 203 - "Requirement: Config Update Detection"
Cohesion: 0.17
Nodes (12): Gemini Image Plugin (Generate & Edit), Authentication, Behavior, Configuration, Enable the plugin, Gemini Image Plugin, Notes, References (+4 more)

### Community 205 - "Requirement: Claude Prompt Formatting"
Cohesion: 0.06
Nodes (36): lazy-mcp-loading Specification, lazy-mcp-loading Specification, Purpose, Requirement: Always-On Subset at Session Start, Requirement: `attach_integration` Tool, Requirement: Integrations Catalog in System Prompt, Requirement: MCP Server Registry, Requirement: Persistence of Attached Integrations Across Resume (+28 more)

### Community 207 - "viewSlackFile.ts"
Cohesion: 0.11
Nodes (18): manifest-generation Specification, manifest-generation Specification, Purpose, Requirement: Manifest File Management, Requirement: Manifest Generation Script, Requirement: Slack App Configuration, Requirements, Scenario: Assistant dmType adds assistant scopes, events, and feature (+10 more)

### Community 215 - "Requirements"
Cohesion: 0.09
Nodes (22): owner-error-escalation Specification, Owner Error Escalation, Purpose, Requirement: Audience Split on Escalation, Requirement: escalate_to_owner Field on submit_response, Requirement: Escalation Writes an Error Report, Requirement: Instruction Directs Escalation for Operator-Facing Failures, Requirement: No-Owner and DM-Failure Fallback (+14 more)

### Community 218 - "Metabase Integration"
Cohesion: 0.10
Nodes (21): repo-access-control Specification, Purpose, repo-access-control Specification, Requirement: Centralized Access Checks, Requirement: Config Validation for Access, Requirement: Repository Access Configuration, Requirement: Role Level Comparison, Requirements (+13 more)

### Community 219 - "ADDED Requirements"
Cohesion: 0.04
Nodes (46): repository-management Specification, Purpose, repository-management Specification, Requirement: Branch Naming Convention, Requirement: GitHub App Authentication, Requirement: On-Demand History Deepening, Requirement: Periodic Repository Sync, Requirement: Repository Change Support Configuration (+38 more)

### Community 225 - "Requirement: Plugin-Scoped File Watch API"
Cohesion: 0.12
Nodes (17): Session Transcript Tool Specification, Purpose, Requirement: Session Transcript Query Tool, Requirements, Scenario: Default and maximum pagination, Scenario: Invalid pagination parameters rejected, Scenario: Legacy-shape sessions synthesize correctly on read, Scenario: Offset beyond end returns empty (+9 more)

### Community 226 - "Requirement: GitHub-to-Slack Reviewer Resolution"
Cohesion: 0.11
Nodes (19): Slack Channel Resolver Specification, Purpose, Requirement: Channel-Like Identifier Classification, Requirement: Open DM Channel Primitive, Requirement: Tool-Facing Channel Resolution, Requirements, Scenario: Channel ID classification, Scenario: Channel ID passthrough (+11 more)

### Community 228 - "Requirements"
Cohesion: 0.07
Nodes (29): Purpose, request-cancellation Specification, Requirement: Abort and Restart on Edit, Requirement: Abort via Stop Reaction, Requirement: In-Flight Request Registry, Requirement: Message Edit Detection, Requirement: Query Mode Abort Support, Requirement: Query-Mode Abort via Inline Stop Emoji (+21 more)

### Community 229 - "Requirement: save_question replaces generate_question"
Cohesion: 0.07
Nodes (29): Purpose, Requirement: All reveal-card user-facing strings are localized, Requirement: "See your answer" opens a private read-only verdict modal, Requirement: Static results footer renders per `revealResponses` mode, Requirement: Static reveal edit of the original question message, Requirement: Vote/answer affordance is replaced by a single "See your answer" button, Requirements, Scenario: Answer line reflects the format (+21 more)

### Community 230 - "Requirement: `compute_answers` MCP tool"
Cohesion: 0.07
Nodes (30): Requirement: seasons.json file schema, Scenario: answersFormat with unknown keys is rejected, Scenario: answersFormat with unknown keys is rejected, Scenario: Back-to-back seasons are permitted within a game, Scenario: Back-to-back seasons are permitted within a game, Scenario: Cascading season-without-categories resolves to game pool, Scenario: Cascading season-without-categories resolves to global when game has none, Scenario: Duplicate context names are rejected (+22 more)

### Community 231 - "Requirements"
Cohesion: 0.07
Nodes (28): admin-config-tools Specification, Purpose, Requirement: admin_read_file Tool, Requirement: admin_restart_app Tool, Requirement: admin_write_file Tool, Requirement: config.json validation is schema-driven, Requirement: File Path Allowlist, Requirement: Tool Role Gating (+20 more)

### Community 236 - "Requirement: await_ci Tool"
Cohesion: 0.12
Nodes (17): thread-delivery-mode Specification, Purpose, Requirement: Casual-Talk Defaults To Invisible, Requirement: Per-Thread Delivery Mode, Requirement: Seeding Delivery Mode On Engagement, Requirement: Switching Delivery Mode Mid-Conversation, Requirements, Scenario: Casual chatter follow-ups are silent (+9 more)

### Community 238 - "t.ts"
Cohesion: 0.25
Nodes (8): trivia-categories Specification, Purpose, Requirement: Category pool seeding, Requirements, Scenario: First load with empty categories file, Scenario: First load with no categories file, Scenario: Subsequent load with existing categories, Trivia Categories

### Community 239 - "mcpInstaller.ts"
Cohesion: 0.18
Nodes (11): trivia-choice-questions Specification, Purpose, Requirement: Answers-format discriminator, Requirement: Freeform Question Record Discriminator, Requirements, Scenario: Cross-format field rejected on freeform, Scenario: Freeform record fields valid, Scenario: Legacy boolean record without answersFormat field (+3 more)

### Community 241 - "Requirement: Continue an Existing Pull Request"
Cohesion: 0.11
Nodes (18): trivia-post-game-buttons Specification, Purpose, Requirement: Each post-game button is independently installed and addressable, Requirement: One-shot removal preserves sibling buttons and the footer, Requirement: Post-game buttons are defined in a single registry, Requirement: Post-game buttons render as a contiguous section below the reveal footer, Requirements, Scenario: Adding a button is a single registry entry (+10 more)

### Community 242 - "Requirements"
Cohesion: 0.11
Nodes (19): trivia-prediction-questions Specification, Purpose, Requirement: Click verdicts on a keyless question are deferred, Requirement: `prediction` questionType value, Requirement: Save composes static fields; the answer is a separate settle step, Requirement: `settle_question` answers a prediction or invalidates any question, Requirements, Scenario: answer a boolean prediction (+11 more)

### Community 243 - "Requirement: List Config Files Tool"
Cohesion: 0.05
Nodes (37): trivia-question-hints Specification, Purpose, Requirement: Hint axis on TriviaConfig, TriviaGame, SeasonEntry, and SeasonFormatSlot, Requirement: Hint button handler opens a modal and tracks clicks, Requirement: Hint drafting with self-review in the question-generation prompt, Requirement: minDifficulty filter applied at get_ideas time, Requirement: resolveHintConfig cascade ordering, Requirement: save_question accepts and persists hint (+29 more)

### Community 244 - "Requirement: Cron Job Execution"
Cohesion: 0.10
Nodes (20): trivia-question-locking Specification, Purpose, Requirement: answerLocked flag on TriviaQuestion, Requirement: Click and modal submission are rejected when locked, Requirement: lock_questions tool freezes posted questions, Requirement: Lock-related user-facing strings are localized, Requirement: unlock_questions admin tool restores voting, Requirements (+12 more)

### Community 248 - "019-trivia-games-migration.ts"
Cohesion: 0.06
Nodes (36): trivia-visual-questions Specification, Purpose, Requirement: Claude inspects the image before writing the question, Requirement: external image-search MCP tool contract, Requirement: find_previous_subjects MCP tool for subject-level dedup, Requirement: image medium combines freely with all three answer formats, Requirement: image medium reuses the standard category pool, Requirement: media field on image-medium questions (+28 more)

### Community 249 - "userCache.ts"
Cohesion: 0.11
Nodes (18): user-preferences Specification, Purpose, Requirement: Reaction Delivery Preference, Requirement: User-preferences loading is schema-driven, Requirement: User Preferences Storage, Requirements, Scenario: Corrupt preferences degrade to empty, Scenario: Default preference (+10 more)

### Community 250 - "Requirement: Prompt Assembly"
Cohesion: 0.07
Nodes (28): ADDED Requirements, instruction-system Specification, Purpose, Requirement: Default Configuration Directory, Requirement: Instruction File Convention, Requirement: Language Directive Injection in User-Facing Prompt Composition, Requirement: Prompt Composition, Requirement: Two-Tier Resolution Chain (+20 more)

### Community 251 - "Requirement: Autonomous Change Execution"
Cohesion: 0.07
Nodes (28): Purpose, Requirement: API key via environment, Requirement: Baseline usage instructions, Requirement: find_gif tool, Requirement: GIF plugin registration, Requirement: Randomized results, Requirement: SFW enforcement, Requirement: Slack rendering via Block Kit image block (+20 more)

### Community 252 - "Requirement: On-Demand Cron Job Execution"
Cohesion: 0.07
Nodes (27): Purpose, Requirement: Classic DM Event Filtering, Requirement: Classic DM Inline Stop Emoji Parity, Requirement: Classic DM Listener Registration, Requirement: Classic DM Routing Through processMessage, Requirement: Classic Mode Skips Assistant-Only Affordances, Requirement: DM Type Configuration, Requirements (+19 more)

### Community 253 - "Requirement: Repository Changes Instructions"
Cohesion: 0.07
Nodes (27): Purpose, Requirement: Content-mutating tools surface a uniform repaint hint, Requirement: Projection is idempotent and reconciling, Requirement: `update_answers_block` appends stored `revealBlocks` when present, Requirement: `update_answers_block` MCP tool projects file state onto posted cards, Requirements, Scenario: A projection failure is reported in `errors`, Scenario: All-unknown ids return an error (+19 more)

### Community 254 - "Requirement: GET /status Snapshot"
Cohesion: 0.07
Nodes (27): Requirement: Scheduled Messages Section, Scenario: Admin sees all plugin-managed scheduled messages in the second subsection, Scenario: Admin sees all plugin-managed scheduled messages in the second subsection, Scenario: Admin sees all user-created scheduled messages in the first subsection, Scenario: Admin sees all user-created scheduled messages in the first subsection, Scenario: Delete control absent for plugin-managed messages, Scenario: Delete control absent for plugin-managed messages, Scenario: Delete scheduled message from Home Tab (+19 more)

### Community 255 - "Requirement: Session Trace Retrieval Tool"
Cohesion: 0.07
Nodes (26): pinned-mcp-installs Specification, Purpose, Requirement: Backwards Compatibility for Non-Pinned Entries, Requirement: Hoist-Disabled Install at Boot, Requirement: Pinned Install Schema for stdio MCP Entries, Requirement: Pinned-MCP stdio entry validation is schema-driven, Requirement: Spawn Config Resolution from Installed Binary, Requirements (+18 more)

### Community 256 - "Requirement: Stream Keepalive"
Cohesion: 0.07
Nodes (26): Purpose, Requirement: Deliver-or-Skip-or-Error, Requirement: deliver_to Entry Thread Engagement, Requirement: deliver_to Field Shape, Requirement: Per-Entry Delivery Semantics, Requirement: responseTs Recording for deliver_to Runs, Requirements, Scenario: Default omitted fields preserve fire-and-forget (+18 more)

### Community 257 - "instructions.ts"
Cohesion: 0.07
Nodes (26): Purpose, Requirement: contextPriority is a weighted-random ordered priority list, Requirement: contexts configuration axis, Requirement: Prompt instructs Claude to descend the priority list, Requirement: save_question stores and validates the used context, Requirements, Scenario: Context absent when contexts not configured, Scenario: Context not in active list rejected (+18 more)

### Community 258 - "boot.ts"
Cohesion: 0.07
Nodes (27): Requirement: post_questions Stamps a Shared batchId on Every Item Posted in One Call, Scenario: 3-choice question sizes buttons correctly, Scenario: 4-choice question gets numbered-emoji buttons sized to choices, Scenario: All fresh items in one call share the same batchId, Scenario: All items already posted — no new batchId is generated or stamped, Scenario: batchId is independent across calls, Scenario: Boolean question gets vote buttons, no reactions, Scenario: Channel is resolved from game config, not from args (+19 more)

### Community 259 - "cronFormatter.ts"
Cohesion: 0.07
Nodes (26): Purpose, Requirement: Built-in Rebase Skill, Requirement: load_skill Tool in Worker Mode, Requirement: Worker-Skill Discovery, Requirement: Worker-Skill Storage and Two-Tier Resolution, Requirement: WORKER SKILLS Catalog in the Execution Prompt, Requirements, Scenario: Built-in global skill resolves from default_configuration (+18 more)

### Community 260 - "remember.ts"
Cohesion: 0.08
Nodes (25): 1. Your Job, 2. The Workflow, 3. Reference, 4. Fix Tool Issues Upstream, Claude Code Overlay, Commit tracking, Desloppify, File an issue (fallback) (+17 more)

### Community 261 - "Slack API: Messages and Reactions"
Cohesion: 0.08
Nodes (25): claude-run-handle, Purpose, Requirement: ClaudeRunHandle Shape, Requirement: First-Result-Wins Lifecycle, Requirement: Pending-Input Gate, Requirement: Resume-Fallback Replay, Requirement: Self-Cleanup on Settlement, Requirement: Stop Semantics (+17 more)

### Community 262 - "Requirement: Changes Workflow Configuration"
Cohesion: 0.08
Nodes (24): clack-tool-response Specification, Purpose, Requirement: Message Preamble Renders Above Blocks, Requirement: Nested post_to Is Rejected, Requirement: post_top_level Flag on submit_response, Requirement: Reactions Applied To Block-Based Responses, Requirement: thread_replies Sanity Ceiling, Requirement: Tool Description Names Explicit-Request Use Cases (+16 more)

### Community 263 - "Requirement: Read Config File Tool"
Cohesion: 0.08
Nodes (25): Requirement: categories axis at per-game tier, Requirement: Game-authoritative write default, Requirement: Game config error-message parity is preserved, Requirement: list_games surfaces lockCron, Requirement: list_games tool, Requirement: Management instruction documents prepCron derivation, Requirement: Per-game and workspace `revealResponses` accept `"just-winners"`, Requirement: Per-game data directory layout (+17 more)

### Community 264 - "Requirement: Engaged-Thread Registration Primitive"
Cohesion: 0.08
Nodes (24): ADDED Requirements, Purpose, Requirement: Change-session state load is schema-driven, Requirement: Pool-First Restoration Order, Requirement: Worker Session Restoration on Startup, Requirements, Scenario: A valid persisted change session round-trips, Scenario: Conflicting claim resolution (+16 more)

### Community 265 - "Requirements"
Cohesion: 0.08
Nodes (23): git-log-tools Specification, Purpose, Requirement: deepen_history Query Tool, Requirement: git_log Query Tool, Requirements, Scenario: Authenticated remote refresh, Scenario: Basic git log execution, Scenario: Deepen by N commits (+15 more)

### Community 266 - "Requirement: load_skill Tool"
Cohesion: 0.08
Nodes (23): link-unfurl-control Specification, Purpose, Requirement: Default Behavior Is Backwards-Compatible, Requirement: DM and Notification Helpers Honor Suppress-Unfurls, Requirement: Plugin Posting Helpers Honor Suppress-Unfurls, Requirement: Shared Suppress-Unfurls Option Across All Outgoing Slack Messages, Requirement: Streamer Final-Post Fallback Honors Suppress-Unfurls, Requirement: Structured-Message Front Door Honors Suppress-Unfurls (+15 more)

### Community 267 - "Requirement: Unified Conversation Log"
Cohesion: 0.08
Nodes (23): Plugin Interactivity, Purpose, Requirement: Plugin Action Handler Registration, Requirement: Plugin Load Result Exposes Interactivity Handlers, Requirement: Plugin Namespacing on Action and View IDs, Requirement: Plugin Reload Clears Owned Handlers, Requirement: Plugin View Submission Handler Registration, Requirement: Single Wildcard Dispatch at App Setup (+15 more)

### Community 268 - "Requirement: Stream Lifecycle"
Cohesion: 0.08
Nodes (23): Purpose, reaction-tools Specification, Requirement: add_reaction Tool, Requirement: remove_reaction Tool, Requirements, Scenario: Add reaction by channel and timestamp, Scenario: Add reaction by Slack URL, Scenario: Channel not found (+15 more)

### Community 269 - "Requirements"
Cohesion: 0.08
Nodes (23): Purpose, Requirement: Management instruction covers correcting an already-posted batch, Requirement: Management instruction enumerates all seven tools and includes dispatch heuristic, Requirement: Topic-gated admin instruction, Requirement: Topic-gated tool registration for management tools, Requirement: `trivia:management` integration is plugin-declared, Requirements, Scenario: Cron-fired runtime sessions never see management tools (+15 more)

### Community 270 - "fs.ts"
Cohesion: 0.09
Nodes (22): admin-deference Specification, Purpose, Requirement: Admin-Claim Keyword Detection, Requirement: Configurable Additional Keywords, Requirement: Deference Bounded to Posture, Not Permissions, Requirement: Non-Admin Claim Rebuttal, Requirement: Verified-Admin Deference on Claim, Requirements (+14 more)

### Community 271 - "statusServer.ts"
Cohesion: 0.09
Nodes (22): Purpose, Requirement: AI-generated provenance is unambiguous, Requirement: Edit an existing image, Requirement: Generate an image from a text prompt, Requirement: Graceful degradation without an API key, Requirement: High-level model tiers, Requirement: Stored unshared delivery, Requirements (+14 more)

### Community 272 - "021-trivia-answers-format-rename.ts"
Cohesion: 0.09
Nodes (22): Purpose, Requirement: Cascading judgeLeniency Axis, Requirement: judgeLeniency MCP Read/Write Surface, Requirement: judgeLeniency Stamped on the Question Record, Requirement: Leniency Preset Composition in the Judge Prompt, Requirements, Scenario: Clear a tier override, Scenario: Default when no tier sets the axis (+14 more)

### Community 273 - "025-idler-ledger-to-memory.ts"
Cohesion: 0.09
Nodes (22): Purpose, Requirement: Inline-generation fallback at post time, Requirement: Optional prep cron on TriviaGame, Requirement: Post-time pool selection is season-scoped and FIFO per slot, Requirement: Prep cron is channelless, Requirement: Prep cron required-tools list is the always-run discovery pair, Requirement: Prep prompt is gen-only and self-validates completeness, Requirements (+14 more)

### Community 274 - "findGif.ts"
Cohesion: 0.09
Nodes (22): Purpose, Requirement: Clicking "Tell me more" removes the button and kicks off a thread conversation, Requirement: "Tell me more" button on the revealed card, Requirement: "Tell me more" user-facing strings are localized, Requirement: The "Tell me more" thread auto-follows, Requirements, Scenario: Already-removed button is a no-op, Scenario: Button absent when disabled (default) (+14 more)

### Community 275 - "Workflow"
Cohesion: 0.09
Nodes (21): clack-tools Specification, Purpose, Requirement: Admin Config Tool Registration, Requirement: Admin Env Tool Registration, Requirement: Admin Role Tool Registration, Requirement: find_recent_interactions Tool Registration, Requirement: find_session_transcript Tool Registration, Requirement: get_scheduled_message_runs Surfaces Skip Outcome (+13 more)

### Community 276 - "Brave (Image Search) Plugin"
Cohesion: 0.09
Nodes (21): delivery-context Specification, Purpose, Requirement: Context Recovery Guidance in DM and Mention Prompts, Requirement: Delivery-Context-Aware Instructions, Requirement: Delivery Context in Claude Prompt, Requirement: Scheduled-Channelless Delivery Context, Requirements, Scenario: Assistant panel trigger (+13 more)

### Community 277 - "Gemini Image Plugin"
Cohesion: 0.09
Nodes (21): Delivery Handler Specification, Purpose, Requirement: Delivery Handler Abstraction, Requirement: Handler Selection And Mid-Run Switching, Requirement: Landing Target Is Independent Of Progress Mode, Requirement: post_top_level Reuses windDown, Requirement: The deliver Result's notified Flag Drives The Ping Decision, Requirements (+13 more)

### Community 278 - "Tenor (GIF) Plugin"
Cohesion: 0.09
Nodes (21): github-app Specification, Purpose, Requirement: GitHub App Credential Configuration, Requirement: HTTPS Git URL Construction, Requirement: Installation Token Generation, Requirement: Octokit Client Management, Requirements, Scenario: Authenticated Octokit instance (+13 more)

### Community 279 - "Project Context"
Cohesion: 0.09
Nodes (22): Requirement: Add Rule Modal, Requirement: Disable and Restore Buttons, Requirement: Help Section, Requirement: Ownership Claim UI, Requirement: Settings Modal, Requirement: Settings Section, Requirement: Toggle and Delete Rule Actions, Requirements (+14 more)

### Community 280 - "Requirements"
Cohesion: 0.09
Nodes (21): pr-spinoff Specification, Purpose, Requirement: Orchestrator provisions a standalone sibling change session per intent, Requirement: Sibling owns its own Slack thread and follow-up lifecycle, Requirement: Spinoff moves the slice's code, not a re-implementation, Requirement: Worker stages a spinoff intent without acquiring a second worker, Requirements, Scenario: Captured patch fails to apply on the sibling branch (+13 more)

### Community 281 - "Requirement: Change Request Detection"
Cohesion: 0.09
Nodes (21): Built-in Plugins, casual-talk, Changes Workflow, Clack, Claude Authentication, Configuration, Development, Direct Messages & Mentions (+13 more)

### Community 282 - "Requirement: create_scheduled_message Tool"
Cohesion: 0.21
Nodes (17): isProtectedBranchName(), isValidBranchName(), PROTECTED_BRANCH_NAMES, getRepositoriesDir(), getGitInstance(), setAuthenticatedRemote(), forceResetBranch(), isMissingRemoteRef() (+9 more)

### Community 283 - "Requirement: fetch_slack_message Query Tool"
Cohesion: 0.13
Nodes (17): BUILTIN_FALLBACK_TOPICS, resolveFallbackTopics(), buildCronExpression(), computeTicks(), rateLabel(), rateToDieFromTicks(), resolveDie(), buildPrompt() (+9 more)

### Community 284 - "Requirement: Claude Code Subprocess Invocation"
Cohesion: 0.10
Nodes (21): Requirement: Centralized Block Validation With Friendly Errors, Scenario: action-button blocks contribute to the 50-block budget, Scenario: card body exceeds 200 chars, Scenario: card has none of hero_image / title / actions / body, Scenario: card hero_image is missing image_url or alt_text, Scenario: card icon is missing image_url or alt_text, Scenario: card subtitle exceeds 150 chars, Scenario: card title exceeds 150 chars (+13 more)

### Community 285 - "Requirement: Tool Call Progress"
Cohesion: 0.10
Nodes (20): dm-first-reactions Specification, Purpose, Requirement: DM Response Delivery, Requirement: DM Thread Refinement, Requirement: Post-Accept Continuation, Requirement: Synthesis and Send to Thread, Requirements, Scenario: Answer streamed in DM thread (+12 more)

### Community 286 - "Requirement: System prompt advertises currently-tracked memory kinds"
Cohesion: 0.10
Nodes (20): Purpose, Requirement: A flexible fire may post zero questions and skip the day, Requirement: Flexible format posts a variable prefix of its slots, Requirement: Flexible rides the format cascade (whole-format replace), Requirement: `get_ideas` surfaces the resolved `flexible` flag, Requirement: SeasonFormat accepts an optional `flexible` flag, Requirements, Scenario: Absent flexible defaults to fixed (+12 more)

### Community 287 - "Requirement: list_games surfaces plugin-managed cron job UUIDs"
Cohesion: 0.10
Nodes (20): Purpose, Requirement: `asOf` flows from tool context, not tool arguments, Requirement: `compute_answers` gates on undecided predictions, Requirement: `compute_answers` performs no Slack write, Requirement: `compute_answers` renders invalidated questions at 0 points, Requirement: Idempotency of repeated default-mode calls, Requirement: Invalidated cards repaint as invalidated, Requirement: Tool registration retains existing hot-path tools for ad-hoc use (+12 more)

### Community 288 - "Requirement: Permission Predicates"
Cohesion: 0.10
Nodes (20): Purpose, Requirement: Scroll-to-top is configurable through existing surfaces, Requirement: Scroll-to-top is mechanical and not persisted, Requirement: Scroll-to-top knob cascades game over workspace, Requirement: Trailing link targets the batch's earliest message, Requirement: Trailing scroll-to-top message on multi-question batches, Requirements, Scenario: Append links to the original top (+12 more)

### Community 289 - "Deploy to GCE"
Cohesion: 0.10
Nodes (20): Requirement: Config Update Detection, Scenario: Append operation reads current content for baseline files, Scenario: Append operation reads current content for repo files, Scenario: Append operation reads current content for topic files, Scenario: Non-admin user cannot access tool, Scenario: Operation field defaults to append when omitted, Scenario: Propose delete of a baseline override, Scenario: Propose delete of a repo-scoped override (+12 more)

### Community 290 - "SKILL.md"
Cohesion: 0.10
Nodes (19): Purpose, Requirement: Card carries facts plus authored narrative when axis is yes, Requirement: `includeRevealInQuestions` axis resolves game → workspace → default, Requirement: Reprocessing an already-posted batch re-authors the per-card narrative, Requirement: `revealBlocks` field on the question record, Requirement: `update_question` persists authored reveal blocks, Requirements, Scenario: Default applies when unset (+11 more)

### Community 291 - "Asana Integration"
Cohesion: 0.10
Nodes (19): Purpose, Requirement: Claude Prompt Formatting, Requirement: Thread Context User Names, Requirement: User Info Caching, Requirement: User Name Configuration, Requirements, Scenario: API error handling, Scenario: Bot messages (+11 more)

### Community 292 - "GIPHY Plugin"
Cohesion: 0.11
Nodes (19): REMOVED Requirements, Requirement: Detached Session Re-Acquire, Requirement: Legacy XML-based plan generation, Requirement: PR instructions in config, Requirement: PR Operations via GitHub API, Requirement: Queue Acknowledgment, Requirement: Worker Visibility, Scenario: Close PR via API (+11 more)

### Community 293 - "Authentication"
Cohesion: 0.11
Nodes (18): find-user-tool Specification, Purpose, Requirement: find_user Query Tool, Requirement: UsersCache Abstraction, Requirements, Scenario: Avatar URL resolved from profile, Scenario: Avatar URL usable as image-tool source, Scenario: Cache created with factory function (+10 more)

### Community 294 - "Requirements"
Cohesion: 0.11
Nodes (19): Requirement: Get ideas tool, Scenario: contextPriority omitted when contexts not configured, Scenario: Each call rolls fresh suggestions, Scenario: Exclusion window scales for small pools, Scenario: firstFireOfSeason is true when no questions are stamped to the current slug, Scenario: Format meta omitted in a timeline gap, Scenario: Format meta returned when season has format with slot inheriting from game, Scenario: Get ideas falls back to categories.json when seasons are disabled (+11 more)

### Community 295 - "Requirement: Thread Reply Pre-Analysis"
Cohesion: 0.11
Nodes (19): Requirement: image-medium questions carry a Claude-built image block, Requirement: Per-question card blocks rebuild from question data at post time, Requirement: post_questions Append-Flag Validation Runs Before Per-Item Loop, Requirement: post_questions Fails Atomically When Appending to a Revealed Batch, Requirement: post_questions Fails Atomically When No Previous Batch Exists, Requirement: post_questions Is Idempotent And Race-Free On questionId, Requirement: Question-cron prompt routing splits on prepCron, Requirements (+11 more)

### Community 296 - "Requirement: Cascading Resolution"
Cohesion: 0.11
Nodes (19): Requirement: Difficulty is expressed as doubt, not obscurity, Requirement: Empty correct bucket renders expanded answer detail, Requirement: Misconfigured reveal-before-question warning, Requirement: Question-posting prompt has a prediction generation path, Requirement: Reveal prompt authors per-card narrative when `includeRevealInQuestions` is yes, Requirement: Reveal prompt renders invalidated questions, Requirement: Six-Way Generation Matrix, Requirements (+11 more)

### Community 297 - "Requirement: Top-Level Table Parameter"
Cohesion: 0.11
Nodes (18): Slack Image Support Specification, Purpose, Requirement: Image Disk Cache, Requirement: Image File Extraction, Requirement: Image Metadata in Prompt, Requirements, Scenario: Cache hit returns stored image, Scenario: Cache miss downloads and stores (+10 more)

### Community 298 - "Requirements"
Cohesion: 0.14
Nodes (10): FREEFORM_SAVE_FIELDS, freeformAnswerHandler, SettleOutcomeInput, weightedPick(), buildFreeformModal(), BuildFreeformModalParams, escapeMarkdown(), FREEFORM_MODAL_INTERNALS (+2 more)

### Community 299 - "Requirement: Skills Section in Home Tab"
Cohesion: 0.13
Nodes (12): clearQuarantinedWorker(), ClearQuarantineResult, createPool(), findLocalBranchSource(), getPool(), getWorkerPoolSnapshot(), initializePoolForBoot(), provisionMinimumWorkers() (+4 more)

### Community 300 - "Requirement: SDK can post a message to a channel or thread"
Cohesion: 0.12
Nodes (17): Metabase Integration, 1. Set the API key, 2. Create the MCP server config, 3. Restart Clack, Authentication, Configuration, Limitations, MCP Server Options (+9 more)

### Community 301 - "Requirement: Shared Per-Channel Delivery Routine"
Cohesion: 0.12
Nodes (16): conditional-hidden-rules Specification, Purpose, Requirement: Conditional Hidden Rules Config, Requirement: Default SDK Tool-Result Read Rule, Requirement: Evaluation Order, Requirement: Invalid Rule Handling, Requirements, Scenario: Argument missing at runtime (+8 more)

### Community 302 - "Requirement: Reactive Stream Rollover"
Cohesion: 0.12
Nodes (16): find-emoji-tool Specification, Purpose, Requirement: EmojiCache Abstraction, Requirement: find_emoji Query Tool, Requirements, Scenario: Alias resolution, Scenario: Cache created with factory function, Scenario: Cache expires after TTL (+8 more)

### Community 303 - "Requirement: Tool Mapping Config File Format"
Cohesion: 0.12
Nodes (16): github-mcp-auto-config Specification, Purpose, Requirement: Auto-detect GitHub App Credentials for MCP, Requirement: Graceful Degradation When Binary Missing, Requirement: Permission-to-Toolset Mapping, Requirement: Token Freshness Per Query, Requirements, Scenario: Binary not found on PATH (+8 more)

### Community 304 - "Requirement: Per-Answer Reveal-Time Judging via Small Model"
Cohesion: 0.12
Nodes (16): memory-archive Specification, Purpose, Requirement: Age-horizon archive pruning, Requirement: Atomic distill-and-remove archive tool, Requirement: Exact-ID-only retrieval, Requirement: Lean archive store and record shape, Requirements, Scenario: Archive is invisible to keyword recall (+8 more)

### Community 305 - "Requirement: Question-posting prompt step flow"
Cohesion: 0.12
Nodes (16): plugin-file-watch Specification, Purpose, Requirement: Config File Is Watched For Hot Reload, Requirement: Plugin-Scoped File Watch API, Requirement: Plugin Watchers Are Torn Down On Plugin Reload, Requirements, Scenario: Absolute path rejected, Scenario: Editing config.json triggers full reload (+8 more)

### Community 306 - ".oxlintrc.json"
Cohesion: 0.12
Nodes (16): pr-reviewer-assignment Specification, Purpose, Requirement: GitHub-to-Slack Reviewer Resolution, Requirement: requirePRReviewers Config Flag, Requirement: Reviewer Failures Never Fail PR Creation, Requirements, Scenario: Candidate pool is repository collaborators, Scenario: Empty collaborator pool yields no reviewers (+8 more)

### Community 307 - "explore.md"
Cohesion: 0.12
Nodes (16): Purpose, Requirement: Capture per-run token and cost usage, Requirement: Fold worker-run usage into the originating session, Requirement: Persist usage on the durable session record, Requirement: Server-side usage aggregation over a filtered session set, Requirements, Scenario: Aggregate sums matched sessions, Scenario: Auto-executed worker usage accrues to the originating session (+8 more)

### Community 308 - "Workflow"
Cohesion: 0.12
Nodes (16): Purpose, Requirement: `finalRevealSummary` axis resolves game → workspace → default, Requirement: Leaderboard is always posted top-level; the axis governs only the narrative, Requirement: Season finale stays top-level in all summary modes, Requirement: "See responses in thread" pointer is localized, Requirements, Scenario: Default applies when unset, Scenario: Game value wins over workspace (+8 more)

### Community 309 - "MCP Server Setup"
Cohesion: 0.12
Nodes (17): Requirement: save_question replaces generate_question, Scenario: answersFormat field is required, Scenario: Boolean question with choices rejected, Scenario: Choice question outside configured bounds, Scenario: Choice question with correctIndex out of range, Scenario: Choice question with duplicate choices, Scenario: Choice question with isTrue rejected, Scenario: Disabled game refuses the write (+9 more)

### Community 310 - "Requirement: Auto-Respond Rule Matching"
Cohesion: 0.12
Nodes (17): Requirement: `compute_answers` MCP tool, Scenario: Boolean scoring reads from answers.json, Scenario: Bot user ID is excluded from every voter list, Scenario: Cheaters are excluded from every voter list, Scenario: Cheaters excluded from all variant shapes, Scenario: Choice scoring reads from answers.json, Scenario: Leaderboard present regardless of revealResponses mode, Scenario: Legacy questions without stamped revealResponses default to "yes" (+9 more)

### Community 311 - "Requirement: Topic Subfolders Within Role Directories"
Cohesion: 0.12
Nodes (16): Purpose, Requirement: configWatcher Observability for User Skills, Requirement: deleteUserSkill Storage Operation, Requirement: Home Tab editable-by-everyone Badge, Requirement: Tool Name Validator Registration, Requirements, Scenario: Badge shown for everyone-editable skill, Scenario: Delete of a non-existent skill throws (+8 more)

### Community 312 - "Requirement: Claude-Authored Block Kit Responses"
Cohesion: 0.12
Nodes (16): ADDED Requirements, Requirement: Active-Change Freshness Exposure, Requirement: Active-Change Waiting Marker, Requirement: Claude-Authored Change Workflow Narration Honors Language Directive, Requirement: Failed Change Status Is Recoverable, Scenario: Completed and cancelled remain terminal, Scenario: Failed session retains its active change for recovery, Scenario: Marker cleared when worker acquired (+8 more)

### Community 313 - "Requirement: Query Tools"
Cohesion: 0.12
Nodes (15): file-upload Specification, Purpose, Requirement: Content Validation, Requirement: Error Handling, Requirement: Upload Content to Slack, Requirements, Scenario: Bot not in channel, Scenario: Content size limit (+7 more)

### Community 314 - "Requirement: stop_tracking Query Tool"
Cohesion: 0.12
Nodes (15): Purpose, Requirement: update_user Field-Level Permission Gating, Requirement: update_user MCP Tool, Requirements, Scenario: Admin updates another user's display name, Scenario: Anyone can set any user's github username, Scenario: Explicit null clears a field, Scenario: Multi-field call is rejected atomically when one field is unauthorized (+7 more)

### Community 315 - "Requirements"
Cohesion: 0.12
Nodes (15): Purpose, Requirement: await_ci Tool, Requirement: Worker Verifies CI Before Signing Off, Requirements, Scenario: A check-run fails, Scenario: All check-runs succeed, Scenario: Available in all worker invocations, Scenario: Checks do not resolve before the cap (+7 more)

### Community 316 - "Requirement: Cron Job Skip Dates"
Cohesion: 0.13
Nodes (14): Purpose, Requirement: Admin MCP Management Server, Requirement: Casual Talk Internal Jitter Constant, Requirement: Plugin Stays Inside Its Folder, Requirement: Soft Restart on Config Mutation, Requirement: Tool Labels Include the Changed Value, Requirements, Scenario: Admin tools are bound to the management server, not the default (+6 more)

### Community 317 - "instruction-variables Specification"
Cohesion: 0.13
Nodes (14): changes-workflow Specification, Purpose, Requirement: Autonomous Button-less Execution from a Scheduled Context, Requirement: Continuation Addresses Review Comments and Resolves Threads, Requirement: Continue an Existing Pull Request, Requirements, Scenario: Auto-executed change from a cron fire, Scenario: Comments incorporated and threads resolved on continuation (+6 more)

### Community 318 - "Requirement: SDK can start a Claude Q&A turn in a thread"
Cohesion: 0.13
Nodes (14): clack-plugins Specification, Purpose, Requirement: Built-in Plugin Registry, Requirement: No Plugin-vs-Plugin Name Collision, Requirement: Plugin Contract, Requirement: Plugin Load Result Exposes MCP Server, Requirements, Scenario: Load result carries mcpServer (+6 more)

### Community 319 - "Requirement: Add categories tool"
Cohesion: 0.13
Nodes (15): Requirement: List Config Files Tool, Scenario: Both layers searched independently, Scenario: List baseline and topic files grouped by role, Scenario: Matching file entries are annotated with hits, Scenario: Multiple topics under a single role, Scenario: Non-admin user cannot access tool, Scenario: Omitting query preserves full listing behavior, Scenario: Query filters listing to files whose content matches (+7 more)

### Community 320 - "Requirement: answersFormat is per-season, with config fallback"
Cohesion: 0.13
Nodes (15): Requirement: Cron Job Execution, Scenario: Channelless dynamic run with post_to delivers, Scenario: Channelless dynamic run without post_to is a legitimate skip, Scenario: Dynamic job execution, Scenario: Dynamic job execution with asOf (replay), Scenario: Message attribution, Scenario: One-shot job cleanup, Scenario: One-shot job skipped (+7 more)

### Community 321 - "Requirements"
Cohesion: 0.13
Nodes (14): ADDED Requirements, home-tab Specification, Purpose, Requirement: Schedule Rows Omit Channel Portion When Channelless, Requirement: Viewer-Relative Schedule Timezone Labels, Scenario: Channelless plugin-managed job omits channel reference, Scenario: Channelless row does NOT show an Edit modal entry point, Scenario: Channelless row tolerates absent skipDates / skipConditions (+6 more)

### Community 322 - "Requirement: Live-card rebuild honors answerLocked"
Cohesion: 0.13
Nodes (14): Purpose, Requirement: clackSession Streaming-Input Mode, Requirement: Query Wrapper Functions, Requirement: Wrapper API Passthrough, Requirements, Scenario: clackQuery disables session persistence, Scenario: clackSession returns a ClaudeRunHandle, Scenario: clackSession supports resume (+6 more)

### Community 323 - "Requirement: save_question slot binding"
Cohesion: 0.13
Nodes (14): Purpose, Requirement: Completion Monitor Configuration, Requirement: Session Completion Monitor, Requirements, Scenario: Check PR status for active sessions, Scenario: Configure monitoring interval, Scenario: Detect externally closed PR, Scenario: Detect externally merged PR (+6 more)

### Community 324 - "Requirement: propose_skill_update Tool"
Cohesion: 0.13
Nodes (15): Requirement: Per-season question format, Scenario: Empty questions array rejected on write, Scenario: Empty slot is permitted, Scenario: Flexible flag accepted on write, Scenario: Flexible format posts a prefix when material is thin, Scenario: Flexible format posts zero and skips the day, Scenario: Game format used when season has none, Scenario: Invalid slot.answersFormat rejected (+7 more)

### Community 325 - "Requirement: Slack Action Handler for Skill Intents"
Cohesion: 0.22
Nodes (13): coalescedFetch(), EXPECTED_LOOKUP_ERRORS, fetchUserInfo(), formatUserIdentity(), getBotInfo(), inFlightFetches, isExpectedLookupError(), registryDisplayName() (+5 more)

### Community 326 - "Requirements"
Cohesion: 0.14
Nodes (14): Requirement: Prompt Assembly, Scenario: Built-ins disabled falls back to verbatim custom topics, Scenario: Built-ins disabled with no custom topics has no fallback openers, Scenario: Built-ins enabled with custom topics unions both, Scenario: Built-ins enabled with no custom topics uses the built-in list, Scenario: Prompt caps reaction volume by judgment, not a number, Scenario: Prompt does NOT reveal the triggering mechanism, Scenario: Prompt embeds candidate channels with promptSuggestion (+6 more)

### Community 327 - "github.ts"
Cohesion: 0.14
Nodes (14): Requirement: Autonomous Change Execution, Scenario: Additional allowed tools from config, Scenario: Auth refresh covers all worktree operations, Scenario: Change execution resumed on review follow-up, Scenario: Change execution resumed on update follow-up, Scenario: Change SDK session ID stored separately, Scenario: Change system prompt references MCP tools, Scenario: Execute change with clackSession (+6 more)

### Community 328 - "024-trivia-users-to-registry.ts"
Cohesion: 0.14
Nodes (14): Requirement: On-Demand Cron Job Execution, Scenario: asOf defaults to most recent run's executedAt, Scenario: Configuration gate, Scenario: Job has no prompt (static-only), Scenario: Job not found, Scenario: No Slack client available, Scenario: Permission — admin can run any job, Scenario: Permission — creator can run own job (+6 more)

### Community 329 - "Configuration"
Cohesion: 0.14
Nodes (13): Purpose, repo-instruction-files Specification, Requirement: Repository Changes Instructions, Requirement: Worktree Setup Instructions, Requirements, Scenario: Changes instructions file does not exist, Scenario: Changes instructions file exists, Scenario: Changes instructions used in follow-up commands (+5 more)

### Community 330 - "Requirement: Auto-Respond Rule Management"
Cohesion: 0.14
Nodes (13): Purpose, Requirement: GET /status Snapshot, Requirement: Runtime Status HTTP Server, Requirements, runtime-status-endpoint Specification, Scenario: Active query run is reported, Scenario: Executing Changes-Workflow run is reported, Scenario: Idle bot reports not busy (+5 more)

### Community 331 - "Requirement: Thread Follow-up Commands"
Cohesion: 0.14
Nodes (13): Purpose, Requirement: Session Trace Retrieval Tool, Requirement: Session Trace Tool Access Control, Requirements, Scenario: Admin access granted, Scenario: Default detail level, Scenario: Non-admin access denied, Scenario: Retrieve trace by session ID (+5 more)

### Community 332 - "Requirement: submit_response Tool"
Cohesion: 0.14
Nodes (14): Requirement: Stream Keepalive, Scenario: Fast tasks not decorated, Scenario: Grouped task title stays current, Scenario: Keepalive also fires when no task is active, Scenario: Keepalive decorates long-running tasks with elapsed time, Scenario: Keepalive dots append after existing details content, Scenario: Keepalive failure triggers stream failed state, Scenario: Keepalive handles parallel tasks independently (+6 more)

### Community 333 - "Requirement: find_pull_requests Query Tool"
Cohesion: 0.18
Nodes (10): CheatReport, TriviaUserData, createFakeSdk(), createInMemoryDataLayer(), fakeSdkMemory(), fakeSdkUsers(), FIXTURE_GAMES, GameCell (+2 more)

### Community 334 - "Requirement: Docker Setup Script"
Cohesion: 0.15
Nodes (12): API Methods, Best Practices, `conversations.history`, `conversations.replies`, Key Concepts, Message Timestamps (`ts`), `reaction_added` Event, References (+4 more)

### Community 335 - "Requirement: Activity logging and summary digest"
Cohesion: 0.15
Nodes (13): Requirement: Changes Workflow Configuration, Scenario: Additional allowed tools, Scenario: Disable workflow globally (default), Scenario: Execution timeout configuration, Scenario: Monitoring interval configuration, Scenario: Per-trigger opt-in for direct messages, Scenario: Per-trigger opt-in for mentions, Scenario: Per-trigger opt-in for reactions with custom trigger (+5 more)

### Community 336 - "Requirements"
Cohesion: 0.15
Nodes (13): Requirement: Read Config File Tool, Scenario: Read baseline file with both default and custom content, Scenario: Read baseline file with custom only, Scenario: Read baseline file with default only, Scenario: Read repo-scoped file, Scenario: Read topic-scoped file, Scenario: Read topic-scoped file with both default and custom content, Scenario: Reject filename containing slashes (+5 more)

### Community 337 - "Requirements"
Cohesion: 0.15
Nodes (12): engaged-thread-registration Specification, Purpose, Requirement: Engaged-Thread Registration Primitive, Requirement: followUpContext Reaches The Answer Turn, Requirements, Scenario: deliveryMode rides onto the seeded session, Scenario: Existing session is not clobbered, Scenario: followUpContext shapes the reply (+4 more)

### Community 338 - "Requirement: Silent cron-triggered change execution"
Cohesion: 0.15
Nodes (12): idler-plugin Specification, Purpose, Requirement: Continue processes human and Claude Code comments, Requirement: Graceful degradation when a source MCP is absent, Requirement: Never auto-merge, Requirement: Self-review feeds continue, Requirements, Scenario: Approving review without merge (+4 more)

### Community 339 - "Requirement: Tool Label Registry"
Cohesion: 0.15
Nodes (13): Requirement: load_skill Tool, Scenario: Disabled user skill rejected, Scenario: File read failure surfaces a clear error, Scenario: First-time load of a lazy-pack skill returns body, Scenario: First-time load of a user-skills skill returns body, Scenario: Non-lazy lazy-plugin pack rejected, Scenario: Repeat load of a lazy-pack skill is idempotent, Scenario: Repeat user-skills load with unchanged mtime returns cached body (+5 more)

### Community 340 - "Requirement: switch_delivery_context Tool"
Cohesion: 0.15
Nodes (13): Requirement: Unified Conversation Log, Scenario: Assistant turn appended after submit_response, Scenario: Choice button press appended as structured user message, Scenario: Empty messages on new session, Scenario: Errored turn appended as assistant message with error, Scenario: Followup button press appended as structured user message, Scenario: Messages array shape, Scenario: Pre-analysis verdict captured per autoRespond turn (+5 more)

### Community 341 - "Requirement: Remove categories tool"
Cohesion: 0.15
Nodes (13): Requirement: Stream Lifecycle, Scenario: Cancellation stops stream, Scenario: Fallback on mid-flight stream failure when rollover is skipped or its open fails, Scenario: Fallback on stream start failure, Scenario: Known stream expiry logged as warning with diagnostics, Scenario: Message timestamp available after start, Scenario: Message timestamp captured on first append, Scenario: Message timestamp null on failed start (+5 more)

### Community 342 - "Requirement: Data-move via migration 019"
Cohesion: 0.15
Nodes (12): Purpose, Requirement: `find_previous_questions` exposes `revealBlocks` only on opt-in targeted lookups, Requirement: find_previous_questions surfaces promptMedium and media, Requirement: posted: false rejects combination with recentBatchFromNow, Requirements, Scenario: Default list omits revealBlocks, Scenario: Image-medium staged question exposes promptMedium and media, Scenario: Opt-in still withholds blocks for a live question (+4 more)

### Community 343 - "Requirement: tellMeMore field on TriviaGame and workspace"
Cohesion: 0.24
Nodes (11): RunningChangeInfo, snapshotRunningChanges(), ActiveRunInfo, snapshot(), createStatusHandler(), defaultStatusDeps(), readPackageVersion(), startStatusServer() (+3 more)

### Community 344 - "Requirements"
Cohesion: 0.17
Nodes (11): 1. Resolve the date range, 2. Pull commits, 3. Classify commits, 4. Group related commits into cards, 5. Write each card, 6. Assemble the final post, 7. Sanity checks before output, Generate a Clack changelog (+3 more)

### Community 345 - "Requirement: Trivia Games Config Schema"
Cohesion: 0.17
Nodes (11): 1. Set the API key, 2. Enable the plugin, 3. Restart Clack, Authentication, Behavior, Brave (Image Search) Plugin, Configuration, Licensing posture (read before enabling) (+3 more)

### Community 346 - "Requirement: Default-mode processes the oldest unprocessed question"
Cohesion: 0.17
Nodes (11): Architecture Patterns, Code Style, Domain Context, External Dependencies, Git Workflow, Important Constraints, Project Context, Project Conventions (+3 more)

### Community 347 - "Requirement: `override_answer` admin tool sets a verdict by hand"
Cohesion: 0.17
Nodes (11): cascading-config-resolver Specification, Purpose, Requirement: Dynamic File Discovery, Requirement: File Concatenation Order, Requirement: Variable Interpolation, Requirements, Scenario: Alphabetical ordering, Scenario: Custom file with no default counterpart (+3 more)

### Community 348 - "Requirement: Per-fire round summary in payload"
Cohesion: 0.17
Nodes (12): Requirement: Change Request Detection, Scenario: Branch validation for a new branch, Scenario: Claude-driven detection via tool, Scenario: Claude identifies question (no tool call), Scenario: Convention skipped when continuing an existing branch, Scenario: Existing worktree detection, Scenario: Explicit change request via work-mode reaction, Scenario: Protected branch refused even on continuation (+4 more)

### Community 349 - "Requirement: Reprocess mode re-derives verdicts on retained answers (never deletes)"
Cohesion: 0.17
Nodes (12): Requirement: create_scheduled_message Tool, Scenario: Channel resolution failure, Scenario: Create a one-shot job, Scenario: Create a recurring dynamic job, Scenario: Create a static job, Scenario: Create with skipConditions, Scenario: Create with submitResponseMode, Scenario: Create without submitResponseMode (+4 more)

### Community 350 - "Requirement: Slug Validation"
Cohesion: 0.17
Nodes (12): Requirement: fetch_slack_message Query Tool, Scenario: Empty thread result, Scenario: Fetch exceeds maximum cap, Scenario: Fetch message from thread reply URL, Scenario: Fetch standalone message with no thread, Scenario: Fetch thread with custom page and limit, Scenario: Fetch thread with default pagination, Scenario: Invalid Slack message URL (+4 more)

### Community 351 - "Requirement: Worker Release Lifecycle"
Cohesion: 0.17
Nodes (12): Requirement: Claude Code Subprocess Invocation, Scenario: Attach latency visible in thinking indicator, Scenario: Model configurable, Scenario: onEvent callback for streaming, Scenario: onEvent callback is optional, Scenario: Query via clackSession wrapper, Scenario: Resume re-attach partially fails, Scenario: Resumed session re-attaches previously attached integrations (+4 more)

### Community 352 - "errorReports.ts"
Cohesion: 0.17
Nodes (11): Purpose, Requirement: All-Blocks Message Timestamp Accessor, Requirement: stopped_by_user Is a Deliberate Halt, Requirements, Scenario: getAllMessageTss returns all tss in order after rollovers, Scenario: getAllMessageTss returns one ts when no rollover happened, Scenario: getMessageTs returns the latest block's ts, Scenario: Skip/cancel/top-level callers iterate getAllMessageTss (+3 more)

### Community 353 - "022-trivia-config-to-plugin.ts"
Cohesion: 0.17
Nodes (12): Requirement: Tool Call Progress, Scenario: A single overflow marker fires at the cap+1 call, Scenario: Cap applies independently to separate groups in the same stream, Scenario: Cap of zero produces a header-only task card, Scenario: Grouped detail lines accumulate below the resolved cap, Scenario: Re-emission of grouped details respects the cap, Scenario: submit_response excluded from task cards, Scenario: Subsequent overflow calls add no further detail lines (+4 more)

### Community 354 - "023-cron-config-namespace.ts"
Cohesion: 0.17
Nodes (11): Purpose, Requirement: Recall before continuing prior work, Requirement: System prompt advertises currently-tracked memory kinds, Requirements, Scenario: A newly-introduced namespace appears with no code change, Scenario: Continue-work request consults memory first, Scenario: Distinct namespaces are surfaced, Scenario: Empty store injects nothing (+3 more)

### Community 355 - "Plugin Hard Rules"
Cohesion: 0.17
Nodes (12): Requirement: list_games surfaces plugin-managed cron job UUIDs, Scenario: Cron expressions and timezone are surfaced per game, Scenario: Default response excludes disabled games, Scenario: Disabled games still surface IDs when requested, Scenario: Empty config returns empty array, Scenario: Empty workspace defaults still present in response, Scenario: IDs omitted when reconcile has not yet run, Scenario: includeDisabled returns the full registry (+4 more)

### Community 356 - "adminDeleteMessage.ts"
Cohesion: 0.17
Nodes (12): Requirement: Permission Predicates, Scenario: Admin can delete, Scenario: Admin can edit any content, Scenario: Admin can manage anything, Scenario: Member can create, Scenario: Member cannot delete even their own skill, Scenario: Non-owner member can edit content of an everyone-editable skill, Scenario: Non-owner member cannot edit content of a default skill (+4 more)

### Community 357 - "Status by surface"
Cohesion: 0.18
Nodes (11): Asana Integration, 1. Set the access token, 2. MCP server config, 3. Restart Clack, Asana Integration, Authentication, Configuration, Notes (+3 more)

### Community 358 - "Requirement: Auto-Respond Trigger Type"
Cohesion: 0.18
Nodes (11): GIPHY Plugin, Authentication, Behavior, Configuration, Enable the plugin, GIPHY Plugin, Notes, References (+3 more)

### Community 359 - "Requirement: Thread Auto-Respond"
Cohesion: 0.18
Nodes (10): 1. Set the API token, 2. Create the MCP server config, 3. Restart Clack, Authentication, Configuration, Monday.com Integration, References, Step 1: Create a dedicated Monday.com user (+2 more)

### Community 360 - "Requirement: Role Chain Builder"
Cohesion: 0.18
Nodes (10): Action Button Message Preservation, Purpose, Requirement: Action-button clicks preserve the host message, Requirement: Clicked button is removed by action_id, Requirement: Inbound blocks parsed via schema with a missing-blocks guard, Requirements, Scenario: Exactly the clicked button is removed, Scenario: Multi-button message keeps siblings (+2 more)

### Community 361 - "Requirement: PR Operations via GitHub API"
Cohesion: 0.18
Nodes (11): Requirement: Thread Reply Pre-Analysis, Scenario: Always level skips pre-analysis, Scenario: Change workflow commands bypass thread pre-analysis, Scenario: Stop reserved for explicit sign-off or topic change, Scenario: Thread pre-analysis error handling, Scenario: Thread pre-analysis uses shared context, Scenario: Thread reply passes pre-analysis, Scenario: Thread reply rejected by pre-analysis (+3 more)

### Community 362 - "Requirement: Worker Visibility"
Cohesion: 0.18
Nodes (11): Requirement: Cascading Resolution, Scenario: Custom override wins over plugin virtual default, Scenario: Empty file suppresses instruction, Scenario: File exists only at higher role level, Scenario: File exists only at lowest role level, Scenario: File not included when role chain stops before it, Scenario: Full resolution order with plugin virtual defaults, Scenario: Higher role overrides lower role (+3 more)

### Community 363 - "Requirement: Plugin SDK Localization"
Cohesion: 0.18
Nodes (11): Requirement: Top-Level Table Parameter, Scenario: post_to action accepts a sibling table, Scenario: post_to without table delivers blocks only, Scenario: rich_text cell skips per-cell text cap, Scenario: string or raw_text cell exceeds 2,000 chars, Scenario: top-level table accepted with bare-string cells, Scenario: top-level table appended to blocks at delivery, Scenario: top-level table cell with rich_text elements passed through (+3 more)

### Community 364 - "Requirement: Atomic Batch Validation With Aggregated Errors"
Cohesion: 0.18
Nodes (11): Requirement: Change Workflow Setup Instructions, Requirement: Deploy Skill Surfaces the Drain Phase, Requirement: Status Port Published to Loopback, Requirement: Worktree Volume Mount, Requirements, Scenario: Container publishes status port to localhost, Scenario: Docker setup prompts for change workflow, Scenario: GitHub App write permissions for changes (+3 more)

### Community 365 - "Requirement: Configurable additional_messages Cap"
Cohesion: 0.18
Nodes (11): Requirement: Skills Section in Home Tab, Scenario: Admin sees a Delete button with confirmation in the modal, Scenario: Delete confirmed removes the skill and refreshes the view, Scenario: Disabled skill shows Restore instead of Disable in the modal, Scenario: Member sees create button, Scenario: Non-admin owner does not see a Delete button in the modal, Scenario: Non-owner non-admin does not see the Edit button on someone else's skill, Scenario: Owner sees Edit on their own skill row, Disable in the modal (+3 more)

### Community 366 - "Requirement: Image Block Source — Public URL or Slack File Reference"
Cohesion: 0.18
Nodes (10): plugin-send-message, Purpose, Requirement: SDK can post a message to a channel or thread, Requirements, Scenario: Blocks supported with text fallback, Scenario: Disconnected client fails soft, Scenario: Missing content rejected, Scenario: Slack API error fails soft (+2 more)

### Community 367 - "Requirement: Tool Context"
Cohesion: 0.18
Nodes (10): Purpose, Requirement: Shared Message-Payload Entity, Requirement: Shared Per-Channel Delivery Routine, Requirements, Scenario: Delivery routine returns the posted ts, Scenario: Delivery routine surfaces Slack failures, Scenario: One definition reused by all delivery surfaces, Scenario: Payload excludes routing fields (+2 more)

### Community 368 - "Requirement: view_slack_image Query Tool"
Cohesion: 0.18
Nodes (11): Requirement: Reactive Stream Rollover, Scenario: Continuation cue on reactive rollover, Scenario: Group folding does NOT cross a rollover boundary, Scenario: Recoverable failure triggers reactive rollover, Scenario: Rollover counter surfaced in diagnostics, Scenario: Rollover open itself fails, Scenario: Stream-local state is cleared and in-flight tasks re-emitted on reactive rollover, Scenario: Thinking task id chunks are filtered from rollover replay (+3 more)

### Community 369 - "Requirement: Config Update Confirmation Flow"
Cohesion: 0.18
Nodes (11): Requirement: Tool Mapping Config File Format, Scenario: Clack find_emoji tool label, Scenario: Config with default fallback, Scenario: Config with hidden tools, Scenario: Config with object-form tool entry, Scenario: Config with template labels, Scenario: File-level group shorthand, Scenario: File-level group with sibling maxDetails (+3 more)

### Community 370 - "Requirement: Tick-Based Scheduler"
Cohesion: 0.18
Nodes (11): Requirement: Per-Answer Reveal-Time Judging via Small Model, Scenario: Ambiguous cross-language match still rejected, Scenario: Cross-language free-form descriptor accepted, Scenario: Cross-language named entity accepted, Scenario: Date answer on the inclusive tolerance boundary accepted, Scenario: Minor typo accepted, Scenario: Multi-guess shotgun rejected, Scenario: No freeform questions in batch (+3 more)

### Community 371 - "Requirement: Group Resolution"
Cohesion: 0.18
Nodes (11): Requirement: Question-posting prompt step flow, Scenario: Duplicate-detection step mandates the primary subject and treats the answer as a recall aid, Scenario: Prompt content includes the game header and game-scoped tool calls except for duplicate detection, Scenario: Prompt describes FOUR-BLOCK + actions layout, Scenario: Prompt enforces strict-membership difficulty gate, Scenario: Prompt instructs Claude to honor suggestedAnswer, Scenario: Prompt removes the game-scoped carve-out for duplicate detection, Scenario: Prompt routes posting through post_questions (+3 more)

### Community 372 - "Requirement: Question-posting prompt branches on suggested answersFormat and questionType"
Cohesion: 0.20
Nodes (9): Check for context, Ending Discovery, Guardrails, OpenSpec Awareness, The Stance, What You Don't Have To Do, What You Might Do, When a change exists (+1 more)

### Community 373 - "Requirement: User-Facing TS-Rendered Strings Are Localized"
Cohesion: 0.20
Nodes (9): Bumping a version, Forcing a clean reinstall, HTTP/SSE shape, Install failures, Legacy npx shape, MCP Server Setup, Pinned shape (recommended), Validation (+1 more)

### Community 374 - "Requirement: allTimeRow field on TriviaGame and workspace"
Cohesion: 0.20
Nodes (10): Requirement: Auto-Respond Rule Matching, Scenario: Disabled rule does not match, Scenario: First matching rule wins, Scenario: Ignore message subtypes, Scenario: Ignore own messages, Scenario: Match by channel and user filter, Scenario: Match by channel only (no user filters), Scenario: No deduplication of similar messages (+2 more)

### Community 375 - "Requirement: Trivia Off-Days Config"
Cohesion: 0.20
Nodes (10): Requirement: Topic Subfolders Within Role Directories, Scenario: Active topic file included, Scenario: Additive topic file with no default counterpart, Scenario: Empty topic file suppresses, Scenario: Multiple active topics concatenated under their headers, Scenario: Multiple files within a single topic, Scenario: Plugin virtual topic defaults, Scenario: Topic files cascade across role chain (+2 more)

### Community 376 - "Requirement: Get question history tool"
Cohesion: 0.20
Nodes (10): Requirement: Claude-Authored Block Kit Responses, Scenario: submit_response accepts a card block, Scenario: submit_response accepts a carousel block, Scenario: submit_response accepts a valid blocks array, Scenario: submit_response rejects a card with an inline `actions` field in v1, Scenario: submit_response rejects a disallowed block type, Scenario: submit_response rejects a `table` block inside the blocks array, Scenario: submit_response rejects an `actions` block in the blocks array (+2 more)

### Community 377 - "Requirement: difficultyRatio axis at season and slot tiers"
Cohesion: 0.20
Nodes (10): Requirement: Query Tools, Scenario: deepen_history tool, Scenario: find_changes tool, Scenario: find_emoji tool, Scenario: find_pull_requests tool, Scenario: find_sessions tool, Scenario: find_user tool, Scenario: git_log tool (+2 more)

### Community 378 - "Requirement: list_seasons tool"
Cohesion: 0.20
Nodes (10): Requirement: stop_tracking Query Tool, Scenario: Admin can stop any thread, Scenario: Already disengaged thread, Scenario: Invalid URL format, Scenario: No session found, Scenario: Permission denied for non-admin, Scenario: Stop tracking by URL, Scenario: Tool not registered in worker mode (+2 more)

### Community 379 - "Requirement: liveAnswersVisible on season and slot"
Cohesion: 0.20
Nodes (9): claude-code-integration Specification, Purpose, Requirement: Filesystem Permission Enforcement, Requirement: Plugin Set Filtered by Lazy-Skill Registry, Requirements, Scenario: Eager plugin passed at session start, Scenario: Filter is deterministic regardless of resume, Scenario: Lazy plugin omitted from session start (+1 more)

### Community 380 - "Requirement: revealResponses on season and slot"
Cohesion: 0.20
Nodes (10): Requirement: Cron Job Skip Dates, Scenario: Exact-date match skips without Claude, Scenario: Invalid skipDates entries are tolerated at runtime, Scenario: Non-matching date fires normally, Scenario: One-shot job skipped on an off-day is still deleted, Scenario: Recurring MM-DD match skips, Scenario: Replay respects skipDates against the replay date, Scenario: skipDates evaluated in job timezone (+2 more)

### Community 381 - "Requirement: Season tag on new records"
Cohesion: 0.20
Nodes (9): instruction-variables Specification, Purpose, Requirement: Variable Definition Registry, Requirement: Variable Key Validation, Requirements, Scenario: All registry variables have values, Scenario: Missing variable detected, Scenario: Registry contains all defined variables (+1 more)

### Community 382 - "Requirement: propose_skill_disable Tool"
Cohesion: 0.20
Nodes (9): plugin-thread-conversation, Purpose, Requirement: SDK can start a Claude Q&A turn in a thread, Requirements, Scenario: Dependency not wired (tests / early boot), Scenario: Plugin starts a thread conversation, Scenario: Slack client not connected, Scenario: Started thread is auto-follow-enabled (+1 more)

### Community 383 - "Requirement: Pre-Analysis Evaluation"
Cohesion: 0.20
Nodes (9): Purpose, Requirement: Config Caching and Invalidation, Requirement: Dot-Notation Arg Access, Requirements, Scenario: Cache invalidated on MCP reset, Scenario: Configs cached after first load, Scenario: Missing intermediate key, Scenario: Nested arg access (+1 more)

### Community 384 - "Requirement: Changes Workflow availability by context visibility"
Cohesion: 0.20
Nodes (10): Requirement: Add categories tool, Scenario: Add duplicate category, Scenario: Add new categories (default target), Scenario: Add to a queued future season by slug, Scenario: Add to current season only, Scenario: Add to default baseline only, Scenario: Insufficient role, Scenario: Seasons disabled — target argument ignored (+2 more)

### Community 385 - "Requirement: ClackSdk Exposes `registerMcpServer` Returning a Handle"
Cohesion: 0.20
Nodes (10): Requirement: answersFormat is per-season, with config fallback, Scenario: All sources absent defaults to boolean-only, Scenario: Current season's questionTypes overrides config (no format), Scenario: Current season without questionTypes or format falls back to config, Scenario: Mid-season format update via upsert_season takes effect on next call, Scenario: Mid-season update via upsert_season takes effect on next call, Scenario: Seasons disabled uses config, Scenario: Slot's questionTypes overrides season's (+2 more)

### Community 386 - "Requirement: post_to Actions Carry Blocks"
Cohesion: 0.20
Nodes (10): Requirement: Free-Form Answer Update Data-Layer Op, Requirement: Freeform Question Posting Behavior, Requirement: Reveal Payload Includes Quoted Answer Text, Requirements, Scenario: Freeform card has Answer button, Scenario: Freeform card has no reactions, Scenario: No fence-sitters or wildcards on freeform, Scenario: Update flips correct (+2 more)

### Community 387 - "Requirement: Required Tools Gate on submit_response"
Cohesion: 0.20
Nodes (10): Requirement: Live-card rebuild honors answerLocked, Scenario: Absent revealResponses on a locked question reads as "yes", Scenario: Cheater rows are excluded from the locked roster, Scenario: Locked rebuild drops buttons and keeps the notice, Scenario: Locked window with revealResponses just-correctness shows participation only, Scenario: Locked window with revealResponses just-winners shows participation only, Scenario: Locked window with revealResponses "no" shows the notice alone, Scenario: Locked window with revealResponses "yes" shows the full grouped distribution (+2 more)

### Community 388 - "Requirement: Send to Thread Action Type"
Cohesion: 0.20
Nodes (10): Requirement: save_question slot binding, Scenario: Answers format not permitted by slot, Scenario: Category not in slot's resolved pool, Scenario: Context not in slot's lens list, Scenario: Missing slot argument when format present, Scenario: Question type not permitted by slot, Scenario: Save with valid slot succeeds and snapshots label, Scenario: Save with valid slot using game format (+2 more)

### Community 389 - "Requirement: Sequential Batch Delivery"
Cohesion: 0.20
Nodes (10): Requirement: propose_skill_update Tool, Scenario: Admin can stage update on someone else's skill, Scenario: Missing all fields rejected, Scenario: Non-manager rejected when setting editable_by_anyone, Scenario: Non-owner member can stage content update on everyone-editable skill, Scenario: Non-owner member rejected on a default skill, Scenario: Owner can set editable_by_anyone, Scenario: Owner can stage content update (+2 more)

### Community 390 - "Requirement: Action Tools"
Cohesion: 0.20
Nodes (10): Requirement: Slack Action Handler for Skill Intents, Scenario: Create intent applied, Scenario: Defense-in-depth content permission re-check, Scenario: Delete intent applied, Scenario: Delete intent defense-in-depth re-check, Scenario: Disable intent applied, Scenario: Restore intent applied, Scenario: Slug collision at apply time (+2 more)

### Community 391 - "Requirement: list_scheduled_messages Tool"
Cohesion: 0.20
Nodes (10): Requirement: Acquire Self-Heals on Missing Worker Folder, Requirement: Idle Release Defers to Active Idler Work, Requirement: Local Branch Lookup, Requirements, Scenario: Branch is on a worker, Scenario: Branch not on any worker, Scenario: Change request succeeds after self-heal, Scenario: git_log uses local worker when available (+2 more)

### Community 392 - "Requirement: Cron Job Data Model"
Cohesion: 0.22
Nodes (9): Linear Integration, 1. Set the API token, 2. Create the MCP server config, 3. Restart Clack, Authentication Options, Configuration, Linear Integration, Option A: Personal API Key (Recommended for simplicity) (+1 more)

### Community 393 - "Requirement: Error Handling"
Cohesion: 0.22
Nodes (9): Requirement: Auto-Respond Rule Management, Scenario: Clear pre-analysis context via explicit empty value, Scenario: Create a rule, Scenario: Create a rule with pre-analysis context, Scenario: Delete a rule, Scenario: Omitting pre-analysis context in a patch does not clear it, Scenario: Toggle a rule, Scenario: Update a rule preserves omitted fields (+1 more)

### Community 394 - "Requirement: submitResponseMode CRUD"
Cohesion: 0.22
Nodes (9): Requirement: Thread Follow-up Commands, Scenario: Action on unrelated PR in active change thread, Scenario: Close command execution, Scenario: Follow-up after change execution cleared, Scenario: Follow-up as question, Scenario: Follow-up on active change via context, Scenario: Merge command execution, Scenario: Review command execution (+1 more)

### Community 395 - "Requirement: GCE Deployment Script"
Cohesion: 0.22
Nodes (9): Requirement: submit_response Tool, Scenario: Basic response with sections, Scenario: Delivery returns message timestamp, Scenario: Reaction already added, Scenario: Reaction with invalid emoji, Scenario: Reactions without delivery, Scenario: Response with reactions, Scenario: Response with suppress_unfurls true (+1 more)

### Community 396 - "Requirement: Role Management Section"
Cohesion: 0.22
Nodes (9): Requirement: find_pull_requests Query Tool, Scenario: Fetch cap is surfaced, Scenario: Filter PRs by branch name, Scenario: Filter PRs by date, Scenario: Paginated, capped results, Scenario: Query PRs for a repository, Scenario: Repository not found, Scenario: Repository not visible to user (+1 more)

### Community 397 - "Requirements"
Cohesion: 0.22
Nodes (9): Requirement: Docker Setup Script, Scenario: API key configuration, Scenario: Credential validation, Scenario: Docker command output, Scenario: GitHub App credentials configuration, Scenario: GitHub App instructions displayed, Scenario: Missing config file, Scenario: Script creates auth directory structure (+1 more)

### Community 398 - "Requirement: Reporting controls"
Cohesion: 0.22
Nodes (9): Requirement: Activity logging and summary digest, Scenario: Actions are logged, Scenario: Digest does not unfurl its links, Scenario: Digest items link to their artifacts, Scenario: Summary digest covers the window, Scenario: Summary reports token and cost usage, Scenario: Usage line degrades gracefully, Scenario: Usage reflects fires that posted no visible output (+1 more)

### Community 399 - "Requirement: Three cooperating scheduled tasks"
Cohesion: 0.22
Nodes (8): lazy-skill-loading Specification, Purpose, Requirement: Fallback Instruction for Skill() Misuse, Requirement: Skill-plugin manifest read is schema-driven, Requirements, Scenario: A valid manifest is read unchanged, Scenario: Fallback rule present in default configuration, Scenario: Missing or malformed manifest falls back to defaults

### Community 400 - "Requirement: USER SKILLS Subsection in the Catalog"
Cohesion: 0.22
Nodes (9): Requirement: Channel Post Tracking, Requirement: Expired Session Recreation, Requirement: Session Cleanup, Requirements, Scenario: Channel post timestamp stored, Scenario: Channel post timestamp updated on re-post, Scenario: Choice or followup with expired session, Scenario: Cleanup interval configurable (+1 more)

### Community 401 - "Requirement: Encoded button action-value decode is schema-driven"
Cohesion: 0.22
Nodes (8): Purpose, Requirement: Silent cron-triggered change execution, Requirements, Scenario: Non-silent execution is unchanged, Scenario: report_status is a no-op under silent execution, Scenario: Silent change executes and posts nothing, Scenario: Silent run is not treated as channelless, silent-change-execution Specification

### Community 402 - "Requirement: Worker Flow Streaming"
Cohesion: 0.22
Nodes (9): Requirement: Tool Label Registry, Scenario: Dynamic label from tool arguments, Scenario: GitHub MCP tools, Scenario: Grouped tool details updated on re-emit, Scenario: Known tool mapped to label, Scenario: Null label excludes tool, Scenario: Tool details from config-driven links, Scenario: Unknown MCP tool gets server-level fallback (+1 more)

### Community 403 - "Requirement: Choice option-count bounds cascade through all tiers"
Cohesion: 0.22
Nodes (8): Purpose, Requirement: switch_delivery_context Tool, Requirements, Scenario: Switching invisible→streamer surfaces the card on this turn, Scenario: Switching streamer→invisible removes the card and goes silent, Scenario: Switching to the active mode is a no-op, Scenario: Tool is absent in non-interactive contexts, switch-delivery-context-tool Specification

### Community 404 - "Requirement: save_question accepts choice-question shape"
Cohesion: 0.22
Nodes (9): Requirement: Remove categories tool, Scenario: add_categories on a season with no categories field returns inheritance error, Scenario: Remove existing category (default target), Scenario: Remove from current season only (keep in baseline), Scenario: Remove non-existent category, Scenario: Removing the last current-season category drops the field, Scenario: Removing the last global category is rejected, Scenario: Removing the last slug-targeted category drops the field (+1 more)

### Community 405 - "Requirement: Exact-Match Pre-Check Bypasses the Reveal Judge"
Cohesion: 0.22
Nodes (9): Requirement: Data-move via migration 019, Scenario: Data-move step is idempotent, Scenario: Dispatcher schedule + no flat data → step 1 runs, step 2 is a no-op, Scenario: Flat data + dispatcher schedule → data lands in legacy-<channel>, Scenario: Flat data + no schedule + no config game → fallback initialgame, Scenario: Flat data + pre-existing config game → data lands in first entry, Scenario: Fresh deployment writes nothing, Scenario: Migration runs before the plugin loads (+1 more)

### Community 406 - "Requirement: finalRevealSummary field on TriviaGame and workspace"
Cohesion: 0.22
Nodes (9): Requirement: tellMeMore field on TriviaGame and workspace, Scenario: Absent field cascades to workspace then default, Scenario: Explicit null clears the field, Scenario: Game-level value beats workspace, Scenario: Invalid value is rejected, Scenario: list_games omits the field when absent, Scenario: list_games surfaces the field when set, Scenario: set_workspace_config persists tellMeMore (+1 more)

### Community 407 - "Requirement: format axis at per-game tier"
Cohesion: 0.22
Nodes (8): Purpose, Requirement: Reveal-Before-Question Warning, Requirement: warnIfPrepAfterQuestion logs misconfiguration, Requirements, Scenario: Correct ordering does not warn, Scenario: Inverted timing logs a warning, Scenario: Misconfigured prep fires after question, trivia-managed-schedules Specification

### Community 408 - "Requirement: includeRevealInQuestions field on TriviaGame and workspace"
Cohesion: 0.22
Nodes (9): Requirement: Trivia Games Config Schema, Scenario: Absent games array is valid, Scenario: Empty games array is valid, Scenario: Game with valid lockCron parses, Scenario: Game with valid prepCron parses, Scenario: Game without lockCron parses with no warning, Scenario: Game without prepCron parses with no warning, Scenario: Malformed lockCron is dropped with a warning (+1 more)

### Community 409 - "Requirement: Name format validation"
Cohesion: 0.22
Nodes (9): Requirement: Default-mode processes the oldest unprocessed question, Scenario: Legacy pending row with undefined batchId is a singleton, Scenario: No pending questions returns empty reveals, Scenario: Oldest batch wins when two batches are pending, Scenario: One pending batch with three questions is revealed in full, Scenario: Selected batch is processed without regard to season tag, Scenario: Successive fires drain backlog one batch at a time, Scenario: Tied minPostedAt — lexicographically-smaller batchId wins (+1 more)

### Community 410 - "Requirement: revealResponses field on TriviaGame"
Cohesion: 0.22
Nodes (9): Requirement: `override_answer` admin tool sets a verdict by hand, Scenario: Override mode requires correct and reason, Scenario: Override of a missing answer row, Scenario: Override refused before reveal, Scenario: Overriding a revealed freeform verdict captures the original, Scenario: Restore returns an overridden row to its machine verdict, Scenario: Restore with nothing to restore is rejected, Scenario: Second override preserves the original machine verdict (+1 more)

### Community 411 - "Requirement: upsert_game CREATE requires an initial season when seasons are enabled"
Cohesion: 0.22
Nodes (9): Requirement: Per-fire round summary in payload, Scenario: Cheaters do not appear in roundSummary, Scenario: Empty reveal still carries a roundSummary, Scenario: Length-3 reveal aggregates per player, Scenario: No correct answers → no MVPs, Scenario: Player who answered zero questions is omitted, Scenario: Round MVPs share the title on a tie, Scenario: roundSummary present in every mode, computed from scored answers (+1 more)

### Community 412 - "Requirement: per-question generation dispatches on a 3-axis matrix"
Cohesion: 0.22
Nodes (9): Requirement: Reprocess mode re-derives verdicts on retained answers (never deletes), Scenario: Both reprocess targets provided are unioned, Scenario: Reprocess by batchId falls back to a legacy id, Scenario: Reprocess by batchId matching nothing processes no questions, Scenario: Reprocess by batchId targets the whole batch, Scenario: Reprocess never deletes answer rows, Scenario: Reprocess re-derives every row's verdict in both directions, Scenario: Reprocess re-judges freeform with the re-stamped leniency (+1 more)

### Community 413 - "Requirement: find_previous_subjects exact-match dedup tool"
Cohesion: 0.22
Nodes (9): Requirement: Slug Validation, Scenario: Double hyphen rejected, Scenario: Empty description rejected, Scenario: Leading hyphen rejected, Scenario: Over-length description rejected, Scenario: Over-length slug rejected, Scenario: Trailing hyphen rejected, Scenario: Uppercase rejected (+1 more)

### Community 414 - "Requirement: save_question validates promptMedium and media"
Cohesion: 0.22
Nodes (9): Requirement: Worker Release Lifecycle, Scenario: Failed-session release with unpushed commits quarantines, Scenario: Idle release after timeout (clean worker), Scenario: Idle release covers failed sessions (clean, fully pushed), Scenario: Idle release on dirty worker quarantines, Scenario: Release on cancellation, Scenario: Release on PR closed, Scenario: Release on PR merged (+1 more)

### Community 415 - "Requirement: Answer-reveal prompt step flow"
Cohesion: 0.22
Nodes (8): 1. Never import code from outside the plugin folder, 2. Use the SDK as the entry point, 3. Define your own types, 4. Prefer hot-reload over soft-restart, Enforcement, Plugin Hard Rules, Topics vs MCP Servers — two related-but-distinct concepts, Why these rules exist

### Community 416 - "Requirement: Puzzle-quality gate"
Cohesion: 0.22
Nodes (8): ⬜ Active changes, 🔵 Change 6 `slack-payload-schemas-onto-zod` (OPTIONAL; outside the config/MCP goal), ⛔ Deliberately excluded (do NOT zod-ify), ✅ Done (archived), MCP tools — 0 gaps, 🆕 New — Change 5 `remaining-state-loaders-onto-zod` (graceful cluster), Status by surface, Zod validation sweep — inventory

### Community 417 - "Requirement: check_season_status tool"
Cohesion: 0.25
Nodes (8): Requirement: Auto-Respond Trigger Type, Scenario: Auto-respond sessions are not cancellable, Scenario: Changes Workflow disabled for autoRespond, Scenario: Delivery context for auto-respond, Scenario: Extra context injected into response, Scenario: Response posted as thread reply, Scenario: Skipped auto-respond leaves no trace, Scenario: TriggerType union includes autoRespond

### Community 418 - "Requirement: delete_season tool"
Cohesion: 0.25
Nodes (8): Requirement: Thread Auto-Respond, Scenario: Active run receives the reply via sendUpdate, Scenario: Bot messages in threads are ignored, Scenario: sendUpdate rejection falls through to fresh spawn, Scenario: Thread auto-respond disabled, Scenario: Thread reply in a disengaged session, Scenario: Thread reply in an engaged session, Scenario: Thread reply with no session

### Community 419 - "Requirement: Season-finale reveal layout"
Cohesion: 0.25
Nodes (8): Requirement: Role Chain Builder, Scenario: Admin user with changesWorkflow enabled, Scenario: Admin user without changesWorkflow, Scenario: Dev user with changesWorkflow enabled, Scenario: Dev user without changesWorkflow, Scenario: Member user, Scenario: Owner user with changesWorkflow enabled, Scenario: Owner user without changesWorkflow

### Community 420 - "Requirement: Worker Acquire Decision Tree"
Cohesion: 0.25
Nodes (8): Requirement: Worker Visibility, Scenario: Active workers display, Scenario: Cancellation metadata persisted, Scenario: Execution logging, Scenario: Session folder cleanup on success, Scenario: Session folder preserved on failure or cancellation, Scenario: Session state persistence, Scenario: State updates during execution

### Community 421 - "loadSkill.ts"
Cohesion: 0.25
Nodes (8): Requirement: Plugin SDK Localization, Scenario: Default to EN when language is unset, Scenario: Fallback to EN when language key missing, Scenario: Missing key throws, Scenario: Per-plugin dictionary isolation, Scenario: Plugin reads its own dictionary, Scenario: t() before registerDictionary, Scenario: Variable interpolation

### Community 422 - "zodErrorToResult"
Cohesion: 0.25
Nodes (8): Requirement: Atomic Batch Validation With Aggregated Errors, Scenario: All-valid batch passes validation, Scenario: Length limit applies per message, Scenario: Multiple errors across batch returned together, Scenario: post_to duplicate-channel guard sees the full batch, Scenario: Ref-coverage walks the full batch, Scenario: Single error in a follower refuses whole batch, Scenario: Single error in primary refuses whole batch

### Community 423 - "brave-image-search"
Cohesion: 0.25
Nodes (8): Requirement: Configurable additional_messages Cap, Scenario: additional_messages exceeding configured cap is rejected, Scenario: Config absent defaults to 5, Scenario: Config value above range is rejected at boot, Scenario: Config value below range is rejected at boot, Scenario: Config value within range is accepted, Scenario: Non-integer config value is rejected, Scenario: post_to.additional_messages uses the same configured cap

### Community 424 - "commons-image-search"
Cohesion: 0.25
Nodes (8): Requirement: Image Block Source — Public URL or Slack File Reference, Scenario: image block with a public image_url accepted, Scenario: image block with both image_url and slack_file rejected, Scenario: image block with neither image_url nor slack_file rejected, Scenario: image block with slack_file id accepted, Scenario: image block with slack_file url accepted, Scenario: slack_file with both id and url rejected, Scenario: slack_file with neither id nor url rejected

### Community 425 - "Trivia Plugin"
Cohesion: 0.25
Nodes (8): Requirement: Tool Context, Scenario: Active change as prompt context, Scenario: Context includes available images, Scenario: Context includes filtered repositories, Scenario: Context includes optional Slack client, Scenario: Context includes user identity and role, Scenario: No active change, Scenario: Worker context includes worktree and session info

### Community 426 - "Requirement: Direct-Address Override"
Cohesion: 0.25
Nodes (8): Requirement: view_slack_image Query Tool, Scenario: Download failure, Scenario: Tool not available in worker mode, Scenario: Tool not registered when no images, Scenario: Tool registered when images available, Scenario: Unknown file ID, Scenario: View cached image, Scenario: View image by file ID

### Community 427 - "Requirement: Pre-Analysis Persistence on Session"
Cohesion: 0.25
Nodes (8): Requirement: Config Update Confirmation Flow, Scenario: Apply config update — delete, Scenario: Apply config update — write, Scenario: Apply delete when override has been removed between staging and click, Scenario: Dismiss config update, Scenario: Show Delete File button when deleting a custom-only file, Scenario: Show preview with Apply Update button for write operations, Scenario: Show Remove Override button when deleting an override with a default

### Community 428 - "Requirement: Auto-Respond Message Handler"
Cohesion: 0.25
Nodes (8): Requirement: Tick-Based Scheduler, Scenario: Cron expression matching uses cron-parser, Scenario: Scheduler does not start when crons disabled, Scenario: Scheduler starts on boot when crons enabled, Scenario: Scheduler stops on shutdown, Scenario: Tick evaluates all enabled jobs, Scenario: Tick runs all jobs when user schedules enabled, Scenario: Tick skips user-created jobs when user schedules disabled

### Community 429 - "Requirement: Auto-Respond Rule UI — Pre-Analysis Context"
Cohesion: 0.25
Nodes (8): Requirement: Group Resolution, Scenario: File-level group applies to all tools, Scenario: maxDetails falls back to built-in default of 5 when no config sets it, Scenario: maxDetails falls back to global config when no per-group override, Scenario: maxDetails resolution prefers per-group override, Scenario: No group configured, Scenario: Per-tool group with itemDetail, Scenario: Per-tool group without itemDetail defaults to label

### Community 430 - "Requirement: Follow-Up Session for Top-Level Posts"
Cohesion: 0.25
Nodes (8): Requirement: Question-posting prompt branches on suggested answersFormat and questionType, Scenario: Distractor plausibility gate enforces all four conditions, Scenario: Fact boolean path unchanged, Scenario: Fact choice path writes correct answer first, Scenario: Reactions array sized to choice count, Scenario: Stacked vs inline layout guidance, Scenario: Topical boolean path adds WebSearch step, Scenario: Topical choice path adds WebSearch step

### Community 431 - "Requirement: Cancelled Change Status"
Cohesion: 0.25
Nodes (8): Requirement: User-Facing TS-Rendered Strings Are Localized, Scenario: English workspace renders EN roster footer, Scenario: French workspace renders FR boolean buttons, Scenario: French workspace renders FR freeform `Answer` button, Scenario: French workspace renders FR freeform modal, Scenario: French workspace renders FR roster footer, Scenario: Locked freeform modal renders FR verdict lines, Scenario: User-authored content is not translated

### Community 432 - "Requirement: ClackSdk Interface"
Cohesion: 0.25
Nodes (8): Requirement: allTimeRow field on TriviaGame and workspace, Scenario: Absent field cascades to workspace then default, Scenario: Game-level value beats workspace, Scenario: Invalid value is rejected, Scenario: list_games omits the field when absent, Scenario: list_games surfaces the field when set, Scenario: set_workspace_config persists allTimeRow, Scenario: upsert_game persists allTimeRow

### Community 433 - "Requirement: Action Button Label Maximum Length"
Cohesion: 0.25
Nodes (8): Requirement: Trivia Off-Days Config, Scenario: Absent offDays is valid, Scenario: Empty offDays is valid, Scenario: Invalid calendar date warns and drops, Scenario: Missing label warns and drops, Scenario: Mixed exact + recurring dates parse through, Scenario: Unparseable date format warns and drops, Scenario: Valid entries are kept when other entries are invalid

### Community 434 - "Requirement: post_to Carries Optional Actions"
Cohesion: 0.25
Nodes (8): Requirement: Get question history tool, Scenario: Mixed-state freeform responses, Scenario: Pending freeform responses omit `correct`, Scenario: Question with context surfaces the context value, Scenario: Returns boolean answer key, cheaters, and responses scoped to the game, Scenario: Returns choice answer key, cheaters, and responses, Scenario: Returns freeform answer key, cheaters, and responses, Scenario: Topical question history includes sourceUrl

### Community 435 - "Requirement: Snapshot Persistence Per post_to Captures Followers"
Cohesion: 0.25
Nodes (8): Requirement: difficultyRatio axis at season and slot tiers, Scenario: All-zeros inner weight map rejected, Scenario: Clear a season's difficultyRatio by passing null, Scenario: Create a season with difficultyRatio, Scenario: list_seasons omits difficultyRatio when unset, Scenario: Slot-tier difficultyRatio inside format, Scenario: Unknown bucket key rejected, Scenario: Update a season's difficultyRatio mid-season

### Community 436 - "Requirement: cancel_scheduled_message Tool"
Cohesion: 0.25
Nodes (8): Requirement: list_seasons tool, Scenario: Lazy-seed happens when seasons.json missing, Scenario: Returns every timeline entry for the named game with status flags, Scenario: Season-tier axis values are surfaced when set, Scenario: Slot-tier axis values inside format.questions are surfaced when set, Scenario: theme is surfaced when set, absent when not, Scenario: Tool is gated to admin, Scenario: Unknown game rejected

### Community 437 - "Requirement: Role-Based Tool Gating"
Cohesion: 0.25
Nodes (8): Requirement: liveAnswersVisible on season and slot, Scenario: Mid-season edit does not affect already-posted questions, Scenario: Non-boolean value rejected on upsert, Scenario: Season-level value resolves through cascade, Scenario: Slot-level field accepted on upsert_season, Scenario: Slot-level value beats season, Scenario: upsert_season clears the field with null, Scenario: upsert_season creates a season with the field

### Community 438 - "Requirement: update_scheduled_message Supports skipConditions"
Cohesion: 0.25
Nodes (8): Requirement: revealResponses on season and slot, Scenario: Invalid revealResponses string rejected on upsert, Scenario: Non-string revealResponses rejected on upsert, Scenario: Season-level value resolves through cascade, Scenario: Slot-level revealResponses accepted on upsert_season, Scenario: Slot-level value beats season, Scenario: upsert_season clears revealResponses with null, Scenario: upsert_season creates a season with revealResponses

### Community 439 - "Requirement: Utility Queries Use clackQuery"
Cohesion: 0.25
Nodes (8): Requirement: Season tag on new records, Scenario: Disabled config skips tagging, Scenario: save_cheating stamps season, Scenario: save_question does not stamp slot when no format, Scenario: save_question stamps season from the named game's timeline, Scenario: save_question stamps slot when active season has a format, Scenario: submit_answers stamps season on each answer, Scenario: Writes during a gap have no season tag

### Community 440 - "Requirement: Config Update Auto-Execute"
Cohesion: 0.25
Nodes (8): Requirement: propose_skill_disable Tool, Scenario: Admin can stage delete via the flag, Scenario: Delete of an already-disabled skill allowed, Scenario: Delete of unknown skill rejected, Scenario: Disable on already-disabled skill rejected, Scenario: Non-admin owner rejected on delete, Scenario: Non-owner non-admin rejected even when editableByAnyone, Scenario: Owner can stage disable

### Community 441 - "Requirement: Repository-Scoped Config File Addressing"
Cohesion: 0.29
Nodes (7): Requirement: Pre-Analysis Evaluation, Scenario: Pre-analysis context includes channel name, Scenario: Pre-analysis enabled and message passes, Scenario: Pre-analysis enabled and message rejected, Scenario: Pre-analysis not configured, Scenario: Pre-analysis response parsing, Scenario: Pre-analysis returns stop

### Community 442 - "Requirement: Channel Input Resolution for Scheduled Message Creation"
Cohesion: 0.29
Nodes (7): Requirement: Changes Workflow availability by context visibility, Scenario: Auto-respond and channel-bound scheduled are visible, Scenario: Channelless cron dispatch is an invisible context, Scenario: Dev replies in a visible thread, Scenario: Member acting in a visible context, Scenario: Non-dev starts the thread, a dev replies "do it", Scenario: Workflow disabled globally

### Community 443 - "Requirement: Jittered Match-Window Offset"
Cohesion: 0.29
Nodes (7): Requirement: ClackSdk Exposes `registerMcpServer` Returning a Handle, Scenario: autoload defaults to false, Scenario: Handle's addTopicInstruction auto-keys the topic to the server name, Scenario: Handle's registerTool binds the tool to that server, Scenario: Plugin declares an on-demand server and receives a handle, Scenario: registerMcpServer rejects collision with the plugin's default server, Scenario: registerMcpServer rejects names containing colons

### Community 444 - "Requirement: Schedule Name Field"
Cohesion: 0.29
Nodes (7): Requirement: post_to Actions Carry Blocks, Scenario: post_to action with blocks is accepted, Scenario: post_to action with invalid blocks is rejected, Scenario: post_to button click posts persisted blocks, Scenario: post_to button click with persisted suppressUnfurls, Scenario: post_to button click with unparseable snapshot surfaces an expired error, Scenario: post_to with suppress_unfurls true posts with unfurling disabled

### Community 445 - "Requirement: Skip Conditions Field"
Cohesion: 0.29
Nodes (7): Requirement: Required Tools Gate on submit_response, Scenario: A required tool was not called, Scenario: All required tools were called, Scenario: Gate runs before skip-response validation, Scenario: Multiple required tools — some missing, Scenario: No required tools configured, Scenario: Required tool was called and returned an error

### Community 446 - "Requirement: Configuration Section Display"
Cohesion: 0.29
Nodes (7): Requirement: Send to Thread Action Type, Scenario: Backward compatibility with send_to_thread action ID, Scenario: Multiple post_to buttons with different content, Scenario: post_to action rendering, Scenario: post_to action with content, Scenario: post_to content is required, Scenario: post_to with auto true is not rendered as button

### Community 447 - "Requirement: Status Section"
Cohesion: 0.29
Nodes (7): Requirement: Sequential Batch Delivery, Scenario: additional_messages each post top-level to the channel, Scenario: Mid-batch delivery failure stops the batch, Scenario: Primary consumes the streamer; followers post via chat.postMessage, Scenario: Success result reports delivered counts, Scenario: thread_replies use primary's ts as thread_ts when posted top-level, Scenario: thread_replies use the existing thread ts when primary is a thread reply

### Community 448 - "Requirement: Ignored triage marker with re-evaluation on content change"
Cohesion: 0.29
Nodes (7): Requirement: Action Tools, Scenario: Action tool retry on validation error, Scenario: cancel_worker_run registered alongside change tools, Scenario: propose_change detects existing worktree, Scenario: propose_change rejects insufficient write access, Scenario: propose_change tool validates and stages, Scenario: propose_config_update tool validates and stages

### Community 449 - "Requirement: Configurable work sources"
Cohesion: 0.29
Nodes (7): Requirement: list_scheduled_messages Tool, Scenario: Admin includes other users' jobs with includeOtherUsers, Scenario: Default scope lists caller's jobs and plugin-managed jobs, Scenario: List jobs for a channel applies within default scope, Scenario: List jobs for a plugin returns plugin-managed jobs in default scope, Scenario: No scheduled messages, Scenario: Non-admin passing includeOtherUsers falls back to default scope

### Community 450 - "Requirement: list_skill_pack_skills Tool"
Cohesion: 0.29
Nodes (7): Requirement: Cron Job Data Model, Scenario: Channelless dynamic job round-trips, Scenario: createdBy is null only for system-owned jobs, Scenario: Cron job structure, Scenario: Load jobs from disk, Scenario: Persist jobs to disk, Scenario: Static job without channel is rejected

### Community 451 - "Requirement: Skill Plugin Registry in config.json"
Cohesion: 0.29
Nodes (7): Requirement: Error Handling, Scenario: Execution failure notification for system-owned job, Scenario: Execution failure notification for user-created job, Scenario: No same-tick retry, Scenario: Skip is not a failure, Scenario: Static job failure for system-owned job, Scenario: Static job failure for user-created job

### Community 452 - "Requirement: Active Change Execution State"
Cohesion: 0.29
Nodes (7): Requirement: submitResponseMode CRUD, Scenario: Create with submitResponseMode, Scenario: Create without submitResponseMode, Scenario: reconcileCronJobs propagates the field, Scenario: Update clears submitResponseMode, Scenario: Update leaves submitResponseMode unchanged, Scenario: Update sets submitResponseMode

### Community 453 - "Requirement: Synthetic User Identity for Auto-Respond"
Cohesion: 0.29
Nodes (7): Requirement: GCE Deployment Script, Scenario: Deploy to GCE, Scenario: Existing instance update, Scenario: GCE prerequisites check, Scenario: Image reference is a single source of truth, Scenario: VM authenticates to Artifact Registry, Scenario: VM service account lacks read access

### Community 454 - "Requirement: Thread Message Structure"
Cohesion: 0.29
Nodes (3): Requirement: Localized Home Tab Strings, Scenario: Dynamic identifiers pass through unchanged, Scenario: Snapshot tests run against EN baseline

### Community 455 - "Requirement: Silent Thinking Mode"
Cohesion: 0.29
Nodes (7): Requirement: Role Management Section, Scenario: Add admin button, Scenario: Add dev button, Scenario: Hide from non-admins, Scenario: Remove admin button, Scenario: Remove dev button, Scenario: Show current roles

### Community 456 - "Requirement: Arg Extraction"
Cohesion: 0.29
Nodes (6): idler-ideas-ledger Specification, Purpose, Requirement: Concierge staleness visibility, Requirements, Scenario: Overdue computed from staleAfter against now, Scenario: Staleness fields accompany each unit

### Community 457 - "Requirement: Global Task Card Rendering Config"
Cohesion: 0.29
Nodes (7): Requirement: Reporting controls, Scenario: Defaults are quiet ticks plus a digest, Scenario: Explicit reporting block wins over legacy fields, Scenario: Fully silent configuration, Scenario: Legacy top-level fields are accepted, Scenario: Missing channel is dormant, not an error, Scenario: Tick-only configuration

### Community 458 - "Requirement: Per-Tool Args Enricher Hook"
Cohesion: 0.29
Nodes (7): Requirement: Three cooperating scheduled tasks, Scenario: Silent work fire posts nothing yet still implements, Scenario: Summary task is omitted when disabled, Scenario: Summary task reports activity, Scenario: Sync task refreshes the backlog read-only, Scenario: Work task advances exactly one unit per fire, Scenario: Work task may do nothing

### Community 459 - "Requirement: Plugin Tool Mappings Keyed by Plugin Server Name"
Cohesion: 0.29
Nodes (7): Requirement: USER SKILLS Subsection in the Catalog, Scenario: Catalog block header renders for user-skills-only case, Scenario: Disabled skills excluded, Scenario: Subsection omitted when feature disabled, Scenario: Subsection omitted when no enabled user skills, Scenario: Triggers hot-reload between turns, Scenario: User skills rendered inline

### Community 460 - "Requirement: Template Interpolation"
Cohesion: 0.29
Nodes (6): Purpose, Requirement: Encoded button action-value decode is schema-driven, Requirements, Scenario: Encoded values round-trip unchanged, Scenario: Non-encoded value falls back to sessionId, slack-action-values Specification

### Community 461 - "Requirement: Two-Tier Config Loading"
Cohesion: 0.29
Nodes (7): Requirement: Worker Flow Streaming, Scenario: Follow-up actions also stream, Scenario: report_status excluded from task cards, Scenario: Worker-specific tool labels, Scenario: Worker stream started, Scenario: Worker stream stopped on completion, Scenario: Worker tool calls shown as task cards

### Community 462 - "Requirement: save_question validates category"
Cohesion: 0.29
Nodes (7): Requirement: Choice option-count bounds cascade through all tiers, Scenario: Absent at every tier falls back to default, Scenario: explain_cascade reports the choices ladder, Scenario: Game override wins over workspace, Scenario: Per-slot pacing via game format, Scenario: Roll and save agree on bounds, Scenario: Season override wins over game

### Community 463 - "Requirement: Choice-question configuration"
Cohesion: 0.29
Nodes (7): Requirement: save_question accepts choice-question shape, Scenario: Choice question with isTrue rejected, Scenario: Choices out of resolved bounds rejected, Scenario: correctIndex out of range rejected, Scenario: Duplicate choice strings rejected, Scenario: Valid choice question saved, Scenario: Whitespace-equivalent duplicate choices rejected

### Community 464 - "Requirement: Reveal flow resolves question before parsing reactions"
Cohesion: 0.29
Nodes (7): Requirement: Exact-Match Pre-Check Bypasses the Reveal Judge, Scenario: Case- and whitespace-insensitive match skips the model, Scenario: Exact canonical answer skips the model, Scenario: Match against an acceptable variant skips the model, Scenario: Multi-guess hedge still rejected, Scenario: Non-matching answer falls through to the model judge, Scenario: Pre-check never folds materially-different strings together

### Community 465 - "Requirement: difficultyRatio axis at workspace and per-game tiers"
Cohesion: 0.29
Nodes (7): Requirement: finalRevealSummary field on TriviaGame and workspace, Scenario: Absent at both tiers resolves to default, Scenario: Game value wins over workspace, Scenario: list_games omits when unset, Scenario: list_games surfaces per-game and workspace values, Scenario: set_workspace_config persists the axis, Scenario: upsert_game persists and null clears

### Community 466 - "Requirement: Hint axis at workspace and per-game tiers"
Cohesion: 0.29
Nodes (7): Requirement: format axis at per-game tier, Scenario: Game with format posts one question per slot, Scenario: Game without format inherits the historical single-question behavior, Scenario: Invalid game format field dropped at load, Scenario: list_games omits format when absent, Scenario: list_games surfaces per-game format when set, Scenario: Season format wins over game format

### Community 467 - "Requirement: liveAnswersVisible field on TriviaGame"
Cohesion: 0.29
Nodes (7): Requirement: includeRevealInQuestions field on TriviaGame and workspace, Scenario: Absent at both tiers resolves to default, Scenario: Game value wins over workspace, Scenario: list_games omits when unset, Scenario: list_games surfaces per-game and workspace values, Scenario: set_workspace_config persists the axis, Scenario: upsert_game persists and null clears

### Community 468 - "Requirement: upsert_game surfaces cascade shadowing"
Cohesion: 0.29
Nodes (7): Requirement: Name format validation, Scenario: Existing rejections preserved, Scenario: Over 32 chars rejected, Scenario: Path-traversal characters rejected, Scenario: Uppercase rejected, Scenario: Valid name accepted, Scenario: Whitespace rejected

### Community 469 - "Requirement: image-medium questions MUST be about the image"
Cohesion: 0.29
Nodes (7): Requirement: revealResponses field on TriviaGame, Scenario: Absent field cascades to workspace config, Scenario: Game-level value beats workspace default, Scenario: Invalid string value is rejected, Scenario: list_games omits revealResponses when absent, Scenario: list_games surfaces revealResponses when set, Scenario: Non-string value is rejected

### Community 470 - "Requirement: POST_QUESTIONS_INSTRUCTIONS queries the staged pool before generating"
Cohesion: 0.29
Nodes (7): Requirement: upsert_game CREATE requires an initial season when seasons are enabled, Scenario: CREATE with seasons enabled requires initialSeason, Scenario: CREATE with seasons enabled writes the game and first season atomically, Scenario: initialSeason rejected on UPDATE, Scenario: initialSeason rejected when seasons disabled, Scenario: initialSeason startedAt defaults to now, Scenario: initialSeason validates expectedEndAt after startedAt

### Community 471 - "Requirement: post_questions MCP Tool"
Cohesion: 0.29
Nodes (7): Requirement: per-question generation dispatches on a 3-axis matrix, Scenario: Image+boolean for a unique subject falls back to property claim, Scenario: Visual fact boolean path generates a claim question, Scenario: Visual fact choice path generates an image-medium identification question, Scenario: Visual fact freeform path generates a typed-identification question, Scenario: Visual topical freeform combines media, sourceUrl, and expectedAnswer, Scenario: Visual topical paths produce questions with media AND sourceUrl

### Community 472 - "Requirement: find_previous_questions supports filtering by posted state"
Cohesion: 0.29
Nodes (7): Requirement: find_previous_subjects exact-match dedup tool, Scenario: Cross-format subjectId does NOT match, Scenario: Exact subjectId hit, Scenario: Legacy questions without media are excluded, Scenario: Malformed media field is treated as no media, Scenario: No matches returns empty list, Scenario: Season filter scopes the search

### Community 473 - "Requirement: save_question Accepts Freeform Fields"
Cohesion: 0.29
Nodes (7): Requirement: save_question validates promptMedium and media, Scenario: Image + boolean + media saves successfully, Scenario: Image + choice + media saves successfully, Scenario: Image + freeform + media saves successfully, Scenario: Image without media is rejected, Scenario: Non-HTTPS media URL is rejected, Scenario: Text with media is rejected

### Community 474 - "Requirement: Admin instructions preserve prompt structure by default, override only on explicit structural intent"
Cohesion: 0.29
Nodes (7): Requirement: Answer-reveal prompt step flow, Scenario: Reveal prompt branches block rendering on revealResponses, Scenario: Reveal prompt describes roundSummary as always present and mode-independent, Scenario: Reveal prompt describes the discriminated voter shape, Scenario: Reveal prompt sequences compute, projection, and render, Scenario: Reveal prompt skips projection on empty reveals, Scenario: Reveal prompt treats reactions as commentary

### Community 475 - "Requirement: Question-posting prompt renders a new-season opener on first fire"
Cohesion: 0.29
Nodes (7): Requirement: Puzzle-quality gate, Scenario: Flavor-leak check defers to the existing NO-SPOILER GATE, Scenario: Gate forbids surface tells and unverifiable-datum questions, Scenario: Gate instructs re-roll over shipping a weak question, Scenario: Gate is defined once and referenced by every path, Scenario: Gate mandates explicit reasoning over a checklist, Scenario: Gate subsumes the year/date-anchoring principle with a worked example

### Community 476 - "Requirement: Reveal table leads with This Round"
Cohesion: 0.29
Nodes (7): Requirement: check_season_status tool, Scenario: Call during a gap returns isInGap true, Scenario: Mid-season reveal with a queued future season, Scenario: Mid-season reveal with no queued future season, Scenario: Other games' timelines do not influence the result, Scenario: Tool is gated to admin, Scenario: Unknown game rejected

### Community 477 - "Requirement: Season per-slot overrides via sparse slotOverrides map"
Cohesion: 0.29
Nodes (7): Requirement: delete_season tool, Scenario: Cannot delete a past season, Scenario: Cannot delete the current season, Scenario: Cannot delete the only season in a game, Scenario: Delete a not-yet-started future season, Scenario: Tool is gated to admin, Scenario: Unknown game rejected

### Community 478 - "Requirement: mtime-Keyed Body Cache"
Cohesion: 0.29
Nodes (7): Requirement: Season-finale reveal layout, Scenario: allTimeRow=never suppresses the finale all-time table, Scenario: Finale labels localized in a French workspace, Scenario: Finale renders podium, participation tail, and all-time table, Scenario: First season's finale omits the redundant all-time table, Scenario: Mid-season reveal uses the normal table, Scenario: Tie shares a podium place

### Community 479 - "Requirement: User Skill Storage Layout"
Cohesion: 0.29
Nodes (7): Requirement: Worker Acquire Decision Tree, Scenario: Branch already on a busy worker, Scenario: Branch already on an idle worker, Scenario: Idle worker available, switch branch, Scenario: No idle, room to grow, Scenario: Pool exhausted, queue full, Scenario: Pool saturated, queue available

### Community 480 - "Requirement: Setup-Version Invalidation"
Cohesion: 0.29
Nodes (6): brave-image-search, How it returns images, Install, Licensing posture (read before enabling), Quota & rate limits, What it's for

### Community 481 - "trackedKinds.ts"
Cohesion: 0.29
Nodes (6): commons-image-search, How it returns images, Install, What it does NOT handle, What it handles well, Wikimedia etiquette

### Community 482 - "Requirement: Level-Keyed Classifier Policy"
Cohesion: 0.33
Nodes (6): Requirement: Direct-Address Override, Scenario: Active-run gate treats directed follow-up as append, Scenario: By-name request resolves to respond, Scenario: By-name sign-off resolves to stop, Scenario: Directed message is never skipped, Scenario: Non-directed ambient chatter still skips

### Community 483 - "Requirement: Temporal Proximity Signal"
Cohesion: 0.33
Nodes (6): Requirement: Pre-Analysis Persistence on Session, Scenario: Continuation verdict on assistant message, Scenario: Non-autoRespond sessions carry no preAnalysis field, Scenario: Session-creating autoRespond verdict on trigger, Scenario: Skipped sessions are not persisted, Scenario: Stop verdict captured on disengagement

### Community 484 - "Requirement: Auto-Respond Rule Persistence"
Cohesion: 0.33
Nodes (6): Requirement: Auto-Respond Message Handler, Scenario: Handler registered when enabled, Scenario: Include attachments and files, Scenario: Message with empty text but attachments, Scenario: No rules exist, Scenario: Trigger response on match

### Community 485 - "Requirement: Chattiness Heuristic"
Cohesion: 0.33
Nodes (6): Requirement: Auto-Respond Rule UI — Pre-Analysis Context, Scenario: Pre-analysis context cleared on submission, Scenario: Pre-analysis context displayed in rule summary, Scenario: Pre-analysis context field displayed, Scenario: Pre-analysis context field pre-populated on edit, Scenario: Pre-analysis context saved on submission

### Community 486 - "Requirement: Plugin Config File"
Cohesion: 0.33
Nodes (6): Requirement: Follow-Up Session for Top-Level Posts, Scenario: Disengaging one session does not affect the other, Scenario: Follow-up session creation failure does not block delivery, Scenario: Follow-up session defaults to engaged state, Scenario: Replies to the top-level post route to the follow-up session, Scenario: Top-level delivery creates a new session for its own thread

### Community 487 - "Requirement: Change Request Feedback"
Cohesion: 0.27
Nodes (6): Requirement: Admin Tool — `set_expected_rate`, Requirement: Built-in Fallback Topics Constant, Scenario: Built-in topics are defined and non-empty, Scenario: Built-in topics are not localized, Scenario: Set explicit die, Scenario: Set rate to "weekly"

### Community 488 - "Requirement: Failed Change Status Is Recoverable"
Cohesion: 0.33
Nodes (6): Requirement: Cancelled Change Status, Scenario: Cancellation during follow-up sets cancelled status, Scenario: Cancelled is terminal for blocking purposes, Scenario: ChangeResult carries cancellation info, Scenario: Phase mapping, Scenario: Workflow sets cancelled status

### Community 489 - "Requirement: Plugin Loading Lifecycle"
Cohesion: 0.33
Nodes (6): Requirement: Localized Bot-Authored Change Workflow Messages, Scenario: Active Workers Home Tab labels localized, Scenario: Cancellation confirmation localized, Scenario: External-merge / external-close notifications localized, Scenario: Initial workspace setup message localized, Scenario: Quarantine DM localized

### Community 490 - "Requirement: Plugin MCP Server Membership Gating"
Cohesion: 0.33
Nodes (6): Requirement: Worker Pool Mediation, Scenario: Acquire via pool on change start, Scenario: Disposable mode behaves as before, Scenario: Release via pool on discard, Scenario: Release via pool on follow-up merge or close, Scenario: Release via pool on PR completion

### Community 491 - "Requirement: Change Thread Follow-Up Action Types"
Cohesion: 0.33
Nodes (6): Requirement: ClackSdk Interface, Scenario: addInstruction method, Scenario: Path traversal rejected, Scenario: readFile method scoped to plugin data directory, Scenario: registerTool method (shorthand into the default server), Scenario: writeFile method scoped to plugin data directory

### Community 492 - "Requirement: DeliverFn Follower Path"
Cohesion: 0.33
Nodes (6): Requirement: Action Button Label Maximum Length, Scenario: hardcoded default labels stay within the cap, Scenario: label at exactly 40 chars is accepted, Scenario: optional label exceeds 40 chars, Scenario: required label exceeds 40 chars, Scenario: runtime validator catches a label injected outside the schema

### Community 493 - "Requirement: DeliverFn Supports postTopLevel Routing"
Cohesion: 0.33
Nodes (6): Requirement: post_to Carries Optional Actions, Scenario: clicking a cross-posted followup re-engages the original session, Scenario: clicking a cross-posted ref-based action resolves against the original session, Scenario: nested post_to inside post_to.actions is rejected, Scenario: post_to with followup action renders a button on the cross-posted message, Scenario: post_to without actions delivers without buttons

### Community 494 - "Requirement: Markdown Block Support"
Cohesion: 0.33
Nodes (6): Requirement: Snapshot Persistence Per post_to Captures Followers, Scenario: Button-click replays additional_messages as top-level posts, Scenario: Button-click replays thread_replies threaded under the primary, Scenario: Nested post_to inside post_to followers is still rejected, Scenario: Snapshot omits followers when absent, Scenario: Snapshot stores followers when present

### Community 495 - "Requirement: Optional Slack Block Kit Fields Are Preserved"
Cohesion: 0.33
Nodes (6): Requirement: cancel_scheduled_message Tool, Scenario: Admin cancels any job, Scenario: Cancel by ID, Scenario: Cancel non-existent job, Scenario: Cancel non-owned job as non-admin, Scenario: Cancel own job

### Community 496 - "Requirement: post_to Carries Optional Reactions"
Cohesion: 0.33
Nodes (6): Requirement: Role-Based Tool Gating, Scenario: Dev user tool set with plugins, Scenario: Member user tool set, Scenario: Plugin tools live in per-plugin servers, not in `clack`, Scenario: Plugin tools not included in worker mode, Scenario: Tool name collision with core tools is structurally impossible

### Community 497 - "Requirement: post_top_level Flag on submit_response"
Cohesion: 0.33
Nodes (6): Requirement: update_scheduled_message Supports skipConditions, Scenario: Update a non-existent job, Scenario: Update by non-creator non-admin is rejected, Scenario: Update clears skipConditions, Scenario: Update leaves skipConditions unchanged, Scenario: Update sets skipConditions

### Community 498 - "Requirement: find_changes Waiting and Freshness Reporting"
Cohesion: 0.33
Nodes (6): Requirement: Utility Queries Use clackQuery, Scenario: Error analysis uses clackQuery, Scenario: MCP server test uses clackQuery, Scenario: Migration engine uses clackQuery, Scenario: Pre-analysis uses clackQuery, Scenario: Summarization uses clackQuery

### Community 499 - "Requirement: In-Process MCP Tool Server"
Cohesion: 0.33
Nodes (6): Requirement: Config Update Auto-Execute, Scenario: Auto-execute config delete failure, Scenario: Auto-execute config delete on clear directive, Scenario: Auto-execute config write failure, Scenario: Auto-execute config write on clear directive, Scenario: Proposal mode for exploratory config discussions

### Community 500 - "Requirement: Output Capture and Formatting"
Cohesion: 0.33
Nodes (6): Requirement: Repository-Scoped Config File Addressing, Scenario: Exactly one of role or repo required, Scenario: Repo-mode file restricted to the editable set, Scenario: Repo-mode path resolution, Scenario: Topic rejected in repo mode, Scenario: Unknown repository rejected at the tool layer

### Community 501 - "Requirement: Cron Job CRUD Operations"
Cohesion: 0.33
Nodes (6): Requirement: Channel Input Resolution for Scheduled Message Creation, Scenario: Channel ID passthrough, Scenario: Channel name resolved before persistence, Scenario: Resolution failure blocks creation, Scenario: Self-DM user ID normalized, Scenario: Third-party user ID rejected

### Community 502 - "Requirement: Cron Job Jitter Field"
Cohesion: 0.33
Nodes (6): Requirement: Jittered Match-Window Offset, Scenario: Canonical expression is preserved for display, Scenario: Double-fire guard holds under jitter, Scenario: Effective fire is delayed by a forward offset, Scenario: Offset is deterministic across ticks within one occurrence, Scenario: Offset varies between occurrences

### Community 503 - "Requirement: Auth Directory Structure"
Cohesion: 0.33
Nodes (6): Requirement: Schedule Name Field, Scenario: Legacy nameless job loads without error, Scenario: New cron job stores a name, Scenario: Update with empty string clears the name, Scenario: Update with new name overwrites stored value, Scenario: Update without name leaves field untouched

### Community 504 - "Requirement: Dockerfile"
Cohesion: 0.33
Nodes (6): Requirement: Skip Conditions Field, Scenario: Create with skipConditions, Scenario: Create without skipConditions, Scenario: Update clears skipConditions, Scenario: Update leaves skipConditions unchanged, Scenario: Update sets skipConditions

### Community 505 - "Requirement: Pre-Swap Drain Gate"
Cohesion: 0.33
Nodes (6): Requirement: Configuration Section Display, Scenario: Hide from non-editors, Scenario: Show admin config tools hint for admin users, Scenario: Show chat hint, Scenario: Show repo instruction files, Scenario: Show role directories with file counts

### Community 506 - "Requirement: Slack Credential Separation"
Cohesion: 0.33
Nodes (6): Requirement: Status Section, Scenario: Hide access tags for members, Scenario: No MCP servers configured, Scenario: Show access tags for dev+ users, Scenario: Show MCP server status, Scenario: Show repository status filtered by role

### Community 507 - "Requirement: Auto-Respond Section"
Cohesion: 0.33
Nodes (6): Requirement: Ignored triage marker with re-evaluation on content change, Scenario: Adopting an ignored entry clears the marker, Scenario: Ignored entry stays ignored across scans, Scenario: Ignored is distinct from done, Scenario: Legacy slice without ignoredAt parses, Scenario: Re-remembered ignored entry re-qualifies

### Community 508 - "Requirement: Plugin Error Banner"
Cohesion: 0.33
Nodes (6): Requirement: Configurable work sources, Scenario: Memory source is gated by config, Scenario: New source type needs no code change, Scenario: Sentry alert channel becomes an issue-keyed unit, Scenario: Slack channel issue becomes a unit, Scenario: Tracker task becomes a unit

### Community 509 - "Requirement: Schedule Rows Omit Channel Portion When Channelless"
Cohesion: 0.33
Nodes (6): Requirement: list_skill_pack_skills Tool, Scenario: Empty pack returns a clear message, Scenario: Non-lazy pack rejected, Scenario: Successful listing of a lazy pack, Scenario: Unknown pack returns error, Scenario: user-skills pack listing rejected with redirect

### Community 510 - "Requirement: Transfer Ownership UI"
Cohesion: 0.33
Nodes (6): Requirement: Skill Plugin Registry in config.json, Scenario: Invalid lazyLoad type rejected, Scenario: Lazy entry missing description rejected, Scenario: Missing entry defaults to eager loading, Scenario: Non-object entry rejected, Scenario: Valid registry parses successfully

### Community 511 - "Requirement: Stable source-keyed unit identity and dedup"
Cohesion: 0.33
Nodes (6): Requirement: Active Change Execution State, Scenario: Active change cleared on completion, Scenario: Active change has PR, Scenario: Active change status transitions, Scenario: Session with active change, Scenario: Session without active change

### Community 512 - "Requirement: Every-fire memory-maintenance pass"
Cohesion: 0.33
Nodes (6): Requirement: Synthetic User Identity for Auto-Respond, Scenario: Active workers display for auto-respond sessions, Scenario: Role resolution for synthetic user, Scenario: Session created with synthetic user ID, Scenario: Session ID parsing for synthetic user, Scenario: User info lookup gracefully handles synthetic user

### Community 513 - "Requirement: Off-hours channelless cron plugin"
Cohesion: 0.33
Nodes (6): Requirement: Thread Message Structure, Scenario: No reactions line for unreacted messages, Scenario: Reactions formatted in thread context prompt, Scenario: Thread message with no reactions, Scenario: Thread message with user names, Scenario: Thread message without user names

### Community 514 - "Requirement: Priority-ordered work-kind ladder"
Cohesion: 0.33
Nodes (6): Requirement: Silent Thinking Mode, Scenario: Direct delivery when silentThinking, Scenario: Error handling when silentThinking, Scenario: Existing streaming behavior unchanged, Scenario: No streamer created when silentThinking, Scenario: Top-level posting when silentThinking

### Community 515 - "Requirement: Recently-updated memory scan during sync"
Cohesion: 0.33
Nodes (6): Requirement: Arg Extraction, Scenario: Aliasing a nested arg without regex, Scenario: Extraction skipped when regex doesn't match, Scenario: Extraction skipped when source is missing, Scenario: Real args take precedence over extracted values, Scenario: Regex extraction from a URL arg

### Community 516 - "Requirement: Safety rails for autonomous operation"
Cohesion: 0.33
Nodes (6): Requirement: Global Task Card Rendering Config, Scenario: Built-in fallback applies when only maxDetailsPerGroup field is absent, Scenario: Built-in fallback applies when taskCards section is absent, Scenario: Global default applies when no per-group override exists, Scenario: maxDetailsPerGroup of 0 is a valid value, Scenario: Negative or non-numeric values are rejected

### Community 517 - "Requirement: Work-state in the core memory namespace"
Cohesion: 0.33
Nodes (6): Requirement: Per-Tool Args Enricher Hook, Scenario: clearArgEnrichers resets the registry, Scenario: Enricher with no match preserves fallback chain, Scenario: Multiple enrichers compose in registration order, Scenario: Registered enricher augments args before interpolation, Scenario: Throwing enricher does not crash label rendering

### Community 518 - "Requirement: In-Memory Thread-to-Session Index"
Cohesion: 0.33
Nodes (6): Requirement: Plugin Tool Mappings Keyed by Plugin Server Name, Scenario: Core `clack` mapping unaffected by plugin loading, Scenario: Missing plugin config falls back to generic MCP label, Scenario: Plugin file-based config overrides plugin-registered mappings, Scenario: Single plugin produces its own mapping entry, Scenario: Two-tier override applies to plugin config files

### Community 519 - "Requirement: Session Timeout"
Cohesion: 0.33
Nodes (6): Requirement: Template Interpolation, Scenario: Empty string args treated as missing, Scenario: Fallback chain with missing args, Scenario: Literal fallback at end of chain, Scenario: Only word characters recognized as arg names, Scenario: Simple arg substitution

### Community 520 - "Requirement: Stream Generation Guard"
Cohesion: 0.33
Nodes (6): Requirement: Two-Tier Config Loading, Scenario: Default config only, Scenario: Malformed config file skipped, Scenario: No config for a server, Scenario: User adds new server config, Scenario: User override replaces default

### Community 521 - "Requirement: Config-Driven Tool Links"
Cohesion: 0.33
Nodes (6): Requirement: save_question validates category, Scenario: Category in baseline but not current season is rejected, Scenario: Falls through to categories.json when neither season nor game set, Scenario: Game categories used when seasons disabled, Scenario: Invalid category (seasons disabled, no game categories), Scenario: Valid category (seasons enabled)

### Community 522 - "Requirement: Label Sanitization"
Cohesion: 0.33
Nodes (6): Requirement: Choice-question configuration, Scenario: Choice-only configuration, Scenario: Default configuration generates boolean questions only, Scenario: Invalid choice bounds rejected at any tier, Scenario: Invalid choice bounds rejected at load, Scenario: Mixed-format configuration generates both formats

### Community 523 - "Requirement: Bot auto-reactions sized to answersFormat"
Cohesion: 0.33
Nodes (6): Requirement: Reveal flow resolves question before parsing reactions, Scenario: Boolean reveal reads from answers.json, Scenario: Choice reveal reads from answers.json, Scenario: No fence-sitters category in payload, Scenario: No multi-react void in payload, Scenario: questionType does not alter reveal

### Community 524 - "Requirement: Shape-Specific Judge Prompts"
Cohesion: 0.33
Nodes (6): Requirement: difficultyRatio axis at workspace and per-game tiers, Scenario: Inner weight map with all-zero weights rejected at load, Scenario: Inner weight map with unknown bucket key rejected at load, Scenario: Per-game difficultyRatio overrides workspace tier, Scenario: Workspace difficultyRatio absent when not configured, Scenario: Workspace difficultyRatio surfaces via list_games

### Community 525 - "Requirement: Game config validation is schema-driven"
Cohesion: 0.33
Nodes (6): Requirement: Hint axis at workspace and per-game tiers, Scenario: Per-game hint absent — workspace cascade wins, Scenario: Per-game hint overrides workspace tier, Scenario: Per-game hint surfaces via list_games, Scenario: Workspace hint absent when not configured, Scenario: Workspace hint surfaces via list_games

### Community 526 - "Requirement: Games registry lives in config"
Cohesion: 0.33
Nodes (6): Requirement: liveAnswersVisible field on TriviaGame, Scenario: Absent field cascades to workspace config, Scenario: Game-level false beats workspace default, Scenario: list_games omits the field when absent, Scenario: list_games surfaces the field when set, Scenario: Non-boolean field is rejected

### Community 527 - "Requirement: Per-slot axis overrides resolve from the effective format"
Cohesion: 0.33
Nodes (6): Requirement: upsert_game surfaces cascade shadowing, Scenario: A game's own format slot shadows its top-level axis, Scenario: Format shadowing is reported as a string pseudo-field, Scenario: No active season and no masking slot reports nothing, Scenario: Season-shadowed game edit is reported, Scenario: Unshadowed edit reports nothing

### Community 528 - "Requirement: theme axis at per-game tier"
Cohesion: 0.33
Nodes (6): Requirement: image-medium questions MUST be about the image, Scenario: Decorative-image claim fails the gate, Scenario: Identification claim passes the gate, Scenario: Identity-swap claim passes the gate, Scenario: Image-grounded property claim passes the gate, Scenario: Unrelated-image claim fails the gate

### Community 529 - "Requirement: Question Spec Declares submitResponseMode "skipped""
Cohesion: 0.33
Nodes (6): Requirement: POST_QUESTIONS_INSTRUCTIONS queries the staged pool before generating, Scenario: Flexible format fills a prefix and stops early, Scenario: Flexible format with no material posts nothing, Scenario: Question cron with complete staged pool, Scenario: Question cron with empty staged pool (prep configured but didn't run), Scenario: Question cron with partial staged pool

### Community 530 - "Requirement: Required Tools Are Limited To Always-Called Tools"
Cohesion: 0.33
Nodes (6): Requirement: post_questions MCP Tool, Scenario: Hint button appended after answer buttons in boolean question, Scenario: Hint button appended after answer buttons in choice question, Scenario: Inline hint context block precedes the answer-buttons actions block, Scenario: No hint on record — posting unchanged, Scenario: postedBlocks snapshot includes hint elements

### Community 531 - "Requirement: post_questions Accepts appendToPreviousBatch Flag"
Cohesion: 0.33
Nodes (6): Requirement: find_previous_questions supports filtering by posted state, Scenario: posted combines with other criteria under match: "all", Scenario: posted combines with other criteria under match: "any", Scenario: posted: false returns only staged questions, Scenario: posted omitted returns all questions, Scenario: posted: true returns only posted questions

### Community 532 - "Requirement: find_previous_questions exposes derived batch facts, never the batchId"
Cohesion: 0.33
Nodes (6): Requirement: save_question Accepts Freeform Fields, Scenario: Boolean save with freeform field, Scenario: Freeform save missing expectedAnswer, Scenario: Freeform save with cross-format field, Scenario: Freeform save with optional fields, Scenario: Freeform save with required field

### Community 533 - "Requirement: Find previous questions response excludes the answer key"
Cohesion: 0.33
Nodes (6): Requirement: Admin instructions preserve prompt structure by default, override only on explicit structural intent, Scenario: Explicit instruction omits the leaderboard table, Scenario: Explicit structural instruction overrides the default layout, Scenario: Instruction cannot remove tool-appended answer buttons, Scenario: Non-structural instruction preserves the card and table, Scenario: Single-block instruction does not bleed into siblings

### Community 534 - "Requirement: `"just-winners"` reveal-disclosure variant"
Cohesion: 0.33
Nodes (6): Requirement: Question-posting prompt renders a new-season opener on first fire, Scenario: Opener applies to both single-question and multi-slot flows, Scenario: Opener branch present in question-posting prompt, Scenario: Opener does NOT introduce new tool calls, Scenario: Opener fires regardless of how the season originated, Scenario: Opener mentions theme conditionally

### Community 535 - "Requirement: Legacy Trivia Cron Migration"
Cohesion: 0.33
Nodes (6): Requirement: Reveal table leads with This Round, Scenario: Absent-this-round player uses em-dash and sorts last, Scenario: Columns stay aligned when a player is em-dash in one row but numbered in another, Scenario: Empty perPlayer falls back to season-score column order, Scenario: This Round gated on non-empty perPlayer, not reveals.length or mode, Scenario: This Round is the top data row and drives column order

### Community 536 - "Requirement: Seasons configuration block"
Cohesion: 0.33
Nodes (6): Requirement: Season per-slot overrides via sparse slotOverrides map, Scenario: Both slotOverrides and a structural format is rejected, Scenario: Override a single slot field without restating the list, Scenario: Slot override inherits unset fields from the game slot, Scenario: slotOverrides for an index the game format lacks, Scenario: slotOverrides is surfaced for audit

### Community 537 - "Requirement: editableByAnyone Attribute"
Cohesion: 0.33
Nodes (6): Requirement: mtime-Keyed Body Cache, Scenario: Cache cleared on lifecycle reload, Scenario: Disabled skill not loadable, Scenario: Fresh load reads from disk, Scenario: mtime mismatch triggers re-read, Scenario: Repeat load with unchanged mtime returns cached body

### Community 538 - "Requirement: Permission-Aware Edit Modal"
Cohesion: 0.33
Nodes (6): Requirement: User Skill Storage Layout, Scenario: Directory missing .meta.json is ignored, Scenario: Directory missing SKILL.md is ignored, Scenario: Discovery finds well-formed skills, Scenario: Frontmatter name mismatch is ignored, Scenario: Meta without editableByAnyone is valid

### Community 539 - "Requirement: userSkills Config Block"
Cohesion: 0.33
Nodes (6): Requirement: Setup-Version Invalidation, Scenario: Branch-sticky acquire heals stale setup, Scenario: Hash differs, setup re-runs, Scenario: Hash matches, setup skipped, Scenario: Missing instructions file, Scenario: Recovery path heals stale setup

### Community 540 - "Requirement: Boot-Time Provisioning"
Cohesion: 0.40
Nodes (5): Requirement: Level-Keyed Classifier Policy, Scenario: High policy responds to nearly everything, Scenario: Low policy preserves conservative behavior, Scenario: Medium policy leans toward respond, Scenario: Stop reserved to the low policy

### Community 541 - "Requirement: Branch Switching with Dirty-Worker Quarantine"
Cohesion: 0.40
Nodes (5): Requirement: Temporal Proximity Signal, Scenario: Elapsed time computed and injected, Scenario: Long gap does not by itself disengage, Scenario: No prior bot message in thread, Scenario: Short gap strengthens engagement lean

### Community 542 - "Requirement: Quarantine Lifecycle"
Cohesion: 0.40
Nodes (5): Requirement: Auto-Respond Rule Persistence, Scenario: Concurrent rule modifications, Scenario: Load rules on first access, Scenario: Persist rules on change, Scenario: Rule file structure

### Community 543 - "Requirement: Resume-from-Remote-Branch Acquire"
Cohesion: 0.40
Nodes (5): Requirement: Chattiness Heuristic, Scenario: Die clamps to 1 minimum, Scenario: Explicit die overrides expectedRate, Scenario: Heuristic for daily over 9-16 weekdays, Scenario: Heuristic for weekly over 9-17 weekdays

### Community 544 - "Requirement: Worker State Persistence"
Cohesion: 0.40
Nodes (5): Requirement: Plugin Config File, Scenario: Config round-trips through I/O, Scenario: Config validation rejects invalid workHours, Scenario: First load creates the config file with defaults, Scenario: Pre-existing config without the field parses with the default

### Community 545 - "gce-common.sh"
Cohesion: 0.40
Nodes (5): Requirement: Change Request Feedback, Scenario: Acknowledge change request, Scenario: Failure determined from session state, Scenario: Initial progress message, Scenario: Success determined from session state

### Community 546 - "listConfigFiles.ts"
Cohesion: 0.40
Nodes (5): Requirement: Plugin Loading Lifecycle, Scenario: Plugin calls sdk.error then returns, Scenario: Plugin error does not crash startup, Scenario: Plugin loaded at startup, Scenario: SDK instance persists for data access

### Community 547 - "forget.ts"
Cohesion: 0.40
Nodes (5): Requirement: Plugin MCP Server Membership Gating, Scenario: Default server is always assembled, Scenario: On-demand server's tools are absent from the baseline when not attached, Scenario: On-demand server's tools are present in the baseline when attached at session start (resume), Scenario: Role gate still applies independently of server membership

### Community 548 - "adminDescribeConfigFile.ts"
Cohesion: 0.40
Nodes (5): Requirement: Change Thread Follow-Up Action Types, Scenario: Close action with ref and optional auto, Scenario: Merge action with ref and optional auto, Scenario: Review action with ref and optional auto, Scenario: Update action with ref and optional auto

### Community 549 - "Requirement: Direct-to-Channel Delivery via post_top_level"
Cohesion: 0.40
Nodes (5): Requirement: DeliverFn Follower Path, Scenario: Duplicate primary delivery is still rejected, Scenario: Existing single-message callers unaffected, Scenario: postTopLevel after primary routes to top-level channel post, Scenario: threadTs after primary routes to chat.postMessage with thread_ts

### Community 550 - "Requirement: Role Directory Structure"
Cohesion: 0.40
Nodes (5): Requirement: DeliverFn Supports postTopLevel Routing, Scenario: deliver with suppressUnfurls true forwards to postMessage, Scenario: deliver without suppressUnfurls, Scenario: postTopLevel delivery failure surfaces to the caller, Scenario: postTopLevel routes via chat.postMessage without thread_ts

### Community 551 - "Requirement: Two-Tier Resolution Within Each Role Level"
Cohesion: 0.40
Nodes (5): Requirement: Markdown Block Support, Scenario: a single markdown block exceeds 12,000 chars, Scenario: cumulative markdown text exceeds 12,000 chars, Scenario: markdown block accepted and passed through, Scenario: markdown block missing text

### Community 552 - "Requirement: Admin Tool — `add_channel`"
Cohesion: 0.40
Nodes (5): Requirement: Optional Slack Block Kit Fields Are Preserved, Scenario: button with confirm dialog is preserved, Scenario: prepareBlocks does not recurse into passthrough fields, Scenario: section block with block_id is preserved, Scenario: unknown block type is still rejected

### Community 553 - "Requirement: Admin Tool — `add_small_talk_topic` and `remove_small_talk_topic`"
Cohesion: 0.40
Nodes (5): Requirement: post_to Carries Optional Reactions, Scenario: auto-path post_to with reactions adds reactions to the cross-posted message, Scenario: button-click post_to with persisted reactions adds reactions on click, Scenario: invalid reactions on post_to are silently ignored, Scenario: post_to without reactions does not call reactions.add

### Community 554 - "Requirement: Admin Tool — `set_casual_talk_config`"
Cohesion: 0.40
Nodes (5): Requirement: find_changes Waiting and Freshness Reporting, Scenario: Freshness fields reported, Scenario: No pool-internal fields leak, Scenario: Running change is not flagged as waiting, Scenario: Waiting change is flagged

### Community 555 - "Requirement: Admin Tool — `set_channel_prompt_suggestion`"
Cohesion: 0.40
Nodes (5): Requirement: In-Process MCP Tool Server, Scenario: Query-mode tool assembly returns a record of MCP servers, Scenario: Reaction tools registered when Slack client available, Scenario: Tool server captures query context via closure, Scenario: Worker-mode tool assembly returns a single server

### Community 556 - "Requirement: Admin Tool — `toggle_builtin_fallback_topics`"
Cohesion: 0.40
Nodes (5): Requirement: Output Capture and Formatting, Scenario: Fallback to raw text, Scenario: Long responses split for Slack, Scenario: Markdown to Slack formatting, Scenario: Structured response from submit_response

### Community 557 - "Requirement: Cron Spec Assembly (Channelless)"
Cohesion: 0.40
Nodes (5): Requirement: Cron Job CRUD Operations, Scenario: Create a cron job, Scenario: Delete cron job, Scenario: List cron jobs, Scenario: Toggle cron job

### Community 558 - "Requirement: ClackSdk Exposes Capability Flags"
Cohesion: 0.40
Nodes (5): Requirement: Cron Job Jitter Field, Scenario: Jitter field round-trips through persistence, Scenario: Jitter omitted when unset, Scenario: Jitter value is validated, Scenario: Legacy rows without jitter load unchanged

### Community 559 - "Requirement: ClackSdk Exposes Plugin Error Reporting"
Cohesion: 0.40
Nodes (5): Requirement: Auth Directory Structure, Scenario: Auth directory gitignored, Scenario: Environment file location, Scenario: GitHub App credentials location, Scenario: Slack credentials location

### Community 560 - "Requirement: ClackSdk Exposes User Registry Accessor"
Cohesion: 0.40
Nodes (5): Requirement: Dockerfile, Scenario: Multi-stage build, Scenario: Non-root user, Scenario: Required system dependencies, Scenario: Volume mount points

### Community 561 - "Requirement: ClackSdk Posting Helpers Accept suppressUnfurls"
Cohesion: 0.40
Nodes (5): Requirement: Pre-Swap Drain Gate, Scenario: Bounded wait then proceed, Scenario: Busy bot is waited on, Scenario: Idle bot proceeds immediately, Scenario: Status unreachable does not block deploy

### Community 562 - "Requirement: Home Tab Plugin Display"
Cohesion: 0.40
Nodes (5): Requirement: Slack Credential Separation, Scenario: Config file without Slack secrets, Scenario: Migration from old config format, Scenario: Missing Slack auth file, Scenario: Slack auth file format

### Community 563 - "Requirement: Plugin Contract"
Cohesion: 0.40
Nodes (5): Requirement: Auto-Respond Section, Scenario: Display rules list, Scenario: Empty state, Scenario: Hide section from non-admins, Scenario: Show section to admins

### Community 564 - "Requirement: Plugin SDK Single-Turn Claude Call"
Cohesion: 0.40
Nodes (5): Requirement: Plugin Error Banner, Scenario: Non-admin does not see banner, Scenario: Plugin with multiple errors shows multi-line banner, Scenario: Plugin with no errors shows no banner, Scenario: Plugin with single error shows banner

### Community 565 - "Requirement: Plugin Tool Mapping Supports Hidden Flag"
Cohesion: 0.40
Nodes (5): Requirement: Transfer Ownership UI, Scenario: Execute transfer, Scenario: Handle transfer button click, Scenario: Hide transfer from non-owners, Scenario: Show transfer button to owner

### Community 566 - "Requirement: PluginLoadResult Includes Errors"
Cohesion: 0.40
Nodes (5): Requirement: Stable source-keyed unit identity and dedup, Scenario: Discovery of an archived entity enriches rather than suppresses, Scenario: Distinct issues are distinct units, Scenario: Re-activated done unit re-opens, Scenario: Repeated Sentry alert maps to one unit

### Community 567 - "Requirement: SDK engageThread Method"
Cohesion: 0.40
Nodes (5): Requirement: Every-fire memory-maintenance pass, Scenario: Close-resolved respects work-task authority, Scenario: Maintenance runs every fire regardless of the round-robin, Scenario: Maintenance still runs when discovery is gated off, Scenario: Resolved tracked unit is closed during sync

### Community 568 - "Requirement: Skill-Plugins Directory Rename"
Cohesion: 0.40
Nodes (5): Requirement: Off-hours channelless cron plugin, Scenario: Config hot-reloads, Scenario: Jobs fire only outside active hours, Scenario: Plugin disabled or no allowlisted repos, Scenario: Plugin loads only with cron capability

### Community 569 - "Requirement: Centralized Block Handling Across Outbound Surfaces"
Cohesion: 0.40
Nodes (5): Requirement: Priority-ordered work-kind ladder, Scenario: Higher-priority kind preempts lower, Scenario: No fresh kind means do nothing, Scenario: Review is the lowest productive kind, and only when fresh, Scenario: Triage and review do not open a worktree

### Community 570 - "Requirement: Continuation Action Types"
Cohesion: 0.40
Nodes (5): Requirement: Recently-updated memory scan during sync, Scenario: Actionable memory entry is adopted, Scenario: Non-work memory entry is marked not-idler-work, Scenario: Out-of-allowlist entry is not adopted, Scenario: Unchanged not-work entries are not re-triaged

### Community 571 - "Requirement: Message Preamble Renders Above Blocks"
Cohesion: 0.40
Nodes (5): Requirement: Safety rails for autonomous operation, Scenario: Action caps bound autonomous work, Scenario: Execution failure is recorded, not terminal, Scenario: Non-allowlisted repo is never touched, Scenario: Per-fire cap stops code changes mid-fire

### Community 572 - "Requirement: Multi-Message Inside post_to"
Cohesion: 0.40
Nodes (5): Requirement: Work-state in the core memory namespace, Scenario: Activity digest stays an idler file, Scenario: Core review respects the idler pre-expire hook, Scenario: Sync writes core memory then attaches the idler slice, Scenario: Work fire selects from the memory namespace

### Community 573 - "Requirement: Multi-Message Top-Level Fields Gated To Scheduled Trigger"
Cohesion: 0.40
Nodes (5): Requirement: In-Memory Thread-to-Session Index, Scenario: Index miss falls back to disk scan, Scenario: Index populated at startup, Scenario: Index populated on session creation, Scenario: Index used for lookup

### Community 574 - "Requirement: Per-Message Payload Shape"
Cohesion: 0.40
Nodes (5): Requirement: Session Timeout, Scenario: Active change sessions excluded from eviction, Scenario: Age-based eviction, Scenario: Maximum age configurable, Scenario: Sessions persist indefinitely during normal use

### Community 575 - "Requirement: post_to.actions Validated Identically To Top-Level Actions"
Cohesion: 0.40
Nodes (5): Requirement: Stream Generation Guard, Scenario: Concurrent expiry rejections collapse to one rollover, Scenario: First failing append from the live generation rolls over, Scenario: Generation bumped on each successful stream open, Scenario: Stale append from a superseded generation does not roll over again

### Community 576 - "Requirement: Required Tools Supplied via Session Context"
Cohesion: 0.40
Nodes (5): Requirement: Config-Driven Tool Links, Scenario: Link constructed from multiple args, Scenario: Link from a URL arg, Scenario: Link suppressed when args are missing, Scenario: Link text auto-derived from URL

### Community 577 - "Requirement: Shared Message-Content Schema Across submit_response and post_to"
Cohesion: 0.40
Nodes (5): Requirement: Label Sanitization, Scenario: Shorten paths, Scenario: Strip dangerous characters, Scenario: Truncate final label, Scenario: Truncate long arg values

### Community 578 - "Requirement: find_session_transcript Tool Registration"
Cohesion: 0.40
Nodes (5): Requirement: Bot auto-reactions sized to answersFormat, Scenario: No auto-attached reactions on boolean, Scenario: No auto-attached reactions on choice, Scenario: No auto-attached reactions on freeform, Scenario: User-added reactions are preserved as commentary

### Community 579 - "Requirement: Staged Intent Storage"
Cohesion: 0.40
Nodes (5): Requirement: Shape-Specific Judge Prompts, Scenario: Date question uses the inclusive-tolerance block, Scenario: Default preset preserves typo tolerance, Scenario: Name/place/title question uses the named-entity block, Scenario: Strict preset omits typo tolerance

### Community 580 - "Requirement: PR Template Resolution"
Cohesion: 0.40
Nodes (5): Requirement: Game config validation is schema-driven, Scenario: A single schema gates both load and tool paths, Scenario: Adding an axis requires only the schema, Scenario: Lenient and strict paths differ only in wrapping, Scenario: slotOverrides validated per-slot under numeric-string keys

### Community 581 - "Requirement: Session Context Continuation"
Cohesion: 0.40
Nodes (5): Requirement: Games registry lives in config, Scenario: Empty games list is supported, Scenario: Malformed prepCron drops the field, Scenario: Plugin loads game with prepCron, Scenario: Plugin loads games from config

### Community 582 - "Requirement: Startup Baseline Token Smoke Test"
Cohesion: 0.40
Nodes (5): Requirement: Per-slot axis overrides resolve from the effective format, Scenario: All three consumers agree on the slot tier, Scenario: Game-format slot axis override takes effect, Scenario: Out-of-range slot index yields no slot tier, Scenario: Season format still wins when present

### Community 583 - "Requirement: create_scheduled_message Requires a Name"
Cohesion: 0.40
Nodes (5): Requirement: theme axis at per-game tier, Scenario: Blank game theme field dropped at load, Scenario: Game theme used when no season theme is set, Scenario: list_games surfaces per-game theme when set, Scenario: Season theme wins over game theme

### Community 584 - "Requirement: Synchronous In-Memory Job Lookup Accessor"
Cohesion: 0.40
Nodes (5): Requirement: Question Spec Declares submitResponseMode "skipped", Scenario: Disabled games emit no specs (including no submitResponseMode declarations), Scenario: Question spec has submitResponseMode "skipped", Scenario: reconcileCronJobs propagates submitResponseMode to persisted jobs, Scenario: Reveal spec leaves submitResponseMode unset

### Community 585 - "Requirement: Create Skill Modal"
Cohesion: 0.40
Nodes (5): Requirement: Required Tools Are Limited To Always-Called Tools, Scenario: Flexible game question spec omits post_questions, Scenario: Non-flexible question spec requiredTools, Scenario: Reveal requiredTools does not vary with seasons, Scenario: Reveal spec requiredTools is the single-tool compute list

### Community 586 - "Requirement: Edit Skill Modal"
Cohesion: 0.40
Nodes (5): Requirement: post_questions Accepts appendToPreviousBatch Flag, Scenario: appendToPreviousBatch reuses the most-recent batch's UUID, Scenario: Default behavior is preserved when the flag is absent or false, Scenario: "Most recent batch" is the group with the largest max(postedAt), Scenario: Multiple fresh items in one appendToPreviousBatch call all share the resolved batchId

### Community 587 - "Requirement: Migration Status Banner"
Cohesion: 0.40
Nodes (5): Requirement: find_previous_questions exposes derived batch facts, never the batchId, Scenario: A live latest batch reports pending and latest, Scenario: A staged (unposted) row omits the batch facts, Scenario: An older revealed batch reports neither pending nor latest, Scenario: Facts are computed per game in a cross-game scan

### Community 588 - "Requirement: Settings Modal"
Cohesion: 0.40
Nodes (5): Requirement: Find previous questions response excludes the answer key, Scenario: Boolean response payload omits isTrue, Scenario: Choice response payload omits correctIndex but includes choices, Scenario: Empty result is unaffected, Scenario: Freeform response payload omits answer-key fields

### Community 589 - "Requirement: User Selection Modals"
Cohesion: 0.40
Nodes (5): Requirement: `"just-winners"` reveal-disclosure variant, Scenario: Boolean question stamped just-winners names winners and counts missers, Scenario: Everyone missed — winners bucket empty, miss count positive, Scenario: Freeform just-winners keeps winner answerText, never misser text, Scenario: just-winners entry still contributes to roundSummary

### Community 590 - "Requirement: Coldest-first ordering for the concierge rotation"
Cohesion: 0.40
Nodes (5): Requirement: Legacy Trivia Cron Migration, Scenario: Dispatcher pair migrates cleanly, Scenario: Inline fat-prompt legacy job is left in place, Scenario: Migration is idempotent, Scenario: Unpaired candidate is flagged

### Community 591 - "Requirement: Concierge parks stale units via the existing sink"
Cohesion: 0.40
Nodes (5): Requirement: Seasons configuration block, Scenario: Seasons disabled by default, Scenario: Seasons enabled requires a prompt, Scenario: Seasons enabled with prompt, Scenario: Seasons explicitly disabled

### Community 592 - "Requirement: Self-describing work-unit ledger"
Cohesion: 0.40
Nodes (5): Requirement: editableByAnyone Attribute, Scenario: Absent attribute reads as false, Scenario: Attribute preserved across content update, Scenario: Attribute preserved across disable and restore, Scenario: Attribute round-trips through meta

### Community 593 - "Requirement: Sync-recomputed priority"
Cohesion: 0.40
Nodes (5): Requirement: Permission-Aware Edit Modal, Scenario: Edit button hidden when content not editable, Scenario: Edit button shown to member on everyone-editable skill, Scenario: Non-owner member sees content-only modal on everyone-editable skill, Scenario: Owner sees full modal

### Community 594 - "Requirement: Triage verdict against the codebase"
Cohesion: 0.40
Nodes (5): Requirement: userSkills Config Block, Scenario: Default disabled when block absent, Scenario: Explicit enable, Scenario: Invalid type rejected, Scenario: Toggling enabled hot-reloads via lifecycle

### Community 595 - "Requirement: @claude review trigger loop"
Cohesion: 0.40
Nodes (5): Requirement: Boot-Time Provisioning, Scenario: Acquire awaits initializing workers, Scenario: Already-provisioned at boot, Scenario: Provisioning is non-blocking, Scenario: Setup failure marks worker failed

### Community 596 - "Requirement: Layered incremental sync"
Cohesion: 0.40
Nodes (5): Requirement: Branch Switching with Dirty-Worker Quarantine, Scenario: Clean worker switches branch, Scenario: Dirty-ignore overrides, Scenario: Dirty worker is quarantined, Scenario: Same branch, no switch

### Community 597 - "Requirement: Two-layer instructions"
Cohesion: 0.40
Nodes (5): Requirement: Quarantine Lifecycle, Scenario: Admin clear discards changes, Scenario: Manual clear via file removal, Scenario: Quarantine excludes from acquire, Scenario: Quarantine notification

### Community 598 - "Requirement: AVAILABLE SKILL PACKS Catalog in the Prompt"
Cohesion: 0.40
Nodes (5): Requirement: Resume-from-Remote-Branch Acquire, Scenario: Cold PR branch is re-adopted intact, Scenario: Default fresh-branch acquire is unaffected, Scenario: Remote branch missing at acquire fails safely, Scenario: Warm branch resume is unchanged

### Community 599 - "Requirement: Thread Context Delta Tracking"
Cohesion: 0.40
Nodes (5): Requirement: Worker State Persistence, Scenario: Disk wins over state file at boot, Scenario: Orphan folder adoption, Scenario: Orphan state entry pruning, Scenario: State written on transitions

### Community 600 - "Requirement: Answer Delivery"
Cohesion: 0.50
Nodes (4): Requirement: Direct-to-Channel Delivery via post_top_level, Scenario: No duplicate messages when post_top_level is used correctly, Scenario: post_to still available for cross-channel broadcasts, Scenario: Rule's extra context directs post to channel

### Community 601 - "Requirement: Freeform Answers Format Value"
Cohesion: 0.50
Nodes (4): Requirement: Role Directory Structure, Scenario: Role directories in default configuration, Scenario: Role directories in user configuration, Scenario: Unrecognized role directory ignored

### Community 602 - "Requirement: Server-rolled choice metadata in get_ideas"
Cohesion: 0.50
Nodes (4): Requirement: Two-Tier Resolution Within Each Role Level, Scenario: Custom overrides default at same role level, Scenario: Full resolution order, Scenario: Interleaved resolution order

### Community 603 - "Requirement: Freeform Answer Format"
Cohesion: 0.50
Nodes (4): Requirement: Admin Tool — `add_channel`, Scenario: Add a new channel as bare string, Scenario: Add a new channel with promptSuggestion, Scenario: Add channel that's already present updates the promptSuggestion

### Community 604 - "Requirement: Freeform Answer Submission via Slack Modal"
Cohesion: 0.50
Nodes (4): Requirement: Admin Tool — `add_small_talk_topic` and `remove_small_talk_topic`, Scenario: Add a topic that's already present is a no-op, Scenario: Add a topic that's not present, Scenario: Remove an existing topic

### Community 605 - "Requirement: Freeform Re-Judging in Reprocess Mode"
Cohesion: 0.50
Nodes (4): Requirement: Admin Tool — `set_casual_talk_config`, Scenario: Tool accepts and persists useBuiltinFallbackTopics, Scenario: Tool rejects invalid config without persisting, Scenario: Tool replaces config and triggers soft restart

### Community 606 - "Requirement: Channel→game inference for reactive sessions"
Cohesion: 0.50
Nodes (4): Requirement: Admin Tool — `set_channel_prompt_suggestion`, Scenario: Clear a suggestion reverts to bare string, Scenario: Set a suggestion on a bare-string channel, Scenario: Tool errors when channel is not in the list

### Community 607 - "Requirement: Enabled flag"
Cohesion: 0.50
Nodes (4): Requirement: Admin Tool — `toggle_builtin_fallback_topics`, Scenario: Tool result string resolves through the plugin dictionary, Scenario: Turning built-ins off when currently on, Scenario: Turning built-ins on when currently on is a no-op

### Community 608 - "Requirement: list_games surfaces every registry axis"
Cohesion: 0.50
Nodes (4): Requirement: Cron Spec Assembly (Channelless), Scenario: Casual-talk run delivers via deliver_to, Scenario: Disabled config removes any prior spec, Scenario: Reconcile with enabled config creates one channelless spec

### Community 609 - "Requirement: Universal `game` argument on per-game tools"
Cohesion: 0.50
Nodes (4): Requirement: Change Request State Management, Scenario: Allow new changes when existing session is idle, Scenario: Prevent duplicate requests only during active execution, Scenario: Track active changes via unified session

### Community 610 - "Requirement: upsert_game accepts lockCron"
Cohesion: 0.50
Nodes (4): Requirement: ClackSdk Exposes Capability Flags, Scenario: capabilities.crons reflects cron.enabled = false, Scenario: capabilities.crons reflects cron.enabled = true, Scenario: capabilities is a plain object

### Community 611 - "Requirement: buildGameSpecs emits a lock spec when lockCron is set"
Cohesion: 0.50
Nodes (4): Requirement: ClackSdk Exposes Plugin Error Reporting, Scenario: Multiple errors accumulate, Scenario: Plugin continues after calling error, Scenario: Single error recorded

### Community 612 - "Requirement: buildGameSpecs emits a prep spec when prepCron is set"
Cohesion: 0.50
Nodes (4): Requirement: ClackSdk Exposes User Registry Accessor, Scenario: data(schema) is auto-scoped to the calling plugin, Scenario: get and list expose core identity, Scenario: Namespace data validated by the plugin's own schema

### Community 613 - "Requirement: Off-Days Propagation Through Game Specs"
Cohesion: 0.50
Nodes (4): Requirement: ClackSdk Posting Helpers Accept suppressUnfurls, Scenario: dmOwner with suppressUnfurls true, Scenario: dmOwner without suppressUnfurls, Scenario: Future posting helpers honor the same contract

### Community 614 - "Requirement: Trivia Plugin Reconciles Schedules From Config"
Cohesion: 0.50
Nodes (4): Requirement: Home Tab Plugin Display, Scenario: Both sections shown independently, Scenario: Clack plugins section hidden when none loaded, Scenario: Clack plugins shown when loaded

### Community 615 - "Requirement: post_questions Uses Shared Slack Posting Helper"
Cohesion: 0.50
Nodes (4): Requirement: Per-Plugin MCP Server Namespace, Scenario: Multiple plugins each get their own server, Scenario: Plugin name `clack` is reserved, Scenario: Plugin owns its own MCP server

### Community 616 - "Requirement: Posted Question Threads Engage Clarification Replies"
Cohesion: 0.50
Nodes (4): Requirement: Plugin SDK Single-Turn Claude Call, Scenario: Errors from the Anthropic API are propagated, Scenario: Missing credential surfaces a clear error, Scenario: Plugin invokes a single-turn Claude call

### Community 617 - "Requirement: reveal renders attribution context block for image media"
Cohesion: 0.50
Nodes (4): Requirement: Plugin Tool Mapping Supports Hidden Flag, Scenario: Hidden flag is optional, Scenario: Hidden tool still records a ToolCallRecorder entry, Scenario: Plugin registers a hidden tool

### Community 618 - "Requirement: `compute_answers` resolves and returns `finalRevealSummary`"
Cohesion: 0.50
Nodes (4): Requirement: PluginLoadResult Includes Errors, Scenario: Errors populated from sdk.error calls, Scenario: Successful plugin has empty errors, Scenario: Unhandled throw becomes synthetic result

### Community 619 - "Requirement: `compute_answers` resolves and returns `includeRevealInQuestions`"
Cohesion: 0.50
Nodes (4): Requirement: SDK engageThread Method, Scenario: Off level is a no-op, Scenario: Plugin engages a thread it posted into, Scenario: Plugins do not import core session modules

### Community 620 - "Requirement: Freeform Reveal Invokes Per-Answer Judge"
Cohesion: 0.50
Nodes (4): Requirement: Skill-Plugins Directory Rename, Scenario: All SDK plugin references updated, Scenario: Migration renames directory, Scenario: Migration skips if already renamed

### Community 621 - "Requirement: `processedAt` field on TriviaQuestion"
Cohesion: 0.50
Nodes (4): Requirement: addDeliveryReactions Helper Is Shared Across Outbound Surfaces, Scenario: a future change to reaction error handling lands in one place, Scenario: post_to delivery (auto + button) uses the shared helper, Scenario: submit_response delivery uses the shared helper

### Community 622 - "Requirement: Reprocess preserves manually-overridden verdicts"
Cohesion: 0.50
Nodes (4): Requirement: Centralized Block Handling Across Outbound Surfaces, Scenario: plugin SDK scheduled-message delivery uses the central module, Scenario: post_to handler uses the central module, Scenario: submit_response uses the central module

### Community 623 - "Requirement: Reveal steps are atomic and independently replayable"
Cohesion: 0.50
Nodes (4): Requirement: Continuation Action Types, Scenario: Choice action, Scenario: Followup action, Scenario: Multiple choices in one response

### Community 624 - "Requirement: Tool internally composes leaderboard and season-status logic"
Cohesion: 0.50
Nodes (4): Requirement: Duplicate Post_to Rejection When post_top_level Is Set, Scenario: post_to targeting a DIFFERENT channel is allowed, Scenario: post_to targeting the same channel WITH thread_ts is allowed, Scenario: post_to targeting the same channel without thread_ts is rejected

### Community 625 - "Requirement: Dense-rank medal assignment across leaderboard rows"
Cohesion: 0.50
Nodes (4): Requirement: Multi-Message Inside post_to, Scenario: post_to additional_messages are independent top-level posts, Scenario: post_to in any trigger context can carry followers, Scenario: post_to thread_replies thread under the cross-post

### Community 626 - "Requirement: Question-posting prompt instructs retry-with-appendToPreviousBatch"
Cohesion: 0.50
Nodes (4): Requirement: Multi-Message Top-Level Fields Gated To Scheduled Trigger, Scenario: allowMultiMessage is derived from session.triggerType, Scenario: DM / @mention / reaction / auto-respond / worker triggers hide both fields, Scenario: Scheduled trigger exposes both fields

### Community 627 - "Requirement: requiredTools per spec"
Cohesion: 0.50
Nodes (4): Requirement: Per-Message Payload Shape, Scenario: MessagePayload accepts blocks plus optional fields, Scenario: MessagePayload rejects primary-only fields, Scenario: MessagePayload requires non-empty blocks

### Community 628 - "Requirement: Reveal prompt branches on reveals.length"
Cohesion: 0.50
Nodes (4): Requirement: post_to.actions Validated Identically To Top-Level Actions, Scenario: button label inside post_to.actions exceeds the 40-char Slack visibility limit, Scenario: ref inside post_to.actions is checked against the intent store, Scenario: staged intent placed inside post_to.actions counts toward coverage

### Community 629 - "Requirement: Reveal prompt branches the summary on `finalRevealSummary`"
Cohesion: 0.50
Nodes (4): Requirement: post_to Snapshot Captures actions and reactions, Scenario: button-click delivery replays snapshot actions and reactions, Scenario: snapshot includes actions and reactions when present, Scenario: snapshot omits actions and reactions when absent

### Community 630 - "Requirement: Schedule Prompts Are Thin Dispatchers"
Cohesion: 0.50
Nodes (4): Requirement: Required Tools Supplied via Session Context, Scenario: Cron trigger populates required tools, Scenario: Non-cron triggers pass the field through unchanged, Scenario: Unknown tool name in requiredTools is diagnosable

### Community 631 - "Requirement: Six-Way Generation Matrix"
Cohesion: 0.50
Nodes (4): Requirement: Shared Message-Content Schema Across submit_response and post_to, Scenario: a future content field is added in one place, Scenario: post_to accepts blocks, actions, and reactions, Scenario: top-level submit_response continues to accept the same fields

### Community 632 - "Requirement: Trivia Plugin Self-Disables When Crons Are Off"
Cohesion: 0.50
Nodes (4): Requirement: Staged Intent Storage, Scenario: Intent resolved by submit_response, Scenario: Intent stored on action tool success, Scenario: Intents serialized to session

### Community 633 - "Requirement: Apply-to-current-season clears the override"
Cohesion: 0.50
Nodes (4): Requirement: PR Template Resolution, Scenario: Built-in default template, Scenario: Template from Clack data directory, Scenario: Template from repository

### Community 634 - "Requirement: process_reveal_answers resolves allTimeRow into showAllTimeRow"
Cohesion: 0.50
Nodes (4): Requirement: Session Context Continuation, Scenario: Delta context on resumed session, Scenario: Refinement includes previous context, Scenario: Update preserves conversation history

### Community 635 - "Requirement: SeasonEntry and SeasonFormatSlot carry promptMedium cascade fields"
Cohesion: 0.50
Nodes (4): Requirement: Startup Baseline Token Smoke Test, Scenario: Eager skill pack still contributes to baseline, Scenario: Lazy-tagged skill pack excluded from baseline, Scenario: Startup logs baseline token count per role

### Community 636 - "Requirement: upsert_season accepts promptMedium argument"
Cohesion: 0.50
Nodes (4): Requirement: create_scheduled_message Requires a Name, Scenario: Name is persisted on the new job, Scenario: Name is sanitized to 80 characters or fewer, Scenario: Tool rejects calls without a name

### Community 637 - "Requirement: list_user_skills Tool"
Cohesion: 0.50
Nodes (4): Requirement: Synchronous In-Memory Job Lookup Accessor, Scenario: Cached job returned synchronously, Scenario: Cold cache returns null without throwing, Scenario: Missing id returns null

### Community 638 - "Requirement: propose_skill_create Tool"
Cohesion: 0.50
Nodes (4): Requirement: Create Skill Modal, Scenario: Invalid slug surfaces inline error, Scenario: Slug collision surfaces inline error, Scenario: Successful create from Home Tab

### Community 639 - "Requirement: propose_skill_restore Tool"
Cohesion: 0.50
Nodes (4): Requirement: Edit Skill Modal, Scenario: Name field is read-only, Scenario: Owner edits description and body, Scenario: Submission re-checks permission

### Community 640 - "Requirement: Setting editableByAnyone from the Home Tab"
Cohesion: 0.50
Nodes (4): Requirement: Migration Status Banner, Scenario: No banner when migrations are healthy, Scenario: Show error banner on failed migration, Scenario: Show error banner to admin with action guidance

### Community 641 - "Requirement: Pool Folders Exempt from Stale-Worktree Cleanup"
Cohesion: 0.50
Nodes (4): Requirement: User Selection Modals, Scenario: Handle modal submission, Scenario: Open add admin modal, Scenario: Open add dev modal

### Community 642 - "Requirement: Pool Visibility in Home Tab"
Cohesion: 0.50
Nodes (4): Requirement: Coldest-first ordering for the concierge rotation, Scenario: Coldest ordering surfaces least-recently-attended first, Scenario: Priority ordering is the default, Scenario: Re-verification rotates a unit to the back

### Community 643 - "Requirement: Worker Pool Configuration"
Cohesion: 0.50
Nodes (4): Requirement: Concierge parks stale units via the existing sink, Scenario: A unit with fresh input is not parked, Scenario: Overdue zombie is parked out of the work window, Scenario: Parked unit resurfaces on fresh activity

### Community 644 - "Requirement: Worker-pool state loading is schema-driven"
Cohesion: 0.50
Nodes (4): Requirement: Self-describing work-unit ledger, Scenario: Completed unit drops out of selection, Scenario: Malformed slice reads as default, Scenario: Work-state shape in the memory namespace

### Community 645 - "pruneArchive.ts"
Cohesion: 0.50
Nodes (4): Requirement: Sync-recomputed priority, Scenario: Blocked unit sinks, Scenario: Clack reprioritization overrides the computed score, Scenario: Fresh reply resurfaces a blocked unit

### Community 646 - "ClackSdkUsers"
Cohesion: 0.50
Nodes (4): Requirement: Triage verdict against the codebase, Scenario: Actionable advances to implementation, Scenario: Already-done comments with proof, Scenario: Needs-info comments and waits

### Community 647 - "Requirement: Baseline Resolution Unchanged"
Cohesion: 0.50
Nodes (4): Requirement: @claude review trigger loop, Scenario: External bot absent is harmless, Scenario: No re-trigger without new commits, Scenario: Trigger review then defer

### Community 648 - "Requirement: Topic File Discovery in Home Tab"
Cohesion: 0.50
Nodes (4): Requirement: Layered incremental sync, Scenario: External discovery is incremental, Scenario: Memory maintenance is not rotated, Scenario: Quick-fetch every run

### Community 649 - "Requirement: Admin Tool — `remove_channel`"
Cohesion: 0.50
Nodes (4): Requirement: Two-layer instructions, Scenario: Behavior instructions are shipped and topic-scoped, Scenario: Editing fetch instructions cannot change behavior, Scenario: Fetch instructions are admin-editable and hot-reload

### Community 650 - "Requirement: Admin Tool — `set_expected_rate`"
Cohesion: 0.50
Nodes (4): Requirement: AVAILABLE SKILL PACKS Catalog in the Prompt, Scenario: Catalog alphabetized, Scenario: Catalog omitted when no lazy packs, Scenario: Catalog rendered when a lazy pack exists

### Community 651 - "Requirement: Admin Tool — `set_work_hours`"
Cohesion: 0.50
Nodes (4): Requirement: Thread Context Delta Tracking, Scenario: Delta thread context on resume, Scenario: Full thread context fallback, Scenario: Last seen timestamp updated after query

### Community 652 - "Requirement: Admin Tools — `enable` and `disable`"
Cohesion: 0.50
Nodes (4): Requirement: Answer Delivery, Scenario: Answer delivered on stop, Scenario: Auto actions filtered from buttons, Scenario: No incremental text streaming

### Community 653 - "Requirement: Built-in Fallback Topics Constant"
Cohesion: 0.50
Nodes (4): Requirement: Freeform Answers Format Value, Scenario: Freeform weight enabled at config tier, Scenario: Freeform weight set per slot, Scenario: Freeform weight zero at every tier

### Community 654 - "Requirement: Casual Posts Engage Their Thread With High Attention"
Cohesion: 0.50
Nodes (4): Requirement: Server-rolled choice metadata in get_ideas, Scenario: Boolean path omits choice fields, Scenario: Choice path returns rolled count and index, Scenario: correctIndex distribution is uniform across runs

### Community 655 - "Requirement: Casual Talk Internal Jitter Constant"
Cohesion: 0.50
Nodes (4): Requirement: Freeform Answer Format, Scenario: Cross-format field rejection, Scenario: Freeform record shape, Scenario: Freeform requires expectedAnswer

### Community 656 - "Requirement: i18n for Direct-to-Slack Strings"
Cohesion: 0.50
Nodes (4): Requirement: Freeform Answer Submission via Slack Modal, Scenario: Editing an in-flight answer, Scenario: First-time answer, Scenario: Locked modal after reveal

### Community 657 - "Requirement: Persona Topic Instruction (Admin-Overridable)"
Cohesion: 0.50
Nodes (4): Requirement: Freeform Re-Judging in Reprocess Mode, Scenario: A re-judge whose judge call exhausts retries keeps the prior verdict, Scenario: Default reveal does not reset already-judged freeform rows, Scenario: Reprocess re-judges a previously-judged freeform answer in place

### Community 658 - "Requirement: Plugin Registration and Capability Gating"
Cohesion: 0.50
Nodes (4): Requirement: Channel→game inference for reactive sessions, Scenario: Channel matches a configured game, Scenario: Channel matches a disabled game, Scenario: Unconfigured channel returns null

### Community 659 - "Requirement: Built-in Plugin Registry"
Cohesion: 0.50
Nodes (4): Requirement: Enabled flag, Scenario: Disabled game allows reads, Scenario: Disabled game omitted from cron reconcile, Scenario: Disabled game refuses writes

### Community 660 - "Requirement: ClackSdk Exposes Cron Reconciliation"
Cohesion: 0.50
Nodes (4): Requirement: list_games surfaces every registry axis, Scenario: New axes surface without editing list_games, Scenario: promptMedium surfaces at the game tier, Scenario: promptMedium surfaces at the workspace tier

### Community 661 - "Requirement: ClackSdk Exposes File Watching"
Cohesion: 0.50
Nodes (4): Requirement: Universal `game` argument on per-game tools, Scenario: Missing game argument rejected by Zod, Scenario: Unknown game rejected, Scenario: Unknown name in find_previous_questions games array rejected

### Community 662 - "Requirement: ClackSdk Exposes Implicit Default MCP Server"
Cohesion: 0.50
Nodes (4): Requirement: upsert_game accepts lockCron, Scenario: upsert_game adds lockCron to an existing game, Scenario: upsert_game clears lockCron via sentinel, Scenario: upsert_game rejects invalid lockCron

### Community 663 - "Requirement: Transparent Tool Call Recording for Plugin Tools"
Cohesion: 0.50
Nodes (4): Requirement: buildGameSpecs emits a lock spec when lockCron is set, Scenario: Lock spec emitted when lockCron is set, Scenario: No lock spec when lockCron is absent, Scenario: skipDates propagate to the lock spec

### Community 664 - "Requirement: Multi-Repository Awareness"
Cohesion: 0.50
Nodes (4): Requirement: buildGameSpecs emits a prep spec when prepCron is set, Scenario: skipDates propagate to all emitted specs, Scenario: Three specs emitted when prepCron is set, Scenario: Two specs emitted when prepCron is absent

### Community 665 - "Requirement: Non-Technical Response Style"
Cohesion: 0.50
Nodes (4): Requirement: Off-Days Propagation Through Game Specs, Scenario: Absent offDays yields specs without skipDates, Scenario: offDays propagates into every spec, Scenario: Updating offDays re-reconciles in place

### Community 666 - "Requirement: `runClaude` MCP Server Support"
Cohesion: 0.50
Nodes (4): Requirement: Trivia Plugin Reconciles Schedules From Config, Scenario: Empty games triggers reconcile with no specs, Scenario: Multi-game produces 2N specs, Scenario: One game produces two specs

### Community 667 - "docker-deployment Specification"
Cohesion: 0.50
Nodes (4): Requirement: post_questions Uses Shared Slack Posting Helper, Scenario: notificationText is exported and reused, Scenario: Reactions reuse the existing shared helper, Scenario: Shared helper is the single source for postMessage + getPermalink pairs

### Community 668 - "Requirement: Artifact Registry Repository Provisioning"
Cohesion: 0.50
Nodes (4): Requirement: Posted Question Threads Engage Clarification Replies, Scenario: Answered question thread stops helping, Scenario: Pending-question clarification is answered, Scenario: Posting a question seeds an engaged thread

### Community 669 - "Requirement: Docker Ignore"
Cohesion: 0.50
Nodes (4): Requirement: reveal renders attribution context block for image media, Scenario: Multi-question reveal with multiple image-medium questions, Scenario: Reveal with attribution and license, Scenario: Reveal without attribution skips the block

### Community 670 - "Requirement: GitHub API Access via Octokit"
Cohesion: 0.50
Nodes (4): Requirement: `compute_answers` resolves and returns `finalRevealSummary`, Scenario: Default surfaces when unset, Scenario: Payload carries resolved value, Scenario: Resolved fresh, not stamped

### Community 671 - "Requirement: GitHub MCP Server Binary"
Cohesion: 0.50
Nodes (4): Requirement: `compute_answers` resolves and returns `includeRevealInQuestions`, Scenario: Default surfaces when unset, Scenario: Payload carries resolved value, Scenario: Resolved fresh, not stamped

### Community 672 - "Requirement: Edit Rule Modal"
Cohesion: 0.50
Nodes (4): Requirement: Freeform Reveal Invokes Per-Answer Judge, Scenario: Freeform question with no submissions, Scenario: No freeform in batch — no judge call, Scenario: One judge call per pending submission

### Community 673 - "Requirement: Home Tab Event Handling"
Cohesion: 0.50
Nodes (4): Requirement: `processedAt` field on TriviaQuestion, Scenario: processedAt is overwritten on reprocess, Scenario: processedAt is stamped on default-mode processing, Scenario: processedAt makes a question ineligible for default-mode selection

### Community 674 - "Requirement: Full-auto approval, no human gate"
Cohesion: 0.50
Nodes (4): Requirement: Reprocess preserves manually-overridden verdicts, Scenario: Non-overridden rows still re-derive, Scenario: Reprocess skips re-deriving an overridden boolean row, Scenario: Reprocess skips re-judging an overridden freeform row

### Community 675 - "Requirement: Growing self-describing references"
Cohesion: 0.50
Nodes (4): Requirement: Reveal steps are atomic and independently replayable, Scenario: Re-disclosure makes no new judge call, Scenario: Re-running compute after a judge fix re-derives from retained raw text, Scenario: Repeated compute does not double-count

### Community 676 - "Requirement: Per-reference comment idempotency"
Cohesion: 0.50
Nodes (4): Requirement: Tool internally composes leaderboard and season-status logic, Scenario: Leaderboard matches retrieve_scores for the same game, Scenario: seasonStatus omitted when seasons disabled, Scenario: seasonStatus populated when seasons enabled

### Community 677 - "Requirement: Work-task authority and pre-act refresh"
Cohesion: 0.50
Nodes (4): Requirement: Dense-rank medal assignment across leaderboard rows, Scenario: Fourth distinct value wears the ribbon, Scenario: Tie at the top shares gold, Scenario: Zero and em-dash never medal

### Community 678 - "Requirement: Idle is the default over manufactured work"
Cohesion: 0.50
Nodes (4): Requirement: Question-posting prompt instructs retry-with-appendToPreviousBatch, Scenario: Prompt covers both single-question and multi-slot retry paths, Scenario: Prompt does NOT instruct Claude to thread a raw batchId string, Scenario: Prompt names appendToPreviousBatch in the retry clause

### Community 679 - "Requirement: Review requires fresh commits"
Cohesion: 0.50
Nodes (4): Requirement: requiredTools per spec, Scenario: Flexible question spec omits post_questions, Scenario: Non-flexible question spec requires get_ideas and post_questions, Scenario: Reveal spec requires only compute_answers

### Community 680 - "Requirement: Lazy-Tagged Plugins Excluded From --plugin-dir"
Cohesion: 0.50
Nodes (4): Requirement: Reveal prompt branches on reveals.length, Scenario: Empty-reveals branch posts nothing, Scenario: Single-question branch describes the new voter buckets, Scenario: Single-question layout renders This Round row when perPlayer non-empty

### Community 681 - "Requirement: Session-Level Load Tracking"
Cohesion: 0.50
Nodes (4): Requirement: Reveal prompt branches the summary on `finalRevealSummary`, Scenario: in-thread instructs both the pointer and the thread reply, Scenario: Leaderboard is top-level in every branch, Scenario: Prompt describes all three summary branches

### Community 682 - "session-management Specification"
Cohesion: 0.50
Nodes (4): Requirement: Schedule Prompts Are Thin Dispatchers, Scenario: buildGameSpecs substitutes the game name into both prompts, Scenario: Disabled games are excluded from buildGameSpecs output, Scenario: Per-game prompts are isolated from each other

### Community 683 - "Requirement: Session Creation"
Cohesion: 0.50
Nodes (4): Requirement: Trivia Plugin Self-Disables When Crons Are Off, Scenario: Plugin status visible to admin, Scenario: Trivia init bows out when crons disabled, Scenario: Trivia loads normally when crons enabled

### Community 684 - "Requirement: Session Identification"
Cohesion: 0.50
Nodes (4): Requirement: Apply-to-current-season clears the override, Scenario: Confirmed apply clears the season override, Scenario: Declining leaves the season override intact, Scenario: Multiple shadowed fields clear together

### Community 685 - "Requirement: Session Restoration"
Cohesion: 0.50
Nodes (4): Requirement: process_reveal_answers resolves allTimeRow into showAllTimeRow, Scenario: end-of-season-only hides on normal day, Scenario: end-of-season-only resolves on last fire, Scenario: never always hides

### Community 686 - "Requirement: Session Storage Directory"
Cohesion: 0.50
Nodes (4): Requirement: SeasonEntry and SeasonFormatSlot carry promptMedium cascade fields, Scenario: Mid-season promptMedium mutation takes effect on next fire, Scenario: Season-level promptMedium overrides config, Scenario: Slot-level promptMedium overrides season

### Community 687 - "trivia-freeform-questions"
Cohesion: 0.50
Nodes (4): Requirement: upsert_season accepts promptMedium argument, Scenario: Invalid promptMedium rejected, Scenario: Upsert season with image-only promptMedium, Scenario: Upsert season with per-slot promptMedium

### Community 688 - "Requirement: Freeform Generation Flow in Scheduled Prompts"
Cohesion: 0.50
Nodes (4): Requirement: list_user_skills Tool, Scenario: Empty pack, Scenario: Filter by owner, Scenario: List all enabled skills

### Community 689 - "Requirement: Freeform Question Posting Behavior"
Cohesion: 0.50
Nodes (4): Requirement: propose_skill_create Tool, Scenario: Slug collision rejected, Scenario: Successful staging, Scenario: Tool unavailable when feature disabled

### Community 690 - "Requirement: Resilient Verdict Resolution — Re-Ask and Never Score a Dropped Verdict Wrong"
Cohesion: 0.50
Nodes (4): Requirement: propose_skill_restore Tool, Scenario: Non-manager rejected even when editableByAnyone, Scenario: Owner can stage restore on their disabled skill, Scenario: Restore on enabled skill rejected

### Community 691 - "trivia-games Specification"
Cohesion: 0.50
Nodes (4): Requirement: Setting editableByAnyone from the Home Tab, Scenario: Member content edit does not alter the flag, Scenario: Owner disables everyone-editing via checkbox, Scenario: Owner enables everyone-editing via checkbox

### Community 692 - "Requirement: list_games surfaces prepCron"
Cohesion: 0.50
Nodes (4): Requirement: Pool Folders Exempt from Stale-Worktree Cleanup, Scenario: Disposable mode cleanup unchanged, Scenario: Stale sweep skips pool folders in reusable mode, Scenario: Stale sweep still reaps non-pool folders in reusable mode

### Community 693 - "Requirement: upsert_game accepts prepCron"
Cohesion: 0.50
Nodes (4): Requirement: Pool Visibility in Home Tab, Scenario: Per-repo worker section, Scenario: Quarantine action button, Scenario: Queued requests visible

### Community 694 - "trivia-question-posting Specification"
Cohesion: 0.50
Nodes (4): Requirement: Worker Pool Configuration, Scenario: Default disposable model, Scenario: Default values, Scenario: Enable reusable pool

### Community 695 - "Requirement: revealResponses cascade accepts `"just-winners"`"
Cohesion: 0.50
Nodes (4): Requirement: Worker-pool state loading is schema-driven, Scenario: Corrupt state degrades, does not throw, Scenario: Malformed date strings behave exactly as today, Scenario: Valid state round-trips with Date coercion

### Community 697 - "Requirement: Freeform Reveal Payload Carries answerText"
Cohesion: 0.67
Nodes (3): Requirement: Baseline Resolution Unchanged, Scenario: Empty activeTopics set behaves like no argument, Scenario: No activeTopics argument behaves like today

### Community 698 - "Requirement: Answer-reveal prompt renders the `"just-winners"` variant"
Cohesion: 0.67
Nodes (3): Requirement: Topic File Discovery in Home Tab, Scenario: Home Tab listing includes topic files, Scenario: MCP listing exposes topic files under semantic fields

### Community 699 - "Requirement: Answer-reveal prompt settles or invalidates predictions before scoring"
Cohesion: 0.67
Nodes (3): Requirement: Admin Tool — `remove_channel`, Scenario: Remove a channel not in the list, Scenario: Remove an existing channel

### Community 700 - "Requirement: buildGameSpecs does not peek into seasons state"
Cohesion: 0.67
Nodes (3): Requirement: Admin Tool — `set_work_hours`, Scenario: Invalid work hours rejected, Scenario: Update work hours

### Community 701 - "Requirement: Empty correct bucket renders expanded answer detail"
Cohesion: 0.67
Nodes (3): Requirement: Admin Tools — `enable` and `disable`, Scenario: Disable an enabled plugin, Scenario: Enable a previously-disabled plugin

### Community 702 - "Requirement: Reveal leaderboard labels are localized via the trivia dictionary"
Cohesion: 0.67
Nodes (3): Requirement: Casual Posts Engage Their Thread With High Attention, Scenario: A human reply to a casual thread is answered, Scenario: Casual opener engages its thread

### Community 703 - "Requirement: User-skill metadata load is schema-driven"
Cohesion: 0.67
Nodes (3): Requirement: Cron-Expression Builder, Scenario: Build expression for 0-23 every day, Scenario: Build expression for 9-16 weekdays

### Community 704 - "worker-pool Specification"
Cohesion: 0.67
Nodes (3): Requirement: i18n for Direct-to-Slack Strings, Scenario: Missing translation key is a programming error, Scenario: Plugin registers an EN dictionary on init

### Community 705 - "Requirement: Quarantine sidecar load is schema-driven"
Cohesion: 0.67
Nodes (3): Requirement: Persona Topic Instruction (Admin-Overridable), Scenario: Admin override replaces the persona content, Scenario: Persona is registered at plugin load

### Community 706 - "Requirement: Worker Identity and Folder Layout"
Cohesion: 0.67
Nodes (3): Requirement: Plugin Registration and Capability Gating, Scenario: Plugin loads when crons are enabled, Scenario: Plugin refuses to load when crons are disabled

### Community 707 - "monday-oauth.mjs"
Cohesion: 0.67
Nodes (3): Requirement: ClackSdk Exposes Cron Reconciliation, Scenario: Calling without arguments validates loudly, Scenario: SDK method is present on every plugin's SDK instance

### Community 708 - "tsconfig.build.json"
Cohesion: 0.67
Nodes (3): Requirement: ClackSdk Exposes File Watching, Scenario: SDK method is present on every plugin's SDK instance, Scenario: Watcher is tracked for teardown

### Community 709 - "rebuild-docker-and-launch.sh"
Cohesion: 0.67
Nodes (3): Requirement: ClackSdk Exposes Implicit Default MCP Server, Scenario: Default server exists on every plugin's SDK instance, Scenario: Shorthand registerTool routes through the default server

### Community 710 - "docker-setup.sh"
Cohesion: 0.67
Nodes (3): Requirement: Config-Driven Activation, Scenario: Empty or missing plugins field, Scenario: Plugins field in config

### Community 711 - "gce-deploy.sh"
Cohesion: 0.67
Nodes (3): Requirement: Transparent Tool Call Recording for Plugin Tools, Scenario: Handler errors are recorded and rethrown, Scenario: Plugin tool handler wrapped at assembly time

### Community 712 - "gce-fetch-session.sh"
Cohesion: 0.67
Nodes (3): Requirement: Multi-Repository Awareness, Scenario: Claude selects relevant repository, Scenario: Repository list in system prompt

### Community 713 - "gce-push-config.sh"
Cohesion: 0.67
Nodes (3): Requirement: Non-Technical Response Style, Scenario: System prompt enforces non-technical style, Scenario: Technical details available only on explicit request

### Community 714 - "gce-sync-from-vm.sh"
Cohesion: 0.67
Nodes (3): Requirement: `runClaude` MCP Server Support, Scenario: MCP servers optional, Scenario: MCP servers passed to Agent SDK

### Community 716 - "gce-update-image.sh"
Cohesion: 0.67
Nodes (3): Requirement: Artifact Registry Repository Provisioning, Scenario: Region matches the VM zone, Scenario: Repository created once in the deploy region

### Community 717 - "Action Handler Registration"
Cohesion: 0.67
Nodes (3): Requirement: Docker Ignore, Scenario: Exclude development files, Scenario: Exclude sensitive data

### Community 718 - "active-runs-registry Specification"
Cohesion: 0.67
Nodes (3): Requirement: GitHub API Access via Octokit, Scenario: Octokit client initialization, Scenario: PR operations via Octokit

### Community 719 - "AGENTS.md"
Cohesion: 0.67
Nodes (3): Requirement: GitHub MCP Server Binary, Scenario: Binary installed during Docker build, Scenario: Binary works on Alpine

### Community 720 - "Answer Formats"
Cohesion: 0.67
Nodes (3): Requirement: Edit Rule Modal, Scenario: Open edit rule modal, Scenario: Submit edit rule modal

### Community 721 - "answerLocked Flag"
Cohesion: 0.67
Nodes (3): Requirement: Home Tab Event Handling, Scenario: Register home tab handler, Scenario: Update home view on open

### Community 722 - "answersFormat Axis"
Cohesion: 0.67
Nodes (3): Requirement: Home Tab modal payloads are schema-driven, Scenario: Config-file modal metadata is validated, Scenario: User-skill modal reads degrade gracefully

### Community 723 - "Asana Personal Access Token"
Cohesion: 0.67
Nodes (3): Requirement: Role Badge Display, Scenario: Hide role for regular members, Scenario: Show role for admin/dev/owner

### Community 724 - "Attention Level Engagement"
Cohesion: 0.67
Nodes (3): Requirement: Full-auto approval, no human gate, Scenario: Candidate becomes eligible by criteria, Scenario: Ineligible candidate is not worked

### Community 725 - "Auto-Execute Actions"
Cohesion: 0.67
Nodes (3): Requirement: Growing self-describing references, Scenario: Comment destination is contextual, Scenario: Reference appended when a PR is opened

### Community 726 - "Auto-Respond Trigger Mode"
Cohesion: 0.67
Nodes (3): Requirement: Per-reference comment idempotency, Scenario: New PR comments processed once, Scenario: No duplicate needs-info comment

### Community 727 - "Block Kit Rendering"
Cohesion: 0.67
Nodes (3): Requirement: Work-task authority and pre-act refresh, Scenario: Sync does not clobber the in-flight unit, Scenario: Work re-reads before acting

### Community 728 - "Blocking Migrations (Boot-Time)"
Cohesion: 0.67
Nodes (3): Requirement: Idle is the default over manufactured work, Scenario: Review of an unchanged PR is not manufactured work, Scenario: Stale ladder ends the fire

### Community 729 - "Git Branch Switching"
Cohesion: 0.67
Nodes (3): Requirement: Review requires fresh commits, Scenario: Already-reviewed head yields no review work, Scenario: New commits make review productive

### Community 730 - "Brave Image Search Plugin"
Cohesion: 0.67
Nodes (3): Requirement: Lazy-Tagged Plugins Excluded From --plugin-dir, Scenario: Lazy plugin omitted from SDK plugin set, Scenario: Non-lazy plugin still included

### Community 731 - "cancel_worker_run MCP Tool"
Cohesion: 0.67
Nodes (3): Requirement: Session-Level Load Tracking, Scenario: Load history survives alongside attachedIntegrations, Scenario: Persisted across session persistence cycle

### Community 733 - "Cascade Axes System"
Cohesion: 0.67
Nodes (3): Requirement: Session Creation, Scenario: New session on trigger, Scenario: Session ID format

### Community 734 - "Trivia Cascade System (Slot/Season/Game/Workspace)"
Cohesion: 0.67
Nodes (3): Requirement: Session Identification, Scenario: Different user creates new session, Scenario: Same message, same user continues session

### Community 735 - "Casual Talk Plugin"
Cohesion: 0.67
Nodes (3): Requirement: Session Restoration, Scenario: Lazy session restoration, Scenario: Session info reconstruction from sessionId

### Community 736 - "Change Workflow"
Cohesion: 0.67
Nodes (3): Requirement: Session Storage Directory, Scenario: Session directory contents, Scenario: Sessions directory creation

### Community 738 - "Clack (Claude + Slack Bot)"
Cohesion: 0.67
Nodes (3): Requirement: Freeform Generation Flow in Scheduled Prompts, Scenario: Fact-freeform generation, Scenario: Topical-freeform generation

### Community 739 - "Clack - Slack Bot"
Cohesion: 0.67
Nodes (3): Requirement: Pending Free-Form Answer Storage Semantics, Scenario: Boolean answer still writes correct synchronously, Scenario: Pending row excluded from leaderboard

### Community 740 - "Claude Code Authentication"
Cohesion: 0.67
Nodes (3): Requirement: Resilient Verdict Resolution — Re-Ask and Never Score a Dropped Verdict Wrong, Scenario: Exhausted retries leave the row pending, not wrong, Scenario: Re-ask on a malformed verdict, then succeed

### Community 741 - "Claude Code Agent SDK"
Cohesion: 0.67
Nodes (3): trivia-games Specification, Purpose, trivia-games Specification

### Community 742 - "apply.md"
Cohesion: 0.67
Nodes (3): Requirement: list_games surfaces prepCron, Scenario: list_games omits prepCron when unset, Scenario: prepCron appears in list_games output

### Community 743 - "archive.md"
Cohesion: 0.67
Nodes (3): Requirement: upsert_game accepts prepCron, Scenario: upsert_game adds prepCron to an existing game, Scenario: upsert_game rejects invalid prepCron

### Community 745 - "propose.md"
Cohesion: 0.67
Nodes (3): Requirement: revealResponses cascade accepts `"just-winners"`, Scenario: just-winners slot override wins the cascade, Scenario: just-winners workspace default is stamped

### Community 746 - "sync.md"
Cohesion: 0.67
Nodes (3): Requirement: Freeform Judge Prompt Multi-Guess Rule, Scenario: Multi-guess marked incorrect, Scenario: Qualifier-form accepted

### Community 747 - "verify.md"
Cohesion: 0.67
Nodes (3): Requirement: Freeform Reveal Payload Carries answerText, Scenario: Boolean reveal entry unchanged, Scenario: Freeform voter entries carry answerText

### Community 749 - "SKILL.md"
Cohesion: 0.67
Nodes (3): Requirement: Answer-reveal prompt renders the `"just-winners"` variant, Scenario: Nobody got it right, Scenario: Winners named, missers counted

### Community 750 - "SKILL.md"
Cohesion: 0.67
Nodes (3): Requirement: Answer-reveal prompt settles or invalidates predictions before scoring, Scenario: result found → answer, Scenario: result unavailable → invalidate

### Community 751 - "SKILL.md"
Cohesion: 0.67
Nodes (3): Requirement: buildGameSpecs does not peek into seasons state, Scenario: buildGameSpecs output is independent of seasons.json content, Scenario: Format mutation does not require cron reconcile

### Community 752 - "SKILL.md"
Cohesion: 0.67
Nodes (3): Requirement: Emoji selection non-spoiler gate, Scenario: Gate forbids answer-revealing emojis, Scenario: Gate is defined once and referenced by every path

### Community 753 - "SKILL.md"
Cohesion: 0.67
Nodes (3): Requirement: Reveal leaderboard labels are localized via the trivia dictionary, Scenario: Built reveal prompt carries localized labels in a French workspace, Scenario: English workspace prompt and output are byte-stable

### Community 754 - "SKILL.md"
Cohesion: 0.67
Nodes (3): Requirement: User-skill metadata load is schema-driven, Scenario: Corrupt meta degrades to null, Scenario: Slug/description validation is unchanged

### Community 756 - "Commons Image Search Plugin"
Cohesion: 0.67
Nodes (3): Requirement: Quarantine sidecar load is schema-driven, Scenario: A valid sidecar round-trips unchanged, Scenario: Malformed sidecar yields null, not a crash

### Community 757 - "cascading configuration resolver"
Cohesion: 0.67
Nodes (3): Requirement: Worker Identity and Folder Layout, Scenario: Folder is preserved on release, Scenario: Worker folder naming

## Knowledge Gaps
- **5637 isolated node(s):** `$schema`, `correctness`, `plugins`, `no-unused-vars`, `no-console` (+5632 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **273 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Claude Agent SDK` connect `trivia plugin` to `src/tools: logger.ts`, `Requirement: Declarative Reconcile API On ClackSdk`, `CLAUDE.md: Clack (Claude + Slack Bot)`, `src/slack: t()`, `idler plugin`, `src/claude: main()`, `cronJobs.ts`, `Requirements`, `misc: Zod schema validation`, `src/slack: submitResponse.ts`, `userSkills: userSkills.ts`, `src/slack: userSkillsHomeActions.ts`, `scripts/migration-tests: run.ts`, `spec: instruction-system`, `src/streaming: SlackStreamer`, `src/claude: SkillsManager`, `src/workers: WorkerQueue`, `src/tools: proposeConfigUpdate.testHelpers.ts`, `src/tools: configFieldSchemas.ts`, `docs/setup-mcp-servers.md: MCP Server Setup and `, `spec: user-roles`, `spec: file-upload`, `spec: config-update-via-chat`, `spec: manifest-generation`, `spec: auto-respond`, `spec: slack-classic-dm`, `spec: find-emoji-tool`, `spec: git-log-tools`, `spec: lazy-skill-loading`, `spec: manifest-generation`, `spec: tool-label-config`, `Requirement: remember and recall query tools`, `blockSchema.ts`, `Requirements`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `logger` connect `spec: tool-label-config` to `Requirement: Stop Reaction Trigger`, `src/tools: logger.ts`, `trivia plugin`, `src/slack: handlerResponse.ts`, `src/slack: t()`, `src/workers: errorMessage()`, `CLAUDE.md: Clack (Claude + Slack Bot)`, `src/claude: main()`, `src/streaming: lifecycle.ts`, `sessions: sessions.ts`, `testHelpers.ts`, `trivia plugin`, `src/migrations: types.ts`, `userSkills: userSkills.ts`, `scripts/migration-tests: run.ts`, `misc: function`, `gemini-image plugin`, `Requirement: create_scheduled_message Tool`, `spec: trivia-games`, `src/workers: WorkerQueue`, `src/tools: envFile.ts`, `src/tools: proposeConfigUpdate.testHelpers.ts`, `src/tools: configFieldSchemas.ts`, `spec: streaming-responses`, `spec: trivia-question-contexts`, `docs/setup-mcp-servers.md: MCP Server Setup and `, `spec: user-roles`, `Requirement: Skills Section in Home Tab`, `spec: file-upload`, `spec: slack-file-attachments`, `spec: trivia-cheating-detection`, `spec: find-emoji-tool`, `spec: config-update-via-chat`, `spec: manifest-generation`, `spec: auto-respond`, `scripts/monday-oauth.mjs: monday-oauth.mjs`, `Requirement: Slack Action Handler for Skill Intents`, `spec: auto-respond-pre-analysis`, `spec: find-user-tool`, `spec: git-log-tools`, `spec: session-transcript-tool`, `spec: skip-response`, `spec: instruction-variables`, `CLAUDE.md: Session Persistence`, `Requirement: tellMeMore field on TriviaGame and workspace`, `spec: config-update-via-chat`, `spec: trivia-choice-questions`, `spec: repository-management`, `spec: error-reporting`, `Requirement: Schedule a Message`, `Requirement: ensure_pr Tool`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `ClaudeRunHandle` connect `sessions: sessions.ts` to `src/slack: t()`, `src/claude: main()`, `spec: tool-label-config`, `Requirement: tellMeMore field on TriviaGame and workspace`, `spec: trivia-games`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `$schema`, `correctness`, `plugins` to the rest of the system?**
  _5637 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `src/tools: logger.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.041521252796420584 - nodes in this community are weakly interconnected._
- **Should `trivia plugin` be split into smaller, more focused modules?**
  _Cohesion score 0.04190096136404861 - nodes in this community are weakly interconnected._
- **Should `CLAUDE.md: Clack (Claude + Slack Bot)` be split into smaller, more focused modules?**
  _Cohesion score 0.04078947368421053 - nodes in this community are weakly interconnected._