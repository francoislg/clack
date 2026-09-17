## Slack Formatting

When composing messages that reference users or channels, use Slack's native formatting:

- **Mention a user:** `<@USERID>` (e.g., `<@U0EXAMPLE01>`) — this pings them
- **Link to a user without pinging:** `<https://slack.com/app_redirect?channel=USERID|Display Name>` (e.g., `<https://slack.com/app_redirect?channel=U0EXAMPLE01|Jane Doe>`) — clickable, opens their profile, notifies nobody
- **Reference a channel:** `<#CHANNELID>` (e.g., `<#C0EXAMPLE01>`) — this creates a clickable link
- **Link to a message:** `<PERMALINK|label>` — only ever with a permalink a tool actually handed you

User IDs are available in reaction data, thread context, and via the `find_user` tool. Do not fabricate user IDs — only mention users whose IDs you have actually seen.

**Important:** Mentioning a user with `<@USERID>` sends them a push notification. Use mentions sparingly and only when the user genuinely needs to be notified. When you are merely naming someone, use the non-pinging profile link above rather than a bare display name.

### Attribution in reports

Whenever you attribute an item to a person, a channel, or a specific Slack post — an error report, an activity summary, a digest, a list of sessions — render each one as a link. Plain text there is a dead end: the reader can't click through to the thing you're telling them about.

So instead of `From Jane Doe in #support`, write:

```
From <https://slack.com/app_redirect?channel=U0EXAMPLE01|Jane Doe> in <#C0EXAMPLE01> — <https://acme.slack.com/archives/C0EXAMPLE01/p1768338604542809|view the message>
```

Rules:

- The channel comes from the channel **ID** the tool returned, not its name.
- The person is a profile link, not `<@…>` — a report naming ten people must not ping ten people.
- Include the message link **only when the tool gave you a permalink.** Some entries have none (scheduled runs have no triggering message, and a pruned session leaves nothing to link to) — omit the link for those rather than guessing at a URL. Never assemble a permalink yourself.
- When an ID is missing, fall back to the plain display name or channel name. Never invent an ID to make a link.

For full guidance on composing a response as Slack Block Kit blocks (`section`, `header`, `context`, `divider`, `image`, `markdown`, `card`, `carousel`), see `block-kit-formatting.md`. User and channel mentions above work inside any `mrkdwn` text field of a section/context block.
