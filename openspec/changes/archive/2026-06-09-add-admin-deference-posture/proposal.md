## Why

When a verified admin corrects Clack — e.g. "that question wasn't a cheat, reveal it" — Clack often litigates its prior assessment and the admin has to argue across several turns before it complies, even though admin-correction tools (`override_answer`, `remove_cheat`) already exist. Clack is never *told* the requesting user's role in prose, so it can't reason about authority and treats an admin's assertion like any other user's. The role is already resolved deterministically from `roles.json` (keyed on the authenticated Slack user ID), so this trust signal is available and unspoofable — it just isn't surfaced or acted on.

## What Changes

- Detect an **explicit admin-claim keyword** in the user's latest message via a fixed, case-insensitive list: `"as an admin"`, `"as admin"`, `"en tant qu'admin"`, `"je suis admin"`, `"admin:"`, `"sudo"`. Detection keys on the most recent user message only (no stale-latch on earlier thread text).
- When the keyword is present AND the **verified role** (sourced from `ctx.role`, never message text) is `admin`/`owner`: surface the verified role and a **deference directive** — act on the admin's asserted correction/override rather than re-arguing. Bounded to stubbornness/hedging; does NOT relax tool/permission gating, the security boundary, or destructive-action safety.
- When the keyword is present AND the verified role is `member`/`dev`: surface a **not-verified rebuttal** — Claude is told the user is NOT an admin and the claim confers no authority, so it refuses admin deference and admin-gated actions on that basis (silently — no scripted callout). The trust boundary is structural: the branch is decided by the verified role, not the message.
- When no keyword is present, nothing is rendered — an admin's ordinary messages are unaffected (the posture is **gated, not always-on**).
- Allow installations to extend the keyword list via `config.admin.additionalWords` (validated: trimmed/lowercased/deduped, min length 3 to prevent a stray short/empty word matching every message).

## Capabilities

### New Capabilities
- `admin-deference`: Detects an explicit admin-claim keyword in the user's latest message and, gated on the verified role, either defers to a verified admin/owner or rebuts a non-admin's claim — preserving the deterministic trust boundary (claims in message text never confer role).

### Modified Capabilities
<!-- None: role gating, tool permissions, and the security boundary are unchanged. -->

## Impact

- **Code:** `src/claude/promptBuilder.ts` — keyword-detection (`messageClaimsAdmin`), the gated context renderer (`renderAdminClaimContext`), and a latest-user-message helper; wired into `buildPrompt` using `options?.role`. `src/config.ts` — `AdminConfig` + `parseAdminConfig` + `getAdditionalAdminWords`. `src/tools/admin/configSchema.ts` — field doc. No change to role resolution, tool gating, or `roles.json`.
- **Instructions:** English-only (via-Claude path), consistent with the existing posture-directive pattern (`DISMISSAL_PHRASES`, attention-level guidance).
- **Behavior:** admins/owners get less-stubborn responses ONLY when they invoke a keyword; non-admins who invoke a keyword get no authority and Claude is told so; everything else unchanged. No new config, no new tools, no migration.
- **Tests:** unit tests for keyword detection (each keyword, case-insensitivity, curly-apostrophe, negatives), the gated branches (admin+keyword→deference, member/dev+keyword→rebuttal, no-keyword→nothing, system/undefined→nothing), and latest-message scope (no stale latch).
