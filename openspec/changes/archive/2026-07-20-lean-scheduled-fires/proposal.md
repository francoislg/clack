# Lean Scheduled Fires

## Why

Chatter (casual-talk) fires ~32 times/day and ~90% of fires end at the die roll with `skip_response` — yet every fire pays for content only a *hit* needs: ~4.3k tokens of `response-rendering` guidance, ~2.4k tokens of engagement instructions (Steps 2–4 + persona of the cron prompt), and ~1.4k tokens of skill catalogs (AVAILABLE SKILL PACKS + USER SKILLS) that no plugin cron job ever uses. Measured on a live fire: ~49k input tokens, of which ~8k is hit-only or never-used content. Splitting "triggering" from "triggered" instructions — loaded dynamically via the existing plugin-topic + `attach_integration` machinery shipped in `optional-baseline-topics` — removes that cost from miss fires with a reliable, code-backed trigger.

## What Changes

- **Casual-talk two-stage prompt**: the cron prompt shrinks to the roll step plus config-derived context (candidate channels, fallback topics, skip-variant). The static engagement guidance (channel triage, reacting, posting/termination mechanics, persona constraints) moves into an attachable instructions-only topic `casual-talk:engagement`, registered via `sdk.registerMcpServer("engagement", { autoload: false })` + `handle.addTopicInstruction` — no tools bound.
- **Hit directive in the prompt**: the roll step keeps the existing core `random_roll`; the prompt's hit branch is a single explicit directive — on a 1, call `attach_integration("casual-talk:engagement")` and `attach_integration("response-rendering")` before doing anything else, then follow the loaded instructions. Because the lean prompt is short, the directive sits adjacent to the roll instruction rather than buried under 10k chars of mechanics.
- **Casual-talk drops pre-attached `response-rendering`**: spec `attachedTopics` becomes `["casual-talk"]`; rendering guidance is attached on hits only. The shipped `submit_response` formatting-failure hint remains the backstop.
- **Skill catalogs gated off plugin-managed scheduled fires**: `scheduled` fires of plugin-managed cron jobs no longer render AVAILABLE SKILL PACKS / USER SKILLS catalog blocks. User-created schedules and all interactive triggers are unchanged. AVAILABLE INTEGRATIONS stays on every fire (it is what makes `attach_integration` discoverable).

## Capabilities

### New Capabilities

_None — everything composes existing machinery (plugin topics, on-demand servers, attach_integration, catalogs)._

### Modified Capabilities

- `casual-talk-plugin`: cron prompt is reduced to roll + config context + hit-attach directive; engagement guidance becomes the `casual-talk:engagement` attachable topic; spec `attachedTopics` loses `response-rendering`.
- `lazy-skill-loading`: the AVAILABLE SKILL PACKS catalog (including its USER SKILLS subsection) is omitted for plugin-managed scheduled fires.

## Impact

- `src/plugins/casual-talk/` — `prompt.ts` split (lean cron prompt + engagement topic content), `index.ts` (register on-demand server, topic instruction; spec changes) + tests.
- `src/claude/index.ts` (or the prompt-options supplier) — gate `skillPluginsRegistry` / `userSkills` prompt options on trigger type + plugin-managed job flag; `src/claude/promptBuilder.ts` untouched (options-level gating).
- Token effect: ~8k fewer input tokens per chatter miss fire (~16%), ~230k tokens/day across chatter alone; hit fires repay ~6.7k as attach results. Plugin-managed trivia/idler fires additionally shed the ~1.4k catalog slice.
- No config migration: all changes are spec-level (plugin reconcile updates jobs on boot) or render-time gating.
