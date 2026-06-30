## Why

When Claude hits an internal/operator-facing failure mid-run (a tool error it can't recover from, a misconfiguration, a missing credential), today's guidance (`tool-errors.md`) tells it to "report the failure honestly in your `submit_response`" — so the diagnostic lands in front of the end user, who can do nothing about it. The only push-to-owner channel that exists (`quarantineNotifier`) is hardwired to the worker-quarantine event, and Claude has no way to reach the owner at all (`channelResolver` rejects any DM target except the requester). Operators only learn of these failures by pulling `admin_list_error_reports` after the fact — and in channelless cron runs (trivia, idler) nobody is watching at all.

## What Changes

- Add an optional `escalate_to_owner` string field to the `submit_response` tool schema, available in **every** trigger context (not gated like the multi-message fields).
- When set, the delivery layer (`handleSuccess` in `handlerResponse.ts` — the single path both interactive and channelless-cron runs flow through) splits the response by audience: the user sees only Claude's short acknowledgement `blocks`; the **owner** is DMed the diagnostic carried in `escalate_to_owner`, enriched with session/user/channel context.
- Each escalation also writes an `errorReport` to disk, so soft-fail escalations appear in `admin_list_error_reports` alongside hard failures (push-to-owner and pull-for-admin stay consistent).
- Extract the owner-DM plumbing (`getOwnerUserId` + `sendOwnerDm`) into a shared `src/slack/ownerDm.ts`, used by the two core callers: `quarantineNotifier.ts` and the new escalation handler. (The plugin SDK's `dmOwner` is a near-identical third copy but is left as-is — it has a different injectable-deps seam and a per-stage `Result` contract; see design D6.)
- Update `tool-errors.md`: for internal/system failures the user can't act on, escalate via `escalate_to_owner` and keep `blocks` to a short "I hit a problem — I've notified the owner" acknowledgement; all technical detail goes in the field. Normal outcomes ("no results", "can't do that here") stay in `submit_response` as today.
- No-owner / DM-failure fallback: log a warning, still write the `errorReport`, user still sees the acknowledgement — never fall back to dumping the diagnostic to the user.

Out of scope (noted as follow-ups): redirecting the **hard-fail** path (`handleError` / `sendErrorsAsDM`) at the owner; worker-mode escalation (worker has no `submit_response`).

## Capabilities

### New Capabilities
- `owner-error-escalation`: Claude-driven escalation of operator-facing failures — the `escalate_to_owner` field on `submit_response`, the audience split in the delivery layer, the owner DM, and the disk-record interplay with error reports.

### Modified Capabilities
<!-- None. error-reporting's writeErrorReport is reused without changing its requirements; the field-addition follows the per-field capability precedent (submit-response-deliver-to, submit-response-mode). -->

## Impact

- **Schema:** new optional `escalate_to_owner` field across the `submit_response` schema variants (`submitResponse.ts`), threaded `SubmitResponseArgs → SubmitResponsePayload → ResponseCapture → ClaudeResponse`.
- **Delivery:** new post-delivery branch in `handleSuccess` (`handlerResponse.ts`); mirrors how `attention_level` / `delivery_mode` are surfaced and acted on. Covers interactive and channelless-cron paths.
- **New module:** `src/slack/ownerDm.ts` (extracted owner-DM core); `workers/quarantineNotifier.ts` refactored to consume it. `plugins/sdk.ts#dmOwner` left separate (different seam — see design D6).
- **Reuse:** `errorReports.ts#writeErrorReport`; `roles.ts#loadRoles().owner`; `channelResolver.openDmChannel`.
- **Instructions:** `data/default_configuration/user/tool-errors.md`.
- **i18n:** owner-DM scaffolding strings (header/labels) added to `en.ts` + `fr.ts`; the diagnostic body and the user acknowledgement stay on their existing paths (Claude-authored).
- **Tests:** escalation split + no-owner fallback + report write; quarantine notifier still works after extraction.
