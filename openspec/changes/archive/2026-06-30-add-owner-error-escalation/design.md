## Context

"Something went wrong" in Clack splits along two axes — *who detects it* (the harness vs. Claude mid-run) and *who is told* (user vs. owner vs. admin-on-pull):

```
                              WHO IS TOLD?
                  USER             OWNER            ADMIN (pull)
              ┌──────────────┬─────────────────┬──────────────────┐
 HARD fail    │ sendError-   │                 │ errorReports.ts  │
 (harness:    │ ReportDM     │     (empty)     │ admin_list/read  │
 SDK crash /  │ opt-in:      │                 │ (admin+, PULL)   │
 !success)    │ sendErrors-  │                 │ always written   │
              │ AsDM         │                 │                  │
              ├──────────────┼─────────────────┼──────────────────┤
 SOFT fail    │ tool-errors  │   THIS CHANGE   │  (not captured   │
 (Claude hits │ .md: "report │                 │   today)         │
 isError,     │ in submit_   │                 │                  │
 can't fix)   │ response"    │                 │                  │
              └──────────────┴─────────────────┴──────────────────┘
```

The SOFT-fail → OWNER cell is structurally empty: only Claude knows mid-run that a failure is operator-facing, and from the harness's view such a run *succeeded* (Claude called `submit_response`). No harness/pull mechanism can fill this cell — it requires a Claude-driven signal. Claude also has no capability to DM the owner today (`channelResolver.resolveChannelId` rejects non-self DM targets).

Existing surfaces this change relates to:
- `errorReports.ts` — `writeErrorReport`/`listErrorReports`/`readErrorReport`; durable record of hard failures, surfaced via `admin_list_error_reports` / `admin_read_error_report`.
- `handlerResponse.ts` — `executeAndDeliver` → `handleSuccess`/`handleError`; the single delivery path for interactive **and** channelless-cron runs (cron → `processMessage` → `executeAndDeliver`).
- `workers/quarantineNotifier.ts` — the only owner-DM code today (`loadRoles().owner` → `openDmChannel` → `postMessage`), private to that file.
- `tool-errors.md` — the instruction whose current step 3 produces today's wrong behavior.

## Goals / Non-Goals

**Goals:**
- Give Claude a way to escalate an operator-facing failure to the owner instead of the user, in one terminal call.
- Cover both interactive and channelless-cron runs through a single hook point.
- Keep operator escalations consistent with the existing admin pull-surface (they become error reports too).
- The user always learns a DM was sent (never sees the raw diagnostic).

**Non-Goals:**
- Redirecting the hard-fail path (`handleError` / `sendErrorsAsDM`) at the owner — separate follow-up.
- Worker-mode escalation — worker context has no `submit_response`.
- Escalating to "all admins" — owner-only for now (matches `quarantineNotifier`); target can broaden later.
- Changing `error-reporting`'s own requirements — `writeErrorReport` is reused as-is.

## Decisions

### D1: A field on `submit_response`, not a separate `notify_owner` tool

`escalate_to_owner?: string` rides the rail `attention_level` / `delivery_mode` already use (schema → `SubmitResponsePayload` → `ResponseCapture` → `ClaudeResponse` → acted on in `handleSuccess`).

- **Why over a separate tool:** `submit_response` is mandatory and terminal, so the user reply and the owner diagnostic are populated atomically — Claude cannot half-escalate (call the tool then forget to reply, or reply then forget to escalate). One call, two audiences, can't desync.
- **Alternative considered — `notify_owner(message)` tool:** composable and reusable mid-run, but two separate calls Claude must remember to pair, and it bloats the tool surface. Rejected for the atomicity of the single terminal call.
- **Precedent:** prior `submit_response` field-additions each became their own capability (`submit-response-deliver-to`, `submit-response-mode`) rather than mutating a base — this follows that.

### D2: Split in `handleSuccess`, one place for all triggers

The audience split lives in `handleSuccess` (`handlerResponse.ts`), after primary delivery. Because cron delivery also routes through `executeAndDeliver`/`handleSuccess`, this single branch covers interactive DMs/mentions/reactions **and** channelless crons with no extra wiring.

- The branch is **not** conditional on `alreadyDelivered`: a channelless cron may post no primary at all (`optional-post-to` schema, possibly `skip_response`), yet must still escalate — that is the case where a silent failure hurts most.

### D3: Field present in every schema variant, including the skip/post-to variants

