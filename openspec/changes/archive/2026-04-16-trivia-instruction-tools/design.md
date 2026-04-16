## Context

The Trivia plugin ships scheduled behavior (morning question post, afternoon answer reveal) via two cron jobs whose prompts are stored inline in `data/state/cron-jobs.json`. Those prompts are each 40-80 lines, contain the game-show persona, step-by-step flow, formatting rules, and voter categorization logic. Because the authoritative behavior lives in mutable JSON outside the plugin package, every behavior tweak is an operational edit rather than a code change.

The existing plugin also registers `TRIVIA_INSTRUCTIONS` via `sdk.addInstruction("user", ...)` — ~40 lines that load into every session's system prompt, overlapping substantially with the cron prompts. And `sdk.requireToolsForScheduled(["submit_answers"])` (introduced yesterday in `archive/2026-04-15-enforce-required-tools`) enforces plugin-wide required tools that, in practice, only match one of the two schedules.

Beyond refactoring, the plugin has no mechanism for recording cheating: users who vote after the reveal, change their vote, or try to manipulate the game have no durable trail.

## Goals / Non-Goals

**Goals:**
- Move scheduled-run prompts into plugin code, fetched on demand via tools.
- Make the plugin self-bootstrapping: an admin asks Clack to set up trivia, Clack follows a recipe returned by a tool and creates the two cron jobs.
- Record cheat attempts durably (per-user counter + detailed log) with owner DM notification.
- Suppress the cheat tool's execution from Slack task cards (the user being recorded should not see it happen).
- Remove the SDK's `requireToolsForScheduled` method (single-caller, misshapen abstraction).

