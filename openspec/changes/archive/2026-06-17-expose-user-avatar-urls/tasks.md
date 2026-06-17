## 1. UsersCache: extract avatarUrl

- [x] 1.1 Add `avatarUrl: string` to the `SlackUserEntry` interface in `src/slack/usersCache.ts`.
- [x] 1.2 Extend the `toUserEntry` member type to include `profile.image_original` and `profile.image_512`, and set `avatarUrl: member.profile?.image_original || member.profile?.image_512 || ""`.

## 2. find_user tool surface

- [x] 2.1 Update the `find_user` tool description in `src/tools/query/findUser.ts` to note each result includes `avatarUrl` and that it can be passed to an image tool (e.g. `generate_image`'s `input_image_url`) as a source/edit image. No handler change needed — entries pass through verbatim.

## 3. Tests

- [x] 3.1 In `src/tools/query/findUser.test.ts` (and/or the usersCache tests), assert `toUserEntry`/`search` populates `avatarUrl` from `image_original` when present, falls back to `image_512`, and yields `""` when both are absent.
- [x] 3.2 Assert a `find_user` result entry carries `avatarUrl` end-to-end.

## 4. Verify

- [x] 4.1 Run `npx tsc` (type-check), `npx oxlint` on changed files, and `npm test`.
- [x] 4.2 `openspec validate expose-user-avatar-urls --strict`.
