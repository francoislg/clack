## Why

Today, auto-respond engagement is a single on/off boolean (`autoResponseActive`) and the pre-analysis gate applies one fixed, conservative policy to every thread. Some conversations deserve eager follow-up (a thread Clack was just asked to join), others deserve near-silence, and a plugin that starts a thread knows up front how closely Clack should follow it. There is no way to express *how eagerly* Clack should track a given conversation — only whether it tracks at all.

## What Changes

- Introduce a per-conversation **attention level** — a single monotonic dial `"always" | "high" | "medium" | "low" | "off"` stored on the session — that replaces the `autoResponseActive` boolean. `off` is the disengaged state; `isEngaged := level !== "off"`.
- **BREAKING (internal):** remove the `autoResponseActive` field. Every reader/writer switches to the attention dial. On-load migration: `autoResponseActive === false → "off"`, otherwise `→ "medium"`.
- The pre-analysis classifier gains a **level-keyed policy block**: `low` = today's conservative behavior verbatim; `medium` (the **new default**) leans toward answering; `high` answers nearly everything; `always` short-circuits the classifier entirely (respond without a Claude call).
- **Disengagement folds into the dial.** The cheap classifier may auto-disengage (`→ "off"`) only from the `low` rung; higher rungs never silently die. The descent down the ladder is Claude's job (it tunes the level as a thread cools).
- The initial level is set by the trigger source: `CronJobSpec.attentionLevel` (plugins), `AutoRespondRule.attentionLevel` (rules), or the `"medium"` default for mention/DM/reaction. None of these sources may set `"off"` — a dead thread is only reached by disengaging. For the channel-engagement gate (a brand-new top-level rule match), `"always"` is capped to `"high"` to prevent a whole-channel firehose.
- `submit_response` gains an optional `attention_level` parameter spanning the **full ladder including `"off"`**, letting Claude raise, lower, or instantly disengage at any moment. This **removes** the separate `disengage` boolean — `attention_level: "off"` is the disengage. The current level is surfaced to Claude so it can make relative adjustments.
- Hard disengage signals (stop reaction, inline stop emoji, `stop_tracking` tool) continue to work from any rung, now writing `"off"`. Re-engagement (@mention or change-thread button in an `off` thread) sets `"medium"`.

## Capabilities

### New Capabilities
- `attention-level`: the per-conversation attention dial — the `always|high|medium|low|off` enum, the session field with persistence and migration from `autoResponseActive`, the `isEngaged` derivation, initial-level resolution per trigger source (cron/rule/default), the `always`-short-circuit and `low`-only auto-disengage gate rules, the Gate-A `always→high` cap, and re-engagement to `medium`.

### Modified Capabilities
- `auto-respond-tracking`: retire the `autoResponseActive` boolean in favor of `attentionLevel`; every disengage surface (stop reaction, inline stop emoji, `stop_tracking`, mention/button re-activation) now reads/writes the dial (`"off"` / `"medium"`).
- `auto-respond-pre-analysis`: the classifier policy is keyed by the session's attention level; the `"stop"` verdict is reserved to the `low` rung; `"always"` skips pre-analysis.
- `auto-respond-rule-tools`: `add`/`update`/`list` auto-respond rule tools carry an optional `attentionLevel` field (settable range `always|high|medium|low`).
- `clack-tool-response`: `submit_response` gains an `attention_level` parameter (full ladder incl. `"off"`, gated to tracking-capable contexts) and removes the `disengage` boolean.

## Impact

- **Session model** (`src/sessions.ts`): new `attentionLevel` field + `setAttentionLevel` setter + load-migration + removal of `autoResponseActive` and `setAutoResponseActive`.
- **Pre-analysis** (`src/claude/preAnalysis.ts`): policy-block parameter on `runPreAnalysis`; `stop` emitted only at `low`.
- **Auto-respond handler** (`src/slack/handlers/autoRespond.ts`): both gate sites read the level; `always` short-circuits; Gate A caps `always→high`.
- **Disengage/re-engage sites** (`mention.ts`, `stopPipeline.ts`, `tools/query/stopTracking.ts`, `handlerResponse.ts`, change-thread button handlers): swap the bool for the dial via an `isEngaged` helper.
- **Rules** (`src/autoRespond.ts` + rule MCP tools) and **plugin crons** (`src/cronJobs.ts` `CronJobSpec`, plugin spec builders like trivia): new `attentionLevel` field.
- **submit_response** (`src/tools/presentation/submitResponse.ts`, `handlerResponse.ts`): `attention_level` param + current-level in prompt; drop `disengage`.
- Repo-wide sweep for every `autoResponseActive` reference. No on-disk data migration needed (absence reads as `"medium"`).
