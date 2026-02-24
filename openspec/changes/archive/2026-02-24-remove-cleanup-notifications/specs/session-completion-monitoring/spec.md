## REMOVED Requirements

### Requirement: Slack Notification on Auto-Cleanup
**Reason**: The notification messages ("Your PR was merged/closed externally. Session cleaned up automatically.") pollute the Slack thread context. When Claude reads the thread on follow-up interactions, it interprets these messages as "session is closed" and refuses to help the user. The notification provides no actionable value — users already know the PR state from GitHub.
**Migration**: No migration needed. The monitor continues to clean up sessions; it just stops posting to Slack. Existing notification messages already posted to threads remain but will not be posted for future cleanups.