`escalate_to_owner` is added to all `submit_response` schema variants and is **compatible with `skip_response`** — a cron run can decline a user-facing message yet still escalate. Unlike the multi-message fields it is not trigger-gated; the rule is general.

### D4: Claude writes both halves; the field carries only the diagnostic

`blocks` = the short user acknowledgement (Claude-authored, already localized via the language directive). `escalate_to_owner` = all technical detail. The `tool-errors.md` contract states explicitly: when escalating, `blocks` contains only the acknowledgement; every diagnostic detail goes in the field. This structurally prevents the diagnostic from leaking into the user message.

### D5: Escalation also writes an error report (push + pull unified)

When `escalate_to_owner` fires, the handler calls `writeErrorReport(...)` with the diagnostic, session id, conversation trace, and tool-call history available on the response. Soft-fail escalations thus appear in `admin_list_error_reports` next to hard failures — one source of truth for "things that broke," whether the operator was pinged live or looks later.

### D6: Extract owner-DM plumbing to `src/slack/ownerDm.ts` — shared by the two core callers

The same `getSlackClient → loadRoles().owner → openDmChannel → postMessage(unfurlOptions)` flow exists in three places: the private defaults inside `quarantineNotifier.ts`, the escalation handler (new), and the plugin SDK's `dmOwner` (`sdk.ts:1258`). Extract the core into `src/slack/ownerDm.ts` (`getOwnerUserId` + `sendOwnerDm`, best-effort boolean) and route the two **core** callers through it:

- `quarantineNotifier` imports them (its `QuarantineNotifierDeps` injection seam is unchanged).
- The escalation handler imports them.

**`sdk.dmOwner` is intentionally left separate.** It sits on a different, deliberate seam: it takes injectable low-level deps (`getSlackClient`/`loadRoles`/`openDmChannel` via `ClackSdkDeps`, so plugin tests can mock each) and returns a `Result` with **per-stage** error messages (no client / no owner / open-failed / post-failed), asserted by six `sdk.test.ts` cases. The shared `ownerDm.ts` uses module-level imports and a best-effort boolean that collapses the open-vs-post distinction. Forcing `dmOwner` onto it would either break the SDK injection seam (and those tests) or discard its granular errors — net negative. The duplication here is shallow (~10 lines) and the contracts genuinely differ, so the SDK keeps its own copy. (If a future change needs to unify, the move is to give `ownerDm.ts` an injectable-deps + discriminated-result contract — out of scope here.)

The owner-DM message is composed with `t()` scaffolding (header/labels, en+fr) wrapping the Claude-authored English diagnostic body, mirroring how `quarantineNotifier` builds its DM.

### D7: No-owner / DM-failure fallback degrades safely

If no owner is configured or the DM post fails: log a warning, still `writeErrorReport`, and let the user's acknowledgement stand. Never fall back to surfacing the diagnostic to the user — that would defeat the rule. (The acknowledgement may then slightly over-promise "I notified the owner," accepted as the lesser evil; revisited only if it proves confusing.)

## Risks / Trade-offs

- **Claude leaks diagnostic into `blocks` anyway** → the field + a crisp `tool-errors.md` contract make the right path the easy path; the diagnostic has a dedicated home so there's no reason to inline it. Residual risk is prompt-adherence, same class as any instruction.
- **Over-escalation (pinging the owner for ordinary failures)** → instruction scopes escalation to internal/system failures the user can't act on, and explicitly excludes "no results"/"can't do that"; the field is opt-in per call.
- **Acknowledgement promises a DM that didn't send (no owner / post failure)** → D7 keeps the failure observable via the always-written report; message wording kept generic.
- **Schema surface grows** → one optional string across variants; threads through the same plumbing as existing optional fields, low blast radius.

## Migration Plan

Pure addition — no data migration. The field is optional and absent-by-default, so existing behavior is unchanged until Claude (guided by the updated instruction) uses it. The `quarantineNotifier` extraction is a behavior-preserving refactor covered by its existing tests. Rollback = revert; no persisted state depends on the field.

## Open Questions

- Should the user-facing acknowledgement be fully Claude-authored (flexible phrasing) or backed by a `t()` template for guaranteed consistency? Current decision: Claude-authored (D4). Revisit if phrasing drifts.
- Future: unify the hard-fail path by pointing `sendErrorsAsDM` (or a new owner variant) at the owner, so both failure classes share one escalation policy.
