## Context

`migrate-to-agent-messaging` gave agent DM threads a side-panel title via `assistant.threads.setTitle`, sourced from the user's opening message (truncated, set once on thread start). This change swaps that source for a Claude-authored label while keeping the message text as the fallback.

## Why not the SDK's own title

The Claude Agent SDK models a per-session display title, resolved through a fallback chain:

```
SDKSessionInfo.summary  =  customTitle  →  aiTitle  →  firstPrompt
                            (/rename)       (auto-gen)   (first user msg)
```

Clack holds an `sdkSessionId` per thread (`resumeSessionId: session.sdkSessionId`), so it *could* call `getSessionInfo(sdkSessionId).summary`. But for setting a Slack thread title once on open, that path is the weakest:

| source | AI-authored | deterministic | in-band (no 2nd IO) | turn-1 ready |
|---|---|---|---|---|
| SDK `summary` (firstPrompt fallback) | no (= msg) | yes | no (session store) | yes |
| SDK `aiTitle` (auto-gen) | yes | **no** — may not fire headless | no (session store) | **no** — async/deferred |
| `submit_response` param | yes | yes | **yes** (rides on payload) | yes |

Two facts kill the SDK path: (1) `aiTitle` is **not** on `SDKResultSuccess` — it requires a separate `getSessionInfo` read; (2) auto-titling is a background call in the interactive CLI, unverified in Clack's print/streaming mode, so `summary` most likely collapses to `firstPrompt` — which is the first-message text we are trying to improve on. Even if it fired, it is async, so a turn-1 read is unreliable. The `submit_response` param gives the same AI-authored quality with none of these failure modes.

## Decisions

### Gate the field to the `directMessages` trigger

`submit_response` already composes its schema from `deps.allow*` flags (`allowPostTopLevel`, `allowMultiMessage`, …) in `buildSubmitResponseSchema`. Add an `allowThreadTitle` flag set from the trigger in the tool-context builder — `true` only for `directMessages`. Reactions, @mentions, cron, and worker contexts never see the field, so their schemas are unchanged. A persistent thread title has no meaning where there is no ongoing DM thread.

### Flow the value out on the existing payload

`ClaudeResponse.response: SubmitResponsePayload` already carries the parsed `submit_response` args out of `processMessage`. Adding `thread_title?: string` to `SubmitResponsePayload` means the value is available on the return with **no** new plumbing. `classicDm.handleClassicDmEvent` captures the `processMessage` result and passes `threadTitle: result?.response?.thread_title` into the existing `onTurnEnd` hook ctx.

### Precedence + once-on-open (unchanged timing)

The agent `onTurnEnd` hook already sets the title once, on the opening turn (`isThreadStart`). This change only changes the *value*: `claudeTitle ?? firstMessageFallback`, still truncated, still once. Follow-ups never retitle. Both the Claude title and the fallback go through the same best-effort `setTitle` (failures swallowed).

### Language / i18n

`thread_title` is on the **via-Claude** path — Claude authors it and writes it in the configured language via the LANGUAGE directive, exactly like the answer blocks. It is NOT routed through `t()` (that path is for direct-to-Slack strings the core composes). The schema description and the one-line prompt guidance stay English (Claude-facing).

## Risks / Trade-offs

- **Claude omits the field** → falls back to first-message text (today's behavior). No regression, just no upgrade for that turn.
- **Schema surface creep** → mitigated by gating to `directMessages` only; every other trigger's `submit_response` schema is untouched.
- **Assistant mode not covered** → deliberate. `dmType: "assistant"` keeps its message-text title; extending it is a separate change (its title path is Bolt-`Assistant`-middleware-driven, not the shared hook).

## Open Questions

- Should `assistant` mode adopt the same param later? Out of scope here; revisit if the agent version proves out.
- Worth letting Claude *re-title* on a clear topic shift instead of once-on-open? Deferred — once-on-open matches how thread names read; re-titling risks churn.
