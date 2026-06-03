## Context

The trivia reveal card (`src/plugins/trivia/revealCards/editCard.ts`) currently appends one button, "See your answer", served by a regex-registered handler (`seeAnswerHandler.ts`) that opens a private read-only modal. We want a second button, "Tell me more", that — instead of a modal — starts a *conversation*: Claude posts interesting details about the question/answer into the question's thread, and the thread stays open for follow-ups.

The hard constraint is the plugin boundary (`src/plugins/CLAUDE.md`): plugins reach the bot only through the SDK. Today the SDK's only Claude entry point is `askClaude` (`sdk.ts:902`), which is single-turn, runs with all real tools disallowed, posts nothing, and creates no session. None of that supports "find details (maybe via WebSearch) and then keep talking." The real machinery for a thread conversation is core's `processMessage` (`src/slack/handlers/core.ts`) — it creates a session, registers the `channel:threadTs` index, and sets `autoResponseActive: true`, which is exactly the auto-follow behavior we want. `processMessage` is core-only, so the SDK must grow a method that wraps it (injected through `ClackSdkDeps`, like `clackQuery`/`getSlackClient`).

Note: the *leniency* of the follow-up gate (biasing thread pre-analysis toward "respond") is deliberately out of scope here — it is being reworked by a separate feature. The "Tell me more" thread auto-follows via the standard thread pre-analysis path.

## Goals / Non-Goals

**Goals:**
- A game/workspace-configurable "Tell me more" button on revealed cards (off by default), modeled on the `allTimeRow` field pattern.
- A reusable SDK primitive (`startThreadConversation`) so any plugin can start a Claude Q&A turn in a thread with a real session + auto-follow.

**Non-Goals:**
- Per-user button state (Slack shared messages have none; removal is global — matches the agreed "one shared conversation").
- A full 5-tier cascade axis for `tellMeMore` (game+workspace only, like `allTimeRow`; not added to `AXIS_REGISTRY`).
- Configurable leniency level or custom prompt (agreed: just `enabled` on/off).
- Any pre-analysis leniency tuning — handled by a separate, later feature.
- A data migration (new optional field; legacy questions without `postedBlocks`/`messageLink` already skip the reveal edit).

## Decisions

### Decision: `startThreadConversation` wraps `processMessage`, not `askClaude`
`askClaude` cannot create a session or use tools, so it can neither auto-follow nor WebSearch. We add `startThreadConversation` to `ClackSdk`, backed by a new optional `ClackSdkDeps.startThreadConversation` bound to core's `processMessage` in the app/lifecycle layer (where `processMessage` and its dep bundle already exist). The SDK method supplies the live Slack client from `getSlackClient()` itself; the plugin passes only `{ channel, threadTs, userId, prompt, additionalSystemPrompt }`. Absent dep → logged no-op (mirrors `requestSoftRestart`).

It runs through the **common chat streamer** — `processMessage` with `silentThinking` left false — so the kickoff looks exactly like a normal user-started conversation: a thinking card streams and resolves into the answer, beneath the visible intro "starter" message. `triggerType: "autoRespond"` is reused (it is the session-creating-in-a-thread trigger, streams by default, and yields `autoResponseActive: true`); the clicking user's id is passed as `userId` so role resolution and provenance are correct.

### Decision: `sendMessage` is a narrow Result-returning post helper
The intro "starter" message is posted via a new `sdk.sendMessage({ channel, text?, blocks?, threadTs?, suppressUnfurls? })` — top-level when `threadTs` is omitted, threaded when given. It returns `{ ok, ts, channel } | { ok: false, error }`, mirrors `dmOwner`'s fail-soft contract, and reuses the existing `getSlackClient` dep (no new wiring). This is the seam that lets plugins post without holding the raw `WebClient`; we are NOT removing `getSlackClient` in this change (plugins still need it for `chat.update`/`views.open`), but `sendMessage` becomes the idiomatic path for plain posts.

- *Alternative — keep using `getSlackClient().chat.postMessage` directly:* workable, but the user wants a first-class two-shape post primitive on the SDK, and it centralizes fail-soft + unfurl handling.

- *Alternative — plugin posts intro then relies on the next human reply to trigger auto-respond:* rejected. No session exists yet, so the first reply matches nothing; and it would never produce the initial details message on its own.
- *Alternative — expose `processMessage` directly:* rejected. Leaks core types/params across the plugin boundary; a narrow purpose-built method is the right SDK surface.

### Decision: `tellMeMore` config follows the `allTimeRow` pattern exactly
`{ enabled: boolean }` at game + workspace tiers, resolved `game → workspace → { enabled: false }` at reveal time by a dedicated `domain/tellMeMore.ts` resolver. Parsed in the trivia config parsers with reject-and-warn on bad shape; settable via `upsert_game`/`set_workspace_config` (omit-keeps, null-clears); surfaced by `list_games` (present-iff-set). Not registered in `AXIS_REGISTRY` (it has no season/slot tier), so it is surfaced by `list_games` explicitly like `allTimeRow`, not via the registry projection.

### Decision: Button rendering + click handler mirror the see-answer pair
`editCard.ts` appends the "Tell me more" button into the same reveal actions block when the resolver returns enabled. A new `revealCards/tellMeMoreHandler.ts` clones `seeAnswerHandler.ts`'s shape (regex registration, questionId extraction, game lookup), and on click: rebuilds the card from `postedBlocks` minus the tell-me-more button (global removal via `chat.update`), posts the localized intro reply tagging the user, then calls `sdk.startThreadConversation`. Registered in `index.ts` beside `installSeeAnswerHandler`. The intro text and button label go through trivia `t()` (en/fr); the prompt/context to Claude stays English.

## Risks / Trade-offs

- **Global button removal means only one "Tell me more" thread per question.** → Agreed intent (one shared conversation; others join the thread). The intro tags the first clicker; later users still reply in-thread.
- **Click race before `chat.update` lands could double-fire.** → Handler treats an already-removed button as a no-op (rebuild from `postedBlocks` is idempotent; guard against posting a second intro/kickoff when the button is gone).
- **`startThreadConversation` becomes public SDK surface other plugins will use.** → Keep the signature minimal and purpose-shaped now; document it. Wrong abstraction is costly later.
- **The thread uses the standard follow-up gate, which may under-engage on casual phrasing.** → Acceptable for now; a separate feature reworks pre-analysis leniency. The thread still auto-follows genuine follow-ups.
- **`processMessage` wiring depends on app-layer dep availability at plugin-load time.** → Inject lazily like `clackQuery`; absent dep is a logged no-op so tests and early boot don't crash.

## Open Questions

- (Resolved) Intro vs details delivery: the plugin posts the intro "starter" via `sendMessage`; Claude's answer follows as the streamed reply.
- (Resolved) `startThreadConversation` is fire-and-forget (`Promise<void>`), logged no-op when unwired.
