## Why

Clack can now generate and edit images (the `gemini-image` plugin), and its `generate_image` tool already accepts any image URL as the edit source (`input_image_url`) — `downloadImageAsBase64` handles plain public URLs. But Claude has no way to learn a Slack user's avatar URL: both user caches fetch from Slack and immediately discard `profile.image_*`. So a request like "take Mike's profile picture and make it look like a wizard" can't be fulfilled — the one missing wire is exposing the avatar URL.

## What Changes

- `UsersCache` (backing `find_user`) extracts and caches an `avatarUrl` per member, resolved as `profile.image_original ?? profile.image_512` — `image_512` is always present (Slack synthesizes it), `image_original` exists only for custom uploads, so the fallback is never empty.
- The `find_user` tool result includes `avatarUrl` on each returned user, alongside the existing `userId`, `username`, `displayName`.
- The `find_user` tool description notes the avatar can be passed to an image tool as a source/edit image, so Claude connects "find the user" → "edit their picture."
- No consent gate: Slack profile pictures are already public to the workspace, and the intended use is light/funny face edits.

## Capabilities

### New Capabilities
<!-- None — this extends an existing tool's output. -->

### Modified Capabilities
- `find-user-tool`: `UsersCache` now extracts `avatarUrl` per member, and the `find_user` result shape gains an `avatarUrl` field.

## Impact

- **Code:** `src/slack/usersCache.ts` (`SlackUserEntry` + `toUserEntry`), `src/tools/query/findUser.ts` (tool description only — it already passes cache entries through verbatim).
- **Consumers:** Claude + the existing `gemini-image` `generate_image` tool (`input_image_url`). No code change to the gemini plugin — it already accepts any URL.
- **No new dependencies, env vars, or config.**
- **Privacy:** exposes the public Slack avatar URL of any matched workspace member to any user who can already call `find_user` (avatars are public in Slack).
