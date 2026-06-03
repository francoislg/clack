## Context

Plugins under `src/plugins/<name>/**` are forbidden from importing outside their folder (see `src/plugins/CLAUDE.md`). The bot's `t()` helper lives in `src/i18n/t.ts` and is therefore unreachable from plugin code. Today the trivia plugin sidesteps this by deferring user-facing wording to Claude (e.g. "NEW SEASON" → "NOUVELLE SAISON" inside the scheduled prompts), but text rendered directly by TypeScript (Block Kit context/header text, modal labels, error toasts) has no localization path. The freeform live-roster footer is the visible symptom — "📝 *Answered:*" hard-coded in `src/plugins/trivia/freeform/roster.ts` shows in English on French workspaces.

Separately, the trivia freeform judge (`src/plugins/trivia/freeform/judge.ts`) has clear rules for typos, variants, hedges, and tolerance windows but no rule about language. A French player answering "Paris" with "Paris" is fine — but "Tokyo" answered with "Tokio" passes typo leniency only by accident, and a question authored in French asking for "Empire romain" rejects "Roman Empire" today.

The SDK is the natural place to add i18n because the SDK already crosses the plugin boundary on the plugin's behalf (file I/O, logger, slack client). Adding `registerDictionary` / `t` keeps the boundary intact and mirrors patterns the SDK already uses (`actionId`, `viewCallbackId`, `addInstruction`) where the plugin name is implicit and auto-scoping prevents cross-plugin collisions.

## Goals / Non-Goals

**Goals:**
- Plugin code can call `sdk.t("key")` to render user-facing text in the active workspace language.
- Each plugin owns an isolated key space — collisions across plugins are structurally impossible.
- EN is authoritative; FR (and any future language) is partial with EN fallback. Missing-FR-key fallback logs once per key (same UX as the core `t()`).
- The freeform live-roster footer renders translated in FR workspaces.
- The freeform judge accepts correct answers regardless of the language the user types them in, without weakening any other rule (multi-guess rejection, tolerance windows, etc.).

**Non-Goals:**
- A second core mechanism for language detection — we reuse `getConfig().language`.
- Plugin authors writing new languages to disk via the SDK (dictionaries are code, like the core `en.ts`/`fr.ts`).
- Per-user language overrides — the workspace-wide setting is the only axis today and that's unchanged.
- Translating the trivia plugin exhaustively — this change covers the freeform-roster strings only; the rest stays for follow-up changes.
- Changing how Claude renders its own output (the LANGUAGE directive in `promptBuilder.ts` continues to drive that).

## Decisions

### Decision 1: SDK exposes `registerDictionary` + `t`, NOT `getLanguage`

We chose registering a dictionary up front and looking up by key over the alternative of exposing the active language and letting each plugin maintain its own t-helper.

**Rationale:**
- Mirrors the core `t()` API the rest of the codebase already uses, so plugin authors don't learn a new pattern.
- Centralizes the EN-fallback + once-per-key warning behavior in the SDK rather than duplicating it across plugins.
- A future "add a new supported language" change touches every dictionary anyway; making the SDK aware of the dictionary shape lets a parity test cover plugin dictionaries too.

**Alternatives considered:**
- `sdk.getLanguage(): Lang` — plugin owns everything. Rejected: every plugin would re-implement the same fallback + interpolation logic; harder to enforce parity later.
- `sdk.t({ en, fr }, vars?)` per call — strings sprawl through code with no central place to audit translations. Rejected.

### Decision 2: Plugin name is auto-scoped, never threaded through the API

`registerDictionary` and `t` both read `pluginName` from the SDK factory closure. The plugin never passes its own name.

**Rationale:** Matches the rest of the SDK (`actionId(key)` → `plugin:<name>:<key>`; `addInstruction(role, filename, content)` → file path includes `<name>__`; `watchFile(path)` → resolves under `data/plugins/<name>/`). Keeping the namespace implicit removes a class of bugs where plugin A could accidentally read plugin B's strings.

**Trade-off:** Plugins can't share a common dictionary. We don't have a use case for this today — every plugin's user-facing strings are inherently plugin-specific.

