# Proposal: Add Manifest Generator Script

## Summary

Add a script to generate the Slack app manifest (`slack-app-manifest.json`) from `config.json`, and remove the manifest from git tracking. This ensures the manifest stays in sync with branding configuration while keeping required Slack settings (scopes, events) as sensible defaults.

## Motivation

Currently, `slack-app-manifest.json` is a static file checked into the repository. If someone wants to customize the app name or description, they must manually edit both `config.json` (for reference) and the manifest file. This creates:
- Duplication of branding information
- Risk of config and manifest getting out of sync
- Extra manual step when setting up the bot

## Approach

### Configuration Changes

Add a new `slackApp` section to `config.json` for branding:

```json
{
  "slackApp": {
    "name": "Clack",
    "description": "Ask questions about your codebase using reactions",
    "backgroundColor": "#4A154B"
  }
}
```

### Script Behavior

The script will:
1. Read branding from `config.json` (`slackApp` section)
2. Merge with static defaults for scopes, events, and settings
3. Validate the output using `@slack/web-api` manifest types
4. Write to `slack-app-manifest.json`

### Static Defaults

These remain hardcoded in the script (not configurable):
- **Bot scopes**: `channels:history`, `groups:history`, `im:history`, `mpim:history`, `chat:write`, `reactions:read`, `reactions:write`, `users:read`
- **Events**: `reaction_added`
- **Settings**: socket mode enabled, interactivity enabled

### Git Changes

- Add `slack-app-manifest.json` to `.gitignore`
- Add `npm run manifest` script to `package.json`
- Update README with manifest generation step

## Scope

- **In scope**: Branding config, manifest generation script, validation, git/doc updates
- **Out of scope**: Customizable scopes/events, Slack API deployment

## Risks

- Users with existing setups will need to run `npm run manifest` once after updating
- Manifest regeneration required if config changes (documented in README)
