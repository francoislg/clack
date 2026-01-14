# add-message-mode

## Why
Users want a more conversational way to interact with the bot. Instead of reacting to existing messages, they can:
- Send a direct message to the bot
- @mention the bot in a channel
The bot responds with visible messages (not ephemeral) and automatically continues the conversation in threads.

## What Changes

### New Trigger: Direct Message / @Mention
- Bot listens for `message` events where it's mentioned or in DMs
- Creates a new session for each top-level message
- Posts visible "Investigating..." message that gets updated with the response
- No Accept/Reject buttons - response is immediately visible

### Thread Continuation
- Bot auto-responds to all messages in threads it created
- Continues using the same session for context
- Updates visible messages (not ephemeral)

### Differences from Reaction Mode
| Aspect | Reaction Mode | Message Mode |
|--------|---------------|--------------|
| Trigger | Emoji reaction | DM or @mention |
| Response visibility | Ephemeral until Accept | Immediately visible |
| Buttons | Accept/Reject/Refine/Update | None (auto-visible) |
| Thread follow-up | Manual (re-react) | Automatic |

## Scope
- Add `directMessages.enabled` config option (default: false)
- Add new handler for `message` events (DMs and @mentions)
- Add new handler for thread replies
- Reuse existing session management
- Reuse existing Claude Code integration

## Out of Scope
- Mixing modes (e.g., reaction in a message-mode thread)
- Rate limiting / abuse prevention
- User preferences for mode selection
