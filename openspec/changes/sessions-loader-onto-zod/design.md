## Context

`src/sessions.ts` is the gnarliest validation surface in the codebase and was deliberately excluded from Change 3. Its load path accepts **three on-disk eras** — pre-unified-log (`originalQuestion`/`refinements`/`lastAnswer`/`lastResponse`/`toolCallHistory`), first-wave unified-log (`messages[]` with a deprecated `source:"initial"`), and the current `trigger + messages` shape — and runs ~95 lines of `synthesizeMessagesFromLegacy` (~374–469) reconstructing a synthesized `trigger`, canonicalizing user-message sources (`"initial"`/`"refinement"` → `"reply"`/`"choice"`/`"followup"`), normalizing trigger types (`threadReply` → `autoRespond`, missing reaction emoji), and defaulting `errors`/`threadContext`/`autoResponseActive`. A second-pass shape check (~596–627) accepts missing `trigger`/`messages` and quarantines truly corrupt files. It degrades gracefully (log + quarantine), never throws.

This is the OPTIONAL, gated Change 4 of the sweep. It reuses `src/plugins/zodResult.ts`.

## Goals / Non-Goals

**Goals:**

- Model the three on-disk eras as a zod input union, with `.transform()` chains performing the legacy→modern synthesis, replacing the imperative `synthesizeMessagesFromLegacy` + second-pass check.
- Preserve EXACTLY: all three eras parse to the identical modern `{ trigger, messages, ... }`; corrupt files are quarantined as today; nothing throws.

**Non-Goals:**

- Changing the modern session shape, the quarantine mechanism, or any persisted format.
- Any other loader (Changes 2–3 cover those).
- Shipping at all if byte-parity over the three eras cannot be proven (see Risks).

## Decisions

### Decision 0: Fixtures are synthesized from the existing synthesis tests

Do not assume real on-disk samples for the legacy eras still exist in `data/sessions/`. The characterization fixtures for all three eras are **synthesized from the inputs already exercised by the current `synthesizeMessagesFromLegacy` tests** (and any real modern samples). This makes the gate self-contained and reproducible regardless of what's on disk, and resolves the sourcing question definitively before implementation.

### Decision 1: Input union + transform pipeline

`z.union([preUnifiedZod, firstWaveZod, modernZod])` where each variant `.transform()`s to the canonical `LoadedSession`. The transforms encode the exact synthesis: trigger reconstruction, source canonicalization, trigger-type normalization, default-filling. The union order matters (most-specific modern first, or discriminate on presence of `trigger`/`messages`); the discriminator is whichever field set the current second-pass check keys on.

### Decision 2: Quarantine path preserved verbatim

On `safeParse` failure (none of the union variants match → genuinely corrupt), log + quarantine exactly as the current corrupt-file branch. The schema replaces the *shape recognition + synthesis*, not the quarantine I/O.

### Decision 3: Characterization gate is mandatory and gating

Before any change, capture real fixtures from each era (pre-unified, first-wave, modern) + corrupt samples, snapshotting the exact `LoadedSession` (or quarantine outcome) each produces. The migration must reproduce these byte-for-byte. **If parity cannot be proven, do not ship — leave the hand-rolled synthesis in place.** This change's value (consistency) does not justify risking session restore.

## Risks / Trade-offs

- **HIGHEST risk in the sweep** → easy to drop a synthesis edge case (missing reaction emoji, `initial`/`refinement` source remap, `threadReply`→`autoRespond`, the assistant-first ordering). A regression corrupts restored sessions silently. Mitigation: the mandatory gate (Decision 3) over fixtures from every era + corrupt cases; ship only on byte-parity.
- **Union ambiguity** → an old file could match more than one variant; the discriminator/order must mirror the current precedence (modern shape wins). Tested via the era fixtures.
- **Cost/benefit** → purely a consistency win over working code. Acceptable to abandon if the gate is hard to satisfy; that outcome is a valid result, not a failure.

## Open Questions

- None blocking. Fixture sourcing is resolved by Decision 0 (synthesize from the existing synthesis tests). If real on-disk legacy samples surface, add them to the gate as extra cases — they cannot reduce coverage.
