## Why

When a verified admin corrects Clack — e.g. "that question wasn't a cheat, reveal it" — Clack often litigates its prior assessment and the admin has to argue across several turns before it complies, even though admin-correction tools (`override_answer`, `remove_cheat`) already exist. Clack is never *told* the requesting user's role in prose, so it can't reason about authority and treats an admin's assertion like any other user's. The role is already resolved deterministically from `roles.json` (keyed on the authenticated Slack user ID), so this trust signal is available and unspoofable — it just isn't surfaced or acted on.

## What Changes

- Surface the requesting user's **verified role** to Claude in the prompt as a fact sourced from `ctx.role` (never from message text), so Claude knows when it is talking to an admin/owner.
- Add an always-on **deference posture** directive: when a verified admin or owner asserts a correction, override, or judgment call, Clack defers and acts rather than re-arguing its prior position. The phrase "as admin" / "en tant qu'admin" (any language) is recognized as a natural intensifier of this intent, not a required gate.
- The posture is **global** (applies across all subsystems, not just trivia) and is bounded: it relaxes epistemic stubbornness and hedging toward verified admins; it does NOT relax the security boundary, role-permission gating, or destructive-action safety that lives in code.
- Members and devs see no behavioral change — a non-admin claiming "I am admin" in text changes nothing, because the role is not read from the message.

## Capabilities

### New Capabilities
- `admin-deference`: Surfaces the requesting user's verified role into Claude's prompt and instructs Clack to defer to verified admin/owner assertions instead of re-litigating, while preserving the deterministic trust boundary (claims in message text never confer role).

### Modified Capabilities
<!-- None: role gating, tool permissions, and the security boundary are unchanged. -->

## Impact

- **Code:** `src/claude/promptBuilder.ts` (render verified-role line + deference directive in the prompt; role already threaded via `PromptOptions.role` / `buildDeliveryContext`). No change to role resolution, tool gating, or `roles.json`.
- **Instructions:** optional supporting guidance, English-only (via-Claude path), consistent with the existing posture-directive pattern (`DISMISSAL_PHRASES`, attention-level guidance).
- **Behavior:** admins/owners get less-stubborn, less-hedged responses; members/devs unchanged. No new config, no new tools, no migration.
- **Tests:** prompt-assembly unit tests asserting the role line + directive appear for admin/owner and are absent (or member-valued) for member/dev; a trust-boundary test asserting a member's "I am admin" text does not elevate the rendered role.
