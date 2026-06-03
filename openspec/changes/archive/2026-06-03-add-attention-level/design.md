## Context

Auto-respond engagement is currently two orthogonal concepts: a per-session boolean `autoResponseActive` (engaged or not) and a per-message pre-analysis classifier that returns `respond | skip | stop` using one fixed, conservative policy. Plugins that start threads (trivia), admin-defined auto-respond rules, and ordinary mention/DM/reaction sessions all get the same fixed eagerness. There is no knob for "how closely should Clack follow *this* conversation."

This design introduces a single per-conversation **attention dial** that subsumes both concepts: the engaged/disengaged boolean becomes the bottom rung of a 5-value ladder, and the dial value selects the classifier's policy.

## Goals / Non-Goals

**Goals:**
- One monotonic dial `"always" | "high" | "medium" | "low" | "off"` as the single source of truth for thread engagement, replacing `autoResponseActive`.
- `low` reproduces today's behavior exactly; `medium` becomes the new default and leans toward answering; `high` answers nearly everything; `always` skips pre-analysis; `off` is disengaged.
- Let the trigger source (plugin cron, auto-respond rule) seed the level, and let Claude tune it per turn via `submit_response` (including instant disengage).
- No on-disk data migration: absence of the field reads as `"medium"`.

**Non-Goals:**
- No automatic *upward* movement by the cheap classifier (escalation is Claude's or the user's job, via `submit_response` / @mention re-engagement). The classifier only moves a thread down, and only from the `low` rung.
- No change to the active-run gate's append/skip logic for `low|medium|high` — only `always` bypasses it.
- No new config-level (global) field — attention level is strictly per-conversation.
- No tuning of the cheap classifier to do graceful multi-rung descent (chosen Claude-driven descent instead).

## Decisions

### 1. Single dial replaces `autoResponseActive` (single source of truth)

`SessionContext.attentionLevel?: AttentionLevel` where `AttentionLevel = "always" | "high" | "medium" | "low" | "off"`. A helper `isEngaged(session) = (session.attentionLevel ?? "medium") !== "off"` replaces every `autoResponseActive === true/false` read. The setter `setAttentionLevel(sessionId, level)` replaces `setAutoResponseActive`.

**Why over keeping the boolean + a separate level field:** two fields encoding overlapping state invites drift (a session that is `off` but `level: high`). Folding disengagement into the ladder's floor makes the state space exactly the five reachable values. The user explicitly chose single-source-of-truth over a compat shim.

**Alternative considered:** keep `autoResponseActive` as a derived/synced compat field to shrink the diff. Rejected — it reintroduces the drift risk and leaves two concepts in the code.

### 2. Migration by read-time defaulting, not a boot migration

On session load, if `attentionLevel` is absent: `autoResponseActive === false → "off"`, otherwise `→ "medium"`. The legacy field is then dropped on next persist. No numbered migration is required because the mapping is total and pure.

**Why:** every existing on-disk session has either `autoResponseActive: false` (explicitly disengaged → must stay disengaged = `off`) or `true`/absent (engaged → new default `medium`). A read-time map covers all cases; a blocking migration would add risk for no benefit. **Consequence (intended):** in-flight engaged mention/DM threads become `medium` (more eager) on deploy — this is the desired behavioral upgrade, not an accident.

### 3. Pre-analysis policy is a swappable block, not separate prompts

`runPreAnalysis` keeps its shared scaffolding (direct-address override, thread-tone assessment, temporal-proximity signal, output format) and takes a `level` parameter that selects a POLICY block governing the lean and tie-breakers:

| Level | Lean | "stop" reachable by classifier? |
|-------|------|-------------------------------|
| `low` | today's prompt verbatim — default skip; skip > respond; skip > stop | yes (explicit sign-off / topic change) |
| `medium` | respond when plausibly relevant; skip only clear cross-talk | no |
| `high` | respond to nearly everything; skip only unmistakable other-user side-talk | no |

`always` never calls `runPreAnalysis` (short-circuit to respond). `off` is filtered earlier (`isEngaged` is false). The `"stop"` verdict is **only offered to the classifier at `low`** — at `medium`/`high` the prompt presents only `respond | skip`, so a hot thread cannot be killed by the cheap gate.

**Why `stop` only at `low`:** disengagement should be deliberate. A `medium`/`high` thread that has cooled must first be walked down to `low` (by Claude, who has full context), at which point the classifier is permitted to finish the descent on an explicit sign-off. This makes "when engagement is low, we can disengage" a literal property of the ladder.

