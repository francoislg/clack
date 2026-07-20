# Design — Lean Scheduled Fires

## Context

`optional-baseline-topics` (archived 2026-07-17) shipped the machinery this change composes: instructions-only topics attachable mid-session via `attach_integration` (pre-attached names short-circuit; unknown names error against the registry), `CronJobSpec.attachedTopics`, and the `submit_response` formatting-failure hint that suggests attaching `response-rendering`. Casual-talk today pre-attaches `["casual-talk", "response-rendering"]` on every fire and carries a ~12.2k-char cron prompt whose Steps 2–4 + persona (~10k chars) are only relevant on a roll hit (~10% of fires). Measured live fire: ~49k input tokens; ~38k of it rides the prompt cache at 0.1×, but the removable content sits in the ~10.8k cache-write slice — the expensive part.

Plugin constraint (src/plugins/CLAUDe.md): `addTopicInstruction` content is wired at init (soft-restart to change), while casual-talk's config (channels, die, topics) hot-reloads by re-reconciling the cron prompt. Any split must keep config-derived content OUT of the topic so hot-reload keeps working.

## Goals / Non-Goals

**Goals:**
- Miss fires (~90%) pay only for the roll step; hit fires deterministically load the full engagement + rendering guidance.
- Preserve casual-talk config hot-reload (no soft restarts introduced).
- Plugin-managed scheduled fires stop paying for skill catalogs they never use.
- Zero behavior change for interactive triggers and user-created schedules.

**Non-Goals:**
- Touching the idler/trivia prompts (idler syncs are already lean; trivia fires always post).
- Any change to the response-rendering topic content or the builtin-topics trigger policy.
- Caching/model-level optimizations.

## Decisions

### D1 — Engagement guidance becomes an instructions-only on-demand server topic

`sdk.registerMcpServer("engagement", { autoload: false, description })` with **no tools bound**, plus `handle.addTopicInstruction("user", "engage", ENGAGEMENT_CONTENT)`. Full name `casual-talk:engagement` lands in the effective registry, so `attach_integration("casual-talk:engagement")` passes the `knowsServer` gate and resolves as `instructions_only` — instructions arrive as the tool result. This is the exact pattern trivia's management server uses, minus tools.

*Alternative rejected*: a plain (server-less) topic name — `attach_integration` would reject it as unknown; only registry-known names are attachable mid-session.

### D2 — Static/dynamic split of the current prompt

- **Cron prompt keeps (always paid)**: Step 1 (roll), the hit directive (see D3), candidate channels block (config), fallback small-talk topics block (config), the Step-4 skip-variant (config-dependent on `hasTopics`, ~700 chars), rate label/die (config).
- **Topic gets (hit-only)**: Step 2 triage mechanics (fetch/overview/freshness/human-leaf rules), Reacting section, Step 3 posting/termination mechanics (`deliver_to`, `attention_level`, `default_delivery_mode` contracts), persona constraints.

Rationale: everything config-derived stays in the prompt, which is rebuilt on every `reconcileCronJobs` — hot-reload untouched. The topic holds only static content, correctly registered once at init. The persona topic (`casual-talk`) stays pre-attached: it is also used to calibrate reactions and is small.

### D3 — Hit directive lives in the lean prompt; `random_roll` stays as-is

The roll step keeps the core `random_roll` (unchanged tool, unchanged `requiredTools` enforcement). The prompt's hit branch becomes a single unmissable directive placed directly under the roll instruction: on a 1, call `attach_integration("casual-talk:engagement")` and `attach_integration("response-rendering")` FIRST, then follow the loaded instructions. Reliability comes from the split itself: the lean prompt is ~2k chars, so the directive is one of only two branch instructions in it — not a line buried under 10k chars of mechanics as it would be today.

Backstops if the attach is skipped: the engagement topic's absence leaves Claude without termination mechanics, and the shipped `submit_response` formatting-failure hint suggests `response-rendering` on validation errors.

*Alternative rejected (per review)*: a plugin-owned `roll_chatter` tool whose result carries the directive. Deterministic delivery, but it duplicates a core tool for one prompt line's worth of benefit — rejected as machinery creep; `random_roll` is good as-is.

### D4 — `attachedTopics` becomes `["casual-talk"]`

`response-rendering` moves to hit-time attach (D3 directive). Backstop stays: the shipped `submit_response` formatting-failure hint. Reconcile updates the job on next boot/config-touch — no migration (plugin-managed jobs are reconciled, mirror of the optional-baseline-topics rollout).

### D5 — Skill catalogs gated by `pluginManaged` scheduled fires, at the options supplier

In `src/claude/index.ts`, when the session trigger is `scheduled` AND the firing cron job is `pluginManaged`, omit `skillPluginsRegistry` and `userSkills` from `PromptOptions` — `buildQuestionPrompt` already skips the sections when the options are absent, so `promptBuilder.ts` needs no change. AVAILABLE INTEGRATIONS is always kept (attach_integration discoverability is what D1/D3 depend on).

*Alternative rejected*: a `CronJobSpec.includeSkillCatalogs` opt-out flag — more machinery for zero known consumers; no plugin prompt references skills today. If a plugin ever needs skills, that flag is a clean follow-up. User-created schedules keep catalogs unconditionally (a user schedule may legitimately say "use the marketing skill").

## Risks / Trade-offs

- [Hit fires spend 2 extra tool turns (attaches) and repay ~6.7k tokens as uncached tool results] → Acceptable: hits are ~10% of fires; net is strongly positive and post latency on a casual post is invisible.
- [Claude posts on a hit without attaching rendering guidance] → D3 puts the directive in the tool result; formatting-class validation hint remains the backstop; casual posts are short and low-blocks anyway.
- [Engagement topic content drifts from the prompt's termination contract] → The termination contract lives in ONE place (topic); the cron prompt references it rather than restating (single-source rule in the split).
- [Operator overrides of the old monolithic prompt] → The cron prompt is not operator-overridable today (built in code); the new topic IS overridable at `data/configuration/user/topics/casual-talk:engagement/…`, which is a strict improvement. VM has no existing overrides to re-home (audited 2026-07-17).
- [A future plugin cron job legitimately needs skill packs] → add the opt-in spec flag then (D5 alternative); until a consumer exists the flag is dead config.

## Migration Plan

Deploy is code-only: reconcile rewrites the chatter job spec (prompt, requiredTools, attachedTopics) on boot; catalog gating is render-time. Rollback = revert the commit; reconcile restores the old spec on next boot. No data migration in either direction.

## Open Questions

_None._
