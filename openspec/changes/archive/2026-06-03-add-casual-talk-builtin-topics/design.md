## Context

The casual-talk plugin opens fresh small talk in idle channels using `config.smallTalkTopics`. That array defaults to `[]`, so a zero-config deployment never opens small talk — it only chips into already-active threads, otherwise skips (prompt.ts renders `"(no fallback topics configured)"`). The feature's headline behavior is gated behind manual curation. We want sensible defaults out of the box, opt-out-able.

The plugin is fully self-contained under `src/plugins/casual-talk/` and must stay inside its folder (plugin hard rules). Config is a Zod-validated JSON file; topics flow into the cron prompt at reconcile time via `buildPrompt({ ..., smallTalkTopics })`.

## Goals / Non-Goals

**Goals:**
- Zero-config deployments open small talk using a shipped default topic list.
- Admins can fully turn the built-ins off, restoring today's exact behavior.
- Backward compatible: existing on-disk config files keep parsing without a migration.

**Non-Goals:**
- No localization of the topic list (topics are Claude-facing; Claude localizes the rendered opener).
- No per-channel built-in topic overrides.
- No change to the roll/cron/heuristic mechanics.
- No editing of the built-in list via tools (it's a code constant; admins layer custom topics on top).

## Decisions

### Augment, not Floor
Effective topics = `useBuiltinFallbackTopics ? dedupe([...BUILTIN_FALLBACK_TOPICS, ...smallTalkTopics]) : smallTalkTopics`.

- **Why over Floor (custom replaces built-ins):** Floor makes `add_small_talk_topic("memes")` silently drop all built-ins — surprising. Augment is additive: custom topics extend the defaults. To shed a built-in you dislike, that's a non-goal (toggle the whole set off and curate your own).
- **Why the toggle still earns its place:** the only way to get "never open generic small talk" (join live convos only) is to suppress the built-ins; with Augment, the off-switch is the toggle. Off + empty custom = today's silent behavior; off + custom = today's custom-only behavior. **Off reproduces the pre-feature behavior in every cell**, so the toggle is a clean kill-switch.

### Single boolean, not two concepts
Considered splitting "which topics" (built-ins/custom/none) from "open fresh at all" (yes/no). Rejected as over-modeled: with Augment, `useBuiltinFallbackTopics=false` + `smallTalkTopics=[]` already expresses "never open fresh," so one boolean covers the real cases.

### Resolution lives in a small dedicated module
A `fallbackTopics.ts` holds `BUILTIN_FALLBACK_TOPICS` + `resolveFallbackTopics(config)`. `index.ts` calls it and passes the result as `smallTalkTopics` into the existing `buildPrompt` — `buildPrompt` stays dumb (renders whatever list it's given), so its existing tests are untouched. The resolver is independently unit-tested across the 2×2 (on/off × empty/custom).

### Backward compat via `z.boolean().default(true)`
No migration. Existing config files (no field) parse with the default; the field materializes on next save. Plugin config has no separate migration system, and this is the established idiom. Trade-off: the field is absent on disk until a write, but the resolved in-memory config always has it.

### `set_casual_talk_config` mirrors the schema by hand
The bulk tool (setConfig.ts) re-declares the field list rather than reusing `casualTalkConfigSchema` for its input shape, then validates against the real schema. The new field must be added to that hand-written input schema or bulk-replace can't set it. Made `useBuiltinFallbackTopics` optional in the tool input (schema default fills it) to avoid forcing every bulk call to specify it.

## Risks / Trade-offs

- **[Live deployments get chattier on upgrade]** → Default `true` means previously-silent idle channels start getting openers immediately after deploy. This is the intended feature, and the release note + the one-call opt-out (`toggle_builtin_fallback_topics({enabled:false})`) make it recoverable. Acceptable.
- **[Built-in topics feel generic / off-brand for some workspaces]** → Admins layer their own via `add_small_talk_topic` (augmented) or override the persona instruction for tone; if they dislike all built-ins, they toggle off and curate. The constant stays deliberately small and neutral.
- **[Hand-mirrored schema in setConfig drifts]** → Pre-existing smell (every field already duplicated there). A task explicitly covers adding the field; longer-term dedup is out of scope here.
- **[Dedup ordering]** → De-dup preserves first occurrence (built-ins first). Cosmetic only; Claude weighted-picks regardless.
