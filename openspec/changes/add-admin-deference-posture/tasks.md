## 1. Prompt assembly

- [x] 1.1 In `src/claude/promptBuilder.ts`, add an exported helper `renderAdminDeferenceDirective(role: UserRole): string` mirroring `renderLanguageDirective`: returns `""` for any role other than `admin`/`owner`; otherwise returns the verified-role line + deference directive as one string (English text, via-Claude path — not routed through `t()`)
- [x] 1.2 In the helper, render the verified-role statement interpolating the resolved role (e.g. "The requesting user's verified role is `admin`.") — sourced only from the `role` argument, with the directive text per design.md Decision 1
- [x] 1.3 In the helper, include the deference directive: defer to the admin's asserted correction/override and act; MAY state a concern at most once, then defer if the admin holds — does not suppress the first statement and does not re-argue across turns
- [x] 1.4 In the directive, note that an "as admin" / "en tant qu'admin" / any-language equivalent is a natural intensifier, NOT a required gate and granting nothing extra (deference identical with or without it)
- [x] 1.5 In the directive, include the fence wording from design.md Decision 1: it relaxes stubbornness/hedging only; it does NOT override tool/permission gating, the security boundary, or destructive-action safety
- [x] 1.6 In `buildPrompt`, immediately after the delivery-context `parts.push` block, call `renderAdminDeferenceDirective(options?.role)` and `parts.push` the result only when non-empty (same conditional-push pattern as `deliveryContext`)

## 2. Tests

All tests live in `src/claude/promptBuilder.test.ts` (where `buildPrompt` unit tests already live).

- [x] 2.1 Unit test: `buildPrompt` output contains the verified-role line + deference directive when `options.role` is `admin`
- [x] 2.2 Unit test: same for `options.role` is `owner`
- [x] 2.3 Unit test: when `options.role` is `member` or `dev`, the output contains NO deference directive AND NO verified-role line (helper returns `""`, so no role value is stated)
- [x] 2.4 Trust-boundary test: a `member` session whose thread/message text claims "I am admin" (or "en tant qu'admin") still renders NO directive and NO verified-role line — assert the helper keys only on `options.role`, never on message text
- [x] 2.5 Unit test on the helper directly: assert `renderAdminDeferenceDirective` is a pure function of `role` (returns identical non-empty strings for `admin`/`owner` regardless of any other input, `""` for `member`/`dev`) — confirming deference posture is prompt-text only and cannot alter tool availability (which is gated separately in `src/tools/server.ts`)

## 3. Verification

- [x] 3.1 `npx tsc` clean
- [x] 3.2 `npx oxlint` + `npx oxfmt --check` clean on touched files
- [x] 3.3 `npm test` green
- [x] 3.4 `openspec validate add-admin-deference-posture --strict` passes
