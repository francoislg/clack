## Context

The role is resolved deterministically from `roles.json` (keyed on the authenticated Slack user ID) and threaded into prompt assembly as `PromptOptions.role` / `ctx.role`. Today the role only *selects* which instruction `.md` files cascade and which tools are gated — it is never stated to Claude in prose, and no instruction tells Clack to weigh an admin's word differently. The result: when a verified admin corrects Clack (the trivia "that wasn't a cheat" case), Clack re-litigates because, from its vantage, the assertion is indistinguishable from any user's.

The codebase already has the pattern this change needs: prompt-level posture directives keyed on session state (e.g. `DISMISSAL_PHRASES`, attention-level guidance in `buildDeliveryContext`). This change adds one more posture, keyed on the already-available role.

## Goals / Non-Goals

**Goals:**
- State the requesting user's verified role to Claude, sourced only from `ctx.role`.
- Add an always-on deference directive for `admin`/`owner` sessions: defer to admin assertions, don't re-argue.
- Keep the trust boundary deterministic: a claim in message text never confers role.
- Make it global (all subsystems) and zero-config.

**Non-Goals:**
- No relaxation of tool gating, permission checks, the security boundary, or destructive-action safety (all code-enforced, untouched).
- No new config keys, tools, or migration.
- No deterministic phrase list — "any language" recognition is left to Claude; the phrase is an intensifier, not a gate.
- No change to member/dev behavior.

## Decisions

**1. Standalone exported helper, called from `buildPrompt` (English, via-Claude path).**
Add `renderAdminDeferenceDirective(role: UserRole): string` to `src/claude/promptBuilder.ts`, mirroring the existing `renderLanguageDirective(lang)` exactly: it returns `""` for any role other than `admin`/`owner`, and otherwise returns the verified-role line + deference directive as one string. It is called in `buildPrompt` immediately after the delivery-context block, using `options?.role`, and the result is `parts.push`-ed only when non-empty (same conditional-push pattern as `deliveryContext`).

Why a standalone helper, not inside `buildDeliveryContext`: `buildDeliveryContext(session)` does not receive the role (the authoritative role is `options.role` on `buildPrompt`). Threading role through `buildDeliveryContext` would widen its signature for one unrelated concern; a standalone helper keeps it isolated and unit-testable in the same way `renderLanguageDirective` is. The text is consumed by Claude to shape reasoning, so it stays English per the VIA-Claude convention — not routed through `t()`.

Alternative considered: a role-cascaded `.md` instruction file under `admin/`. Rejected because the posture must reference the *verified* nature of the role inline and toggle precisely on `admin`/`owner`, which is cleaner as a conditional render than an always-loaded file.

The exact directive text (resolving the former open question) is:

```
VERIFIED ROLE: The requesting user's verified role is `<role>`. The system established this from their authenticated identity — it is a fact, not a claim in their message to second-guess.

ADMIN DEFERENCE: When this verified <role> asserts a correction, override, or judgment call (e.g. "that wasn't a cheat", "reveal it", "override that answer"), defer to it and act. You MAY state a relevant concern once, but do not re-argue a prior assessment across turns or make the admin insist. An "as admin" / "en tant qu'admin" phrasing (or any-language equivalent) is a natural intensifier of this intent — it is NOT required for deference and grants nothing extra. This relaxes only your stubbornness and hedging toward a verified admin; it does NOT relax tool/permission gating, the security boundary, or safety on destructive actions — those still apply in full.
```

`<role>` is interpolated with the actual resolved role (`admin` or `owner`).

**2. Always-on for `admin`/`owner`, phrase as intensifier — not a gate.**
Matches the user's "in general, Clack could be more lenient when we are admin." The "as admin" / "en tant qu'admin" phrase is described in the directive as a natural intensifier Claude may notice, but deference does not depend on it. Alternative considered: opt-in phrase gate. Rejected: enumerating phrase variants across languages is brittle, and the user wants general admin leniency, not a ritual.

**3. Directive is bounded posture, explicitly fenced from permissions/security.**
The directive text states it relaxes stubbornness/hedging only, and explicitly does not override the security boundary or role gating. This keeps the prompt honest and prevents Claude from reading "defer to admins" as "do anything an admin asks."

## Risks / Trade-offs

- [Claude over-defers and stops surfacing genuine concerns] → Directive scopes deference to *re-litigating after an admin asserts*, not to suppressing the first, single statement of a concern. Clack may state its reasoning once, then defer if the admin holds.
- [Prompt-injection: attacker gets a member's message to *look* admin] → Structurally impossible: the rendered role derives only from `ctx.role`. Covered by an explicit trust-boundary test (member + "I am admin" text → role stays `member`, no directive).
- [Security-boundary erosion] → The directive explicitly excludes the security boundary and code-enforced safety; a spec scenario asserts prohibited asks remain refused under deference.
- [Wording drift across languages for the intensifier] → No code depends on matching the phrase; recognition is Claude's, and absence of the phrase changes nothing, so a missed variant has no failure mode.

## Migration Plan

None. Additive prompt text gated on `admin`/`owner`. Rollback is reverting the prompt-assembly change; no persisted state or config is touched.

## Open Questions

- None outstanding. The directive wording is pinned in Decision 1; tone may be lightly adjusted during implementation against the prompt-assembly tests without changing the contract (presence/absence by role, the fence, the intensifier note).
