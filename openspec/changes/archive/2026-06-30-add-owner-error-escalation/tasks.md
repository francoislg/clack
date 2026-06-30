## 1. Extract owner-DM plumbing

- [x] 1.1 Create `src/slack/ownerDm.ts` exporting `getOwnerUserId(): Promise<string | null>` and `sendOwnerDm(ownerUserId, text, options?): Promise<boolean>`, moved from the private defaults in `workers/quarantineNotifier.ts` (best-effort, never throws)
- [x] 1.2 Refactor `workers/quarantineNotifier.ts` to import `getOwnerUserId`/`sendOwnerDm` from `ownerDm.ts`; `defaultQuarantineNotifierDeps` now references them; remove the in-file copies (`defaultGetOwnerUserId`/`defaultSendOwnerDm`) and the imports they alone used (`errorMessage`, `loadRoles`, `getSlackClient`, `openDmChannel`, `unfurlOptions`)
- [x] 1.3 Verify the existing `quarantineNotifier` tests still pass (behavior-preserving refactor); add a focused unit test for `ownerDm.ts` (no owner → null; no client → false; post failure → false). (`sdk.dmOwner` is intentionally left separate per design D6 — no code change there.)

## 2. submit_response schema + payload threading

- [x] 2.1 Add optional `escalate_to_owner` string field to every `submit_response` schema variant in `tools/presentation/submitResponse.ts` (including the skip-only and optional-post-to variants), accepted alongside `skip_response`
- [x] 2.2 Thread the value through `SubmitResponseArgs → SubmitResponsePayload`, and surface it on the success result so it reaches `ResponseCapture` and `ClaudeResponse` (mirror how `attention_level` / `delivery_mode` flow)
- [x] 2.3 Add `escalateToOwner` to `ClaudeResponse` and ensure `ResponseCapture` getter exposes it to `handlerResponse`

## 3. Audience split in the delivery layer

- [x] 3.1 In `handlerResponse.ts#handleSuccess`, after primary delivery, add a branch that runs when `response.escalateToOwner` is set — NOT conditional on `alreadyDelivered` (channelless runs may post no primary)
- [x] 3.2 Compose the owner DM: `t()` scaffolding (header + session/user/channel context labels) wrapping the Claude-authored diagnostic body; send via `sendOwnerDm(owner, text, { suppressUnfurls: true })`
- [x] 3.3 On escalation, call `writeErrorReport(...)` matching the existing `ErrorReport` zod shape in `errorReports.ts` (`sessionId`, `errorMessage` = the diagnostic, `conversationTrace` — required, use the response's trace or `[]`, `toolCallHistory` if present, `timestamp`) so it lands in `admin_list_error_reports`
- [x] 3.4 No-owner / DM-failure fallback: log a warning, still write the error report, leave the user acknowledgement intact — never surface the diagnostic to the user
- [x] 3.5 Wire any new `handleSuccess`/`HandlerResponseDeps` dependencies (`sendOwnerDm`, `getOwnerUserId`, `writeErrorReport` already present) into `defaultHandlerResponseDeps`

## 4. Instructions + i18n

- [x] 4.1 Update `data/default_configuration/user/tool-errors.md`: for internal/system failures the user can't act on, escalate via `escalate_to_owner` with the diagnostic and keep `blocks` to a short "owner notified" acknowledgement; normal outcomes (no results, unsupported request) stay in `submit_response` as before
- [x] 4.2 Add owner-DM scaffolding strings (header + context labels) to `src/i18n/strings/en.ts` and `src/i18n/strings/fr.ts` with distinct FR translations (parity test must pass)

## 5. Tests + verification

- [x] 5.1 Unit test the audience split: `escalate_to_owner` set → owner DM sent with diagnostic, user message free of diagnostic, error report written (mock `sendOwnerDm`/`writeErrorReport` at the deps boundary)
- [x] 5.2 Unit test fallbacks: no owner configured → warning + report written + user acknowledgement intact; owner DM fails → same
- [x] 5.3 Unit test that `escalate_to_owner` is honored alongside `skip_response` (channelless path) and that an absent field changes nothing
- [x] 5.4 Run `npx tsc`, `npx oxlint`, `npx oxfmt --check`, and `npm test`; fix any failures
- [x] 5.5 Run `openspec validate add-owner-error-escalation --strict`
