## Why

Clack's three trigger modes (reactions, DMs, mentions) are all human-initiated. There's no way to automatically respond alerts from integrations like Sentry, PagerDuty, or other apps that post to Slack channels. Admins should be able to configure rules that automatically trigger Clack when specific messages appear in watched channels — turning alert noise into actionable responses without human intervention.

## What Changes

- New "auto-respond" trigger mode that watches configured channels for matching messages and automatically runs a Clack response
- Rules system stored as runtime state (admin-editable, not deploy-time config) with channel targeting and optional user/bot filters
- Home Tab UI section for admins to create, edit, enable/disable, and delete auto-respond rules
- New `message` event handler that evaluates incoming messages against active rules
- Sessions use a synthetic `"auto-respond"` user identity with user-tier instructions
- Responses posted as threaded replies on the triggering message

## Capabilities

### New Capabilities
- `auto-respond`: Automated response trigger mode — rules engine, message event matching, rule persistence, and Home Tab management UI

### Modified Capabilities
- `home-tab`: New admin-only section for managing auto-respond rules (add/edit/delete/toggle)
- `session-management`: Support for synthetic user identity (no real Slack user) in sessions

## Impact

- **New handler**: `message` event listener in `src/slack/handlers/` — receives all messages in channels where the bot is a member, filters against rules
- **New state file**: `data/state/auto-respond.json` for rule persistence
- **Home Tab**: New section + modal for rule CRUD (channel picker, user picker, enable toggle)
- **Session system**: Minor adaptation to handle synthetic user ID (`"auto-respond"`) that has no real Slack user behind it
- **Slack scopes**: Bot must be a member of watched channels; may need `channels:history` / `groups:history` if not already granted
- **processMessage()**: Used as-is with `triggerType: "autoRespond"` — the message content becomes the response context