**Alternative considered:** gate-driven auto-cooling (classifier steps the level down one rung each turn). Rejected — a one-word classifier judging "is this thread cooling" is fuzzy and mutates session state on the hot path every turn; Claude judges cooling far better with full conversation context.

### 4. Two gate sites; `always` cap on the channel-engagement gate

- **Gate B (thread reply, session exists):** `always → respond` (no call); `off → ignore`; else `runPreAnalysis(level)`.
- **Gate A (channel-monitoring: a brand-new top-level message matched an auto-respond rule, no session yet):** uses the rule's level as policy, **but `always` is capped to `high`**. Without the cap, an `always` rule with no user/keyword filters answers every message in the channel — a firehose. Capping to `high` keeps the classifier in the loop for the initial engage decision while still being very eager.

The active-run gate (`runActiveRunPreAnalysis`) is unchanged for `low|medium|high`; `always` bypasses it (append all).

### 5. Initial-level resolution by trigger source

At session creation:
```
scheduled (plugin cron)     → CronJobSpec.attentionLevel  ?? "medium"
autoRespond (rule)          → rule.attentionLevel         ?? "medium"
mentions / DM / reactions   → "medium"
```
None of these sources may persist `"off"` (validated/typed out of their settable range) — a dead thread is only reached by a disengage action. Then, every turn, `submit_response.attention_level` (if present) overwrites the session value.

### 6. `submit_response.attention_level` spans the full ladder and replaces `disengage`

The `attention_level` parameter accepts `always | high | medium | low | off`. Setting `off` IS the disengage — the separate `disengage` boolean is removed. The parameter's `off` option is only present in the schema for tracking-capable trigger contexts (the same gating that previously controlled whether `disengage` appeared: `autoRespond`, thread-reply, `mentions`); for `directMessages`/`reactions`/`scheduled` the value set is `always|high|medium|low` (or the parameter is omitted where tuning has no effect). Claude is shown the session's current level in the delivery-context prompt so it can make relative moves (lower a quieting thread, raise a tight back-and-forth, or drop straight to `off` when dismissed).

**Why fold `disengage` in:** `disengage: true` and `attention_level: "off"` are the same operation; two ways to express it is redundant surface. One dial, top to bottom.

## Risks / Trade-offs

- **Wide internal blast radius (removing `autoResponseActive`)** → mitigate with a repo-wide grep sweep and a single `isEngaged`/`setAttentionLevel` helper pair that every call site routes through; lean on the parity/scenario tests in the touched specs.
- **In-flight threads become more eager on deploy** (engaged sessions jump to `medium`) → this is intended per the proposal; flagged so it is not surprising. Rollback = revert; sessions still on disk carry no `attentionLevel`, so reverting reads them as `autoResponseActive`-absent (engaged) again.
- **`medium` over-responding in busy channels** → only affects threads Clack is already engaged in (Gate B); the channel-engagement Gate A keeps its conservative behavior except where an admin explicitly sets a higher rule level, and even `always` is capped to `high` there.
- **Claude forgetting to walk a thread down** (so it never disengages) → acceptable: existing hard signals (stop reaction, inline stop emoji, `stop_tracking`, thread max-age sweep) still disengage from any rung; the classifier auto-disengage at `low` is a convenience, not the only path.
- **`always` thread never auto-stops** → by design; only hard signals or Claude setting `off` end it. Documented in the tool/prompt guidance.

## Migration Plan

1. Add `AttentionLevel` type, `attentionLevel` field, `isEngaged`, `setAttentionLevel`, and read-time defaulting/migration in `src/sessions.ts`.
2. Route every `autoResponseActive` reader/writer through the new helpers; delete the old field and `setAutoResponseActive`.
3. Add the `level` policy parameter to `runPreAnalysis`; restrict `stop` to `low`.
4. Update `autoRespond.ts` gate sites (B short-circuit/ignore, A cap).
5. Add `attentionLevel` to `AutoRespondRule` + rule tools, and to `CronJobSpec` + plugin spec builders.
6. Replace `disengage` with `attention_level` in `submit_response`; surface current level in the prompt.
7. Repo-wide grep for residual `autoResponseActive` / `disengage` references.

Rollback: revert the change set. On-disk sessions without `attentionLevel` are read by the prior code as engaged (`autoResponseActive` absent → true), so no data cleanup is needed.
