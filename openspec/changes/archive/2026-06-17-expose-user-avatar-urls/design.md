## Context

Clack discards Slack avatar URLs at the fetch boundary. `usersCache.ts:toUserEntry` keeps only `userId`, `username`, `displayName` from each `users.list` member; `find_user` passes those entries through verbatim. Meanwhile the `gemini-image` plugin's `generate_image` tool already accepts `input_image_url` as "a Slack image's url_private (or any image URL) to EDIT", and `downloadImageAsBase64` already follows redirects / handles plain public URLs. The only missing piece is surfacing the avatar URL to Claude.

## Goals / Non-Goals

**Goals:**
- Make a user's public profile picture URL available to Claude on demand via `find_user`.
- Keep the change additive — no behavior change for existing `find_user` callers beyond an extra field.

**Non-Goals:**
- Pushing avatar URLs into ambient prompt context (the per-message speaker label in `promptBuilder.ts`). Deferred — taxes every prompt; revisit if "an image of me" becomes a common reflex.
- Any change to the `gemini-image` plugin (it already accepts any URL).
- Re-hosting, caching, or proxying the image bytes — the upstream Slack CDN URL is passed as-is.
- A consent gate or per-user opt-out.

## Decisions

- **Pull, not push.** Expose the avatar through `find_user`'s result rather than injecting it into every prompt. On-demand, scales to any workspace member, and costs nothing when no image is requested. (Alternative — push via `formatSpeaker` — only covers thread participants and bloats every prompt.)
- **Single resolved field `avatarUrl = profile.image_original ?? profile.image_512`.** `image_512` is always synthesized by Slack so the field is never empty; `image_original` is higher fidelity but exists only for custom uploads. Resolving at the cache boundary means Claude never reasons about which field exists. (Alternative — expose the full `image_*` bag or both sizes — adds noise with no current consumer for the smaller sizes.)
- **No consent gate.** Slack profile pictures are already public to the workspace, and any user who can call `find_user` already sees these people. The intended use is light/funny face edits.
- **Tool-description nudge.** Add a sentence to `find_user`'s description that the `avatarUrl` can be passed to an image tool as a source/edit image, so Claude links discovery → edit. The gemini description says "uploaded image"; the nudge clarifies an avatar URL is equally valid.

## Risks / Trade-offs

- **Default avatars are generic.** Users without a custom photo get a Slack-generated placeholder (initials/gravatar). Editing those is pointless but harmless — no special handling.
- **Misuse (unflattering/mocking edits of real people).** → Out of scope to police technically; avatars are already public and the gemini output carries an explicit "AI-GENERATED, not a real person" provenance contract. Behavioral norms, not a code gate.
- **Upstream URL longevity.** Slack avatar URLs change when a user updates their photo. → Acceptable: the URL is fetched fresh per `find_user` call (cache is process-lifetime), and it's only ever used immediately as an edit source.

## Migration Plan

Additive, no data migration. New `avatarUrl` field appears on `find_user` results after deploy. Rollback is reverting the two files; existing consumers ignore the extra field.

## Open Questions

None.
