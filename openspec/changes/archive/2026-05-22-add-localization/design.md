## Context

Clack emits user-facing text from two sources:

1. **Claude-authored text** (~95% of words seen by users): Q&A answers via `submit_response`, change-workflow narration, trivia questions, auto-responses. Currently produced in English because the system prompt is in English and contains no language directive.
2. **Hardcoded TypeScript strings** (~200+ strings, long tail): Home Tab sections, Block Kit modals, button labels, error toasts, change-workflow status messages, stop-reaction confirmations. Currently English literals scattered through `src/slack/` and `src/changes/`.

There is no existing i18n infrastructure. Adding it as a cross-cutting change touches roughly a dozen files but introduces no new runtime dependencies and no data-format migration.

The two sources need different mechanisms:
- Claude's output flips via a **single instruction added to the system prompt**.
- Hardcoded strings flip via a **lookup helper** at every emission site.

## Goals / Non-Goals

**Goals:**
- Make the entire user-facing Clack surface (UI + Claude voice) speak the configured language.
- Type-safe call sites: misspelled keys, missing interpolation vars, and unknown vars are compile errors.
- Zero new runtime dependencies; ~30 LOC of i18n plumbing.
- Migration path to a real i18n library (Paraglide, etc.) without touching call sites — same `t(key, vars)` shape.
- Pure no-op when `language` is absent or `"en"` (current behavior preserved).
- Tests for placeholder parity prevent silent FR/EN drift.