### Decision 3: Indirection module inside the trivia plugin (`i18n/t.ts`)

Mirror the existing `core/pluginLogger.ts` pattern: a small module-level singleton that `triviaPlugin()` initializes once with `sdk.t`, then re-exports a `t()` function for the rest of the plugin to import.

**Rationale:**
- Plugin utility functions (e.g. `renderHidden` in `roster.ts`) don't have direct SDK access. Adding an `sdk` or `t` parameter to every helper signature is noisy and changes a lot of call sites.
- The same indirection already exists for the logger — adopting it for i18n keeps the plugin internally consistent.

**Trade-off:** Tests that bypass `triviaPlugin()` must initialize the t-singleton (or rely on a no-op fallback). The logger module solved this with a no-op default; we'll do the same — `t(key)` without an init returns the EN value directly so tests stay green without setup.

### Decision 4: SDK reads `getConfig().language` directly

The SDK is the plugin-boundary layer; it's allowed to import from the bot core. We do this here for the same reason the SDK imports `../logger.js`, `../roles.js`, `../cronJobs.js`, etc.

**Rationale:** Threading the language through `ClackSdkDeps` would force every test and lifecycle caller to supply it. The existing `t()` reads from `getConfig()` with a try/catch that defaults to `"en"` — we copy that pattern so SDK construction at module-load time (before config is loaded) is safe.

**Trade-off:** Plugin-SDK unit tests that change the active language need a hook. We expose the same `_setLanguageOverrideForTesting` pattern indirectly via the SDK's own internals, or simply spy on `getConfig` in tests where it matters.

### Decision 5: Judge prompt adds ONE rule, near the existing leniency block

The judge already accepts typos, synonyms, alt spellings, and DATE FORMS leniently. We add a single "LANGUAGE" rule alongside those: a correct answer typed in any natural language is acceptable when it unambiguously translates to `expectedAnswer` or any `acceptableAnswers` entry. The existing multiple-guess / too-broad / tolerance rules are unchanged.

**Rationale:** Smallest possible blast radius. The judge is a black-box LLM with carefully tuned rules; adding language-agnosticism as one focused bullet is safer than re-architecting the prompt.

**Trade-off:** No formal evaluation of FR-EN cross-grading accuracy in this change. We rely on Haiku 4.5's known multi-lingual capability and accept that an admin can tighten or relax via `gradingNotes` per question.

## Risks / Trade-offs

- **Risk:** Plugin authors register a dictionary with a key whose name collides with an existing translation file's key (no collision is actually possible across plugins thanks to scoping, but readers may be confused).  
  → Mitigation: SDK doc-comments make scoping explicit; the parity test prints `[trivia]: key "foo" missing in fr` rather than just `key "foo" …`.
- **Risk:** Tests that don't init the plugin (e.g. `roster.test.ts`) get the no-op singleton, which returns the EN value — assertions that hard-code "Answered" keep passing but assertions on French behavior need explicit setup.  
  → Mitigation: Add a `_setTriviaT` test hook on the indirection module, identical to `_setTriviaLogger`.
- **Risk:** Reveal-time judge starts accepting plausible-but-wrong translations (e.g. "Empire britannique" for an "Empire ottoman" question).  
  → Mitigation: The new rule says "unambiguous translation of `expectedAnswer` / `acceptableAnswers`". Ambiguous matches stay at `correct: false`. Tests assert the rule wording explicitly forbids ambiguous cross-language matches.
- **Risk:** Existing scheduledPrompts.ts inlines English labels with FR-via-prompt instructions ("NEW SEASON" / "NOUVELLE SAISON"). This change does NOT migrate those to `sdk.t()`.  
  → Mitigation: Out of scope; covered in proposal Non-Goals. The two patterns coexist — `sdk.t()` for TS-rendered text, LANGUAGE directive for Claude-rendered text.

## Migration Plan

- No runtime migration. The new SDK methods are additive; existing plugins ignoring them keep their current behavior.
- No data migration. No config schema change.
- Rollback: revert the change; trivia's roster footer goes back to hardcoded English, judge goes back to language-agnostic-only-by-accident behavior. Safe.