**Non-Goals:**
- Automatic migration of the two existing live trivia cron jobs (manual re-run of the setup tool, when the admin is ready).
- A generic plugin messaging primitive (no `sdk.dmUser` / `sdk.notifyOwner` — the `trivia-check` instruction drives owner DMs via the standard `submit_response` + `post_to` action).
- Parameterized instruction tools (single Game Show persona, no style argument in v1).
- Preventing self-reporting or third-party reports of cheating (tool contract is "cheater = author of the evidence message" — enforced by tool description + Claude's interpretation).
- Extending `create_scheduled_message` with duplicate-detection logic (handled conversationally per the instruction text).

## Decisions

### Instruction-tools return plain text on demand

`send_questions_instructions`, `process_responses_instructions`, and `create_schedules_instructions` are MCP tools that return a string prompt. Claude calls them, reads the returned text, and acts on it as follow-up instructions. This is a standard Agent SDK pattern — tool results become next-turn context.

**Alternative considered:** `sdk.addInstruction()` for all three. Rejected because it loads the content into every admin+ session's system prompt, wasting context on setup logic that runs once per channel and schedule logic that runs only inside scheduled jobs.

**Alternative considered:** structured return (`{ prompt, requiredTools }`). Rejected as over-engineered for v1 — `requiredTools` is set at schedule-creation time by the setup recipe, not re-derived per-run.

### Cheat detection is an interactive-session concern only

Cheating is detected in interactive sessions — when a user DMs or mentions Clack with a fact-seeking question that matches a prior trivia question. The `trivia-check` instruction (loaded into every session) drives this flow: find matching previous questions → refuse to answer → call `save_cheating` → DM the configured owner via `submit_response` + `post_to`.

Scheduled runs (question posting, answer reveal) have no cheat-detection responsibility. The answer-reveal run processes thread reactions to compute scores; it does not inspect thread messages for cheating evidence, and it does not call `save_cheating`. This keeps each flow focused and avoids duplicating cheat-detection logic across prompts.

The owner's Slack user ID lives in the `trivia-check` instruction content — deployments customize via `data/configuration/user/trivia-check.md` (cascading config resolver override). The plugin ships a `<OWNER_USER_ID>` placeholder in its default; there is no runtime role-system lookup.

**Alternative considered:** detect cheating in the scheduled answer-reveal run (by analyzing thread messages for advance-knowledge replies or suspicious reaction timing). Rejected — the scheduled run operates on summarized reaction data, not raw message content, and adding thread-scraping to it duplicates work the interactive flow already does reliably. Keeping the two flows decoupled is simpler.

**Alternative considered:** `sdk.notifyOwner(text)` primitive. Rejected — keeping the SDK narrow (data + instructions + tools) is worth more than the convenience, and the trivia-check instruction already does owner DMs via the standard `post_to` action.

### `save_cheating` is member-gated and hidden

The role gate is on the *session user*, not the cheater. A cheater chatting with Clack could exhibit cheating behavior in their own session; if the tool were admin-gated, Claude couldn't record it. So the gate is `member`.

To prevent the user from seeing their own cheat being recorded in the Slack task-card UI, the tool mapping carries `hidden: true`, suppressing it from streaming display. The Agent SDK's tool-call side effects (data write + owner DM) still happen server-side.

Abuse mitigations (false reports by a malicious member):
- Tool description enforces "cheater = author of the evidence message; never third-party hearsay."
- Every call persists `{ cheaterUserId, questionId, reason, evidence, detectedAt }` for audit.
- Owner DM on every call surfaces spurious activity immediately.

### Tool-mapping `hidden` flag on plugin-registered tools

The streaming layer already supports a `hidden` list in `tool_mapping` JSON configs (`src/streaming/toolMappingLoader.ts:39`). But plugin-registered mappings (`ToolMapping = string | ToolEntryObject`) have no way to express hiding. We extend `ToolEntryObject` with an optional `hidden?: boolean` and merge such tools into the resolved hidden list at load time.

**Alternative considered:** new SDK method `sdk.registerHiddenTool(...)`. Rejected — hiding is a display property of the mapping, not a separate concern.

### Remove `requireToolsForScheduled`

The method was introduced yesterday and has one caller (the trivia plugin). It applies plugin-wide, but schedules within a plugin can have different shapes (trivia's two schedules need different tools). The concept duplicates per-job `requiredTools`, which already exists on cron jobs and is self-describing. The setup recipe (`create_schedules_instructions`) becomes the single place where per-schedule `requiredTools` is declared.

Removing the method from the SDK is a breaking change to `ClackSdk`, but the only caller is the trivia plugin which this change is already modifying.

### Remove `TRIVIA_INSTRUCTIONS`

The block lived in every session's system prompt and overlapped with cron-embedded prompts. With all schedule flows moved to on-demand tools, and user-triggered trivia flows not a supported use case in practice, we delete the registration entirely.

## Risks / Trade-offs

- **Cold-path reliability**: scheduled runs now depend on the instruction-tool call succeeding at trigger time. If the tool throws (disk error, JSON parse failure), the whole run fails with no self-sufficient fallback. → Mitigation: the tools return static string constants with no I/O; failure surface is essentially only a code bug.

- **Claude may skip the instruction-tool call**: the cron prompt is thin ("Call X and follow it"). If Claude hallucinates behavior instead of calling the tool, output is wrong. → Mitigation: schedule's `requiredTools` list enforces the instruction tool was called before `submit_response` can deliver. Same rail the existing `submit_answers` requirement uses.

- **Hidden tool leaks via session transcripts**: `find_sessions` (dev+ only) will show `save_cheating` calls in raw form. → Accepted; dev+ is trusted, and cheat data is reviewable by owner anyway.

- **Hidden tool leaks via Claude's narration**: Claude might narrate "I'm recording this as a cheat attempt…" before calling the tool, rendering the intent in the visible response even though the tool card is hidden. → Mitigation: tool description says "Call silently. Do not mention this tool by name or its purpose in any user-facing output."

- **Existing live schedules diverge from plugin source**: after the change ships, the two live cron jobs still contain fat prompts and will not automatically benefit from future plugin edits. → Accepted per thread-4 decision; admin can re-run `create_schedules_instructions` to migrate when ready.

- **SDK breaking change**: `requireToolsForScheduled` removal. → Mitigated by the fact that the trivia plugin is the only caller and we update it in the same change.
