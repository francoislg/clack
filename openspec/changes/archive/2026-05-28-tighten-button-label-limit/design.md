## Context

`submit_response` is the MCP tool through which Claude delivers structured Slack messages. It exposes ten action types (`followup`, `choice`, `post_to`, `change`, `config_update`, `update`, `skill_create`, `skill_update`, `skill_disable`, `skill_restore`), each with a `label` field that becomes the `text` of a Slack Block Kit `button` element.

Today:

- All ten label fields are declared as bare `z.string()` in `src/tools/presentation/submitResponse.ts` — no `.max()`, no length hint in `describe()`.
- A single render-time validator (`validateActionButtonLabels` in `src/slack/blocks.ts`) enforces Slack's 75-char API limit and runs from two call sites in `submitResponse.ts` (primary and `post_to`).
- Hardcoded defaults injected by `defaultActionLabel` (`blocks.ts:25–48`) are all ≤14 chars today.

The visual truncation point in Slack's client is ~40 chars (varies with row count and viewport, but 40 is a safe floor for a single-row, desktop layout). The 75-char API limit is therefore much looser than what users can actually read.

## Goals / Non-Goals

**Goals:**

- Hard-reject any Claude-authored label > 40 chars at schema parse time, so Claude immediately sees the constraint and retries.
- Surface the constraint in the schema `describe()` so Claude has the budget up front and self-corrects without round-trips.
- Keep `validateActionButtonLabels` as a runtime guarantee for any path that bypasses the Zod schema (e.g. `defaultActionLabel`, future programmatic button construction).
- Lock in the safety of current defaults with a regression test.

**Non-Goals:**

- Row-aware caps (e.g. `40 / n_buttons`). A flat 40 is the floor; per-row tuning can come later if needed.
- Truncation/auto-shortening fallback. The user wants Claude to *know* the label was rejected, not silently see a clipped version.
- Localization of `defaultActionLabel` (a separate concern; tracked under the i18n direct-path rule).
- Validating dev-authored buttons elsewhere (Home Tab, retry button, change-thread actions). They are statically tested and short.

## Decisions

### Decision 1: Schema-level hard reject via shared helper

Define a single helper:

```ts
export const SLACK_BUTTON_LABEL_MAX = 40;
const buttonLabelSchema = z
  .string()
  .max(SLACK_BUTTON_LABEL_MAX)
  .describe(
    `Button label. MAX ${SLACK_BUTTON_LABEL_MAX} characters — Slack truncates longer labels in the UI.`,
  );
```

Reuse it on all ten label fields (required on `followup`/`choice`, optional elsewhere via `.optional()`).

**Why this over per-field literals (`z.string().max(40)` ten times):**

- Single source of truth for both the limit and the constraint-describing text.
- Future tweaks (e.g. tightening to 35 or adding row-aware logic) happen in one place.
- Reduces drift between the describe-text Claude reads and the actual limit Zod enforces.

**Why this over a more permissive schema with runtime-only enforcement:**

- The user explicitly chose hard reject. Schema rejection gives Claude an immediate, structured error inside the tool-call loop, so it can retry with a shorter label in the same turn rather than discovering the problem only at delivery time.

### Decision 2: Tighten `SLACK_BUTTON_LABEL_LIMIT` from 75 → 40

`validateActionButtonLabels` in `src/slack/blocks.ts` keeps the same shape but uses the new limit. It is now redundant with the schema for Claude-authored labels — but remains the only guard for:

- Labels injected by `defaultActionLabel` when a tool call omits `label`.
- Any future code path that constructs action buttons programmatically.

The constant SHALL be exported (it already is implicitly via `SLACK_BUTTON_LABEL_LIMIT`) and SHALL be shared with the Zod helper to keep schema and runtime in lockstep.

### Decision 3: Regression test on `defaultActionLabel`

A unit test SHALL iterate every action type the function handles and assert the returned string length is `≤ SLACK_BUTTON_LABEL_MAX`. This catches future regressions where a new action type ships with a default label that quietly drifts past 40 chars (e.g. when the defaults eventually move through `t()` and a French translation lengthens them).

### Decision 4: Update the existing spec scenario (75 → 40)

The existing scenario in `clack-tool-response` (line 622: "button label inside `post_to.actions` exceeds Slack's 75-char limit") becomes "exceeds the 40-char Slack visibility limit." A new top-level scenario covers the same for direct `submit_response.actions`. The spec gains an explicit requirement for the cap, where today there is only an implicit reference via `validateActionButtonLabels`.

## Risks / Trade-offs

- **[Risk] 40 chars is too tight in single-button rows where Slack actually shows ~60 chars.** → Mitigation: accepted trade-off. The user prefers consistent visibility across multi-button rows over headroom in single-button rows. The constant is centralized, so loosening to 45 or making it row-aware is a one-line change.
- **[Risk] Claude bounces a tool call on a 41-char label and burns a turn.** → Mitigation: the schema `describe()` advertises the cap, so Claude internalizes it on the first call. Real-world overshoots should be rare.
- **[Risk] Existing call sites in production logs may have labels currently between 41 and 75 chars; this change rejects them.** → Mitigation: the change is to a Claude-authored tool contract, not user data. Old labels in persisted sessions are not replayed through this validator. No backfill needed.
- **[Risk] Hardcoded defaults stay English — the test passes today but a future i18n pass could push translations past 40 (e.g. `"Apply Update"` (12) → `"Appliquer la mise à jour"` (24) — still fine, but margin narrows).** → Mitigation: the runtime validator covers this gap, and the regression test will fail loudly if any default crosses 40.

## Migration Plan

No data migration. No config migration. Deploy is a code change only.

Rollback: revert the commit. The schema change is fully backward-compatible for any label ≤ 40, which today covers every production call site since the existing 75-char validator has been live and labels longer than 40 would already be truncating visibly.

## Open Questions

None for this iteration. Row-aware caps and label i18n are deferred to separate proposals.
