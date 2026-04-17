## Slack Formatting

When composing messages that reference users or channels, use Slack's native formatting:

- **Mention a user:** `<@USERID>` (e.g., `<@U09FSR0REUQ>`) — this pings them
- **Reference a channel:** `<#CHANNELID>` (e.g., `<#C0A82GNR25V>`) — this creates a clickable link

User IDs are available in reaction data, thread context, and via the `find_user` tool. Do not fabricate user IDs — only mention users whose IDs you have actually seen.

**Important:** Mentioning a user with `<@USERID>` sends them a push notification. Use mentions sparingly and only when the user genuinely needs to be notified. Prefer using display names in plain text when you're just referring to someone without needing to alert them.

For full guidance on composing a response as Slack Block Kit blocks (`section`, `header`, `context`, `divider`, `image`), see `block-kit-formatting.md`. User and channel mentions above work inside any `mrkdwn` text field of a section/context block.