**Non-Goals:**
- Tool-mapping labels in Slack task cards (deferred).
- Per-language instruction folders (`data/default_configuration/<lang>/...`) — instruction files stay English.
- Per-user language preference — workspace-global only.
- ICU plural/select/gender variants — handled by separate keys where needed.
- Locale-aware date/number formatting — use `Intl` ad hoc where it matters, no global helper this round.
- Translating internal logs, error stack traces, debug output.
- Translating plugin-internal prompts (trivia's 1430 lines of TS-embedded prompts stay English; Claude obeys the directive for its rendered output).

## Decisions

### Decision 1: DIY keyed dictionary over Paraglide

**Choice:** Ship ~30 LOC of TypeScript i18n helpers (`t`, `Vars<>`, dictionary modules) rather than adopting Paraglide-js now.

**Rationale:**
- Paraglide requires a build step (`paraglide-js compile`) and generated artifacts checked into the repo.
- Inlang Studio's value (non-dev translators editing strings in a web UI) doesn't apply to a self-hosted bot.
- DIY gives type-safe placeholders via template literal types — the main Paraglide DX win is already covered.
- Migration to Paraglide later is mechanical: both keep keyed lookups; call sites would survive a codemod.

**Alternatives considered:**
- *Paraglide-js v2:* good library but premature; reconsider when adding a third language or when plural/select variants become unavoidable.
- *Colocated dictionaries* (`t({ en: "Save", fr: "Enregistrer" })`): rejected — explicitly chosen against in earlier exploration because it doesn't scale to language-pack distribution and makes adding a new language a global grep.
- *i18next:* heavier, more ceremony, plugin ecosystem irrelevant here.

### Decision 2: Flat dotted keys, no nesting

**Choice:** Dictionary entries are flat `"home.save"`-style keys, not nested objects.

**Rationale:**
- Simpler at the type level (`keyof typeof en` is a string union, no recursive path types).
- Paraglide uses flat keys, so future migration is one-to-one.
- No ambiguity about partial overrides or merging strategies.

**Alternatives considered:**
- *Nested objects:* prettier in source but requires `DeepPath<T>` types and `get(obj, path)` runtime resolution. Net loss.

### Decision 3: Placeholder syntax `{name}`

**Choice:** Single-brace `{name}` placeholders. Parsed at the type level via template literal types; replaced at runtime via `replaceAll`.

**Rationale:**
- Same syntax as ICU MessageFormat and Paraglide — clean migration path.
- Template literal type extraction is straightforward (`S extends \`${string}{${infer V}}${infer Rest}\` ? V | Vars<Rest> : never`).
- No conflict with JSON, Markdown, or Block Kit text.

**Alternatives considered:**
- *`%{name}` (Ruby-style):* no migration benefit.
- *`${name}` (template-literal-style):* visual confusion with TS interpolation.
- *Double braces `{{name}}` (Handlebars):* fine but no upside.

### Decision 4: BCP-47 short codes; FR fallback to EN per key

**Choice:** `language: "en" | "fr"` in `config.json`. Initial supported set is `en` and `fr`. Missing FR key → fall back to the EN string at runtime (with a once-per-key warning in dev).

**Rationale:**
- BCP-47 short codes are the industry standard and extend cleanly to region variants (`fr-CA`) later.
- Fallback prevents incomplete translations from breaking production; warning surfaces gaps without crashing.
- Type-level parity (`Record<keyof typeof en, string>` for `fr`) catches missing keys at compile time, but runtime fallback covers the case where a key was added in EN and FR hasn't been updated yet on the same build.

**Alternatives considered:**
- *Throw on missing key:* too aggressive; one missing FR string crashes Home Tab rendering.
- *Empty string on missing key:* silent and confusing.

### Decision 5: Language directive injection point

**Choice:** Inject the directive in `buildSystemPrompt` (`src/claude/promptBuilder.ts`) at the top of the assembled prompt, before any role-cascaded content, only when `language !== "en"`. Skip the pre-analysis prompt path.

**Rationale:**
- One injection point covers Q&A, change-workflow, trivia, auto-responses — everything that flows through `buildSystemPrompt`.
- Pre-analysis output is internal reasoning, never shown to users; translating it would slow Claude with no user-visible benefit.
- The role cascade loads identity, behavior, format, etc. files alphabetically — there is no clean "after identity, before behavior" insertion point without restructuring `loadInstructions`. Prepending the directive ahead of the entire cascade is functionally equivalent (still anchors as a top-level constraint) and one-line simple.

**Directive template:**
```
LANGUAGE
All output shown to users must be written in {NATIVE_NAME} ({EN_NAME}).
This includes:
  • Your final response delivered via submit_response
  • Any text fields in tool calls that produce user-visible content
    (button labels, message text, modal content)
  • Status messages, errors, and explanations

Write in natural, idiomatic {NATIVE_NAME}. Don't translate English idioms
literally. If a technical term has no good equivalent, use the English
term inline rather than inventing awkward phrasing.

Internal reasoning, tool names, file paths, code identifiers, and proper
nouns stay in their original form.
```

Language metadata table:

| Code | EN name | Native name |
|---|---|---|
| `en` | English | English |
| `fr` | French | Français |

**Alternatives considered:**
- *Inject at end of prompt:* recency bias works too but mixes with dynamic per-session content; placement near top makes the rule more "identity-like."
- *Per-tool directives in tool descriptions:* much larger change, repetitive, harder to audit.

### Decision 6: Helper API shape

```typescript
// src/i18n/t.ts
type Lang = "en" | "fr";

type Vars<S extends string> =
  S extends `${string}{${infer V}}${infer Rest}` ? V | Vars<Rest> : never;

type Args<S extends string> =
  [Vars<S>] extends [never] ? [] : [Record<Vars<S>, string | number>];

export function t<K extends keyof typeof en>(
  key: K,
  ...args: Args<(typeof en)[K]>
): string;
```

- `t("home.save")` — no second arg.
- `t("home.welcome", { name: "X" })` — `name` required and typed.
- `t("home.welcome", { typo: "X" })` — compile error.

Runtime: O(1) dictionary lookup + at most a handful of `replaceAll` calls. No memoization needed.

### Decision 7: Dictionary file layout

```
src/i18n/
  t.ts                 # helper, ~30 LOC
  parity.test.ts       # asserts FR keys = EN keys, FR placeholders = EN placeholders
  languages.ts         # Lang type, language metadata (native/EN names)
  strings/
    en.ts              # const en = { ... } as const — source of truth
    fr.ts              # Record<keyof typeof en, string>
```

Strings grouped by namespace prefix within the flat object: `home.*`, `error.*`, `changes.*`, `assistant.*`, `dm.*`, `stop.*`, etc. Namespace is convention, not enforced.

### Decision 8: Parity test as the safety net

A unit test (`src/i18n/parity.test.ts`) walks both dictionaries and asserts:
- Same set of keys.
- For every key, the set of `{var}` placeholders is identical between EN and FR.

This catches the case where a translator writes `{rôle}` instead of `{role}` — TS type checks the call-site, not the FR dictionary's interpolation tokens.

## Risks / Trade-offs

- **[Risk] Embedded examples in instruction prompts leak English style into Claude's French output.** → Mitigation: directive explicitly says "natural, idiomatic" and forbids literal translation. Spot-check trivia question generation in FR mode; if quality drops, follow-up change can translate high-value examples.
- **[Risk] Migrating ~200 hardcoded strings is mechanical but tedious; easy to miss one.** → Mitigation: add an oxlint rule or a focused test that greps `src/slack/` and `src/changes/` for suspicious literal-string `text:` and `label:` Block Kit fields not already wrapped in `t()`. Time-box the audit; missed strings can be migrated in follow-ups since fallback is the original English text already in code.
- **[Risk] FR translations may be wrong/awkward initially.** → Mitigation: ship FR as best-effort; treat string updates as low-friction maintenance; consider native-speaker review before tagging a release.
- **[Risk] Plural handling becomes painful as strings grow.** → Mitigation: accept it for v1 with separate `x.one` / `x.other` keys; the migration to Paraglide / ICU is the answer if pluralization sprawls.
- **[Risk] Tool-mapping labels remain English, producing mixed-language task cards.** → Accepted trade-off; documented in proposal as deferred follow-up.
- **[Trade-off] No per-user language.** → Workspace-global is simpler, matches the "main language" framing, and avoids per-prompt-build user-preference lookup. If teams need it, follow-up via `userPreferences.ts`.
- **[Trade-off] Instruction files stay English.** → Operators who heavily customize instructions in `data/configuration/` may want a non-English baseline. Accepted: directive + English instructions works well in practice; per-language baselines are a separate, larger change.

## Migration Plan

1. **Land plumbing first:** `src/i18n/t.ts`, `en.ts`, empty `fr.ts`, `parity.test.ts` (passing trivially with empty FR), `language` config field, directive injection. Production behavior unchanged because `fr.ts` is empty and `language` defaults to `"en"`.
2. **Migrate Home Tab strings to `t()`:** call sites flip but behavior stays English. Snapshot tests update; functional tests pass.
3. **Migrate Block Kit modals, DM-first reactions, status messages, error toasts.** Same pattern.
4. **Populate `fr.ts`:** translate all keys. Parity test enforces completeness.
5. **Manual smoke test:** set `language: "fr"` in a dev `config.json`; verify Home Tab, a change-workflow run, a Q&A session, and a trivia post all surface in French.
6. **Rollback:** revert `language` to `"en"` (or delete the field). No state to clean up; no migrations to undo.

## Open Questions

- **Should the language directive interpolate `{BOT_NAME}` or any other instruction variables?** Leaning no — directive is structural, not personality-shaping. Confirm during implementation if it reads oddly.
- **Do we expose a `t()` to the plugin SDK in this change?** Leaning no — plugins ride the Claude-voice directive for now. If a plugin author needs typed strings, they can import `t` directly (it's just a module); a SDK-blessed entry point can come later.
- **Should `language: "fr-CA"` resolve to `"fr"` when no exact match?** Out of scope for v1 (only short codes accepted); resolver logic can be added when region tags are introduced.
