## 1. Capture the link at record time

- [x] 1.1 In `src/plugins/idler/tools/activity.ts`, update the `record_activity` `detail` field description to require the canonical link to the artifact the action touched (PR URL, Slack thread permalink, or external surface URL).

## 2. Render links and suppress unfurling in the digest

- [x] 2.1 In `src/plugins/idler/prompts/summary.ts`, update the digest-composition step so each reported item renders as a Slack hyperlink `<url|label>` to its artifact when the entry's `detail` carries a link.
- [x] 2.2 In `src/plugins/idler/prompts/summary.ts`, update the delivery step to call `submit_response` with `suppress_unfurls: true`.

## 3. Tests and verification

- [x] 3.1 Update/extend `src/plugins/idler/prompts/summary.test.ts` to assert the prompt instructs link rendering and `suppress_unfurls: true`.
- [x] 3.2 Run `npm test`, `npx oxlint src/plugins/idler`, and `npx tsc` to verify.
- [x] 3.3 Validate the change: `openspec validate idler-summary-links --strict`.
