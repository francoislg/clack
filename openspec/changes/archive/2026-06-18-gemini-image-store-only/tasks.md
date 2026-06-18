# Tasks

> Implementation already landed in the working tree ahead of this proposal; the boxes below reflect that. Remaining open work is verification and archiving-with-code at merge.

## 1. Plugin: store-only `generate_image`

- [x] 1.1 Remove `deliver`, `channel`, `thread_ts` from the tool's arg schema.
- [x] 1.2 Replace the channel-upload Slack dep with `store({ filename, data })` calling `files.uploadV2` with **no** `channel_id`.
- [x] 1.3 Return a text envelope `{ ...provenance, edited, fileId, permalink }`; drop the inline image content block.
- [x] 1.4 Gate on Slack connectivity before generating; surface clean errors for disconnect and storage failure.
- [x] 1.5 Accept a prior result's `permalink` as `input_image_url` for edits (fetched with the bot token).
- [x] 1.6 Update `usageInstruction.ts`: store → render via `slack_file: { id }`; drop channel/one-image/DM-caveat and the obsolete "don't paste permalink into image_url" note.
- [x] 1.7 Update `generateImage.test.ts` for store-only (store called with no channel, handle-only return, disconnect/storage-failure errors).

## 2. Curated block: `slack_file` image source

- [x] 2.1 `blockSchema.ts`: add `slack_file: { id?; url? }`, make `image_url` optional, introduce `AuthoredImageBlock` and use it in the `Block` union (in place of `@slack/types`' strict `ImageBlock`).
- [x] 2.2 `blockValidate.ts`: validate exactly-one-of `image_url` / `slack_file`; inside `slack_file`, exactly-one-of `id` / `url`; add `slack_file` to `ALLOWED_IMAGE_KEYS`.
- [x] 2.3 `blockValidate.test.ts`: add accept (id, url), reject (both sources, neither source, slack_file both, slack_file neither) cases.

## 3. Delivery context cleanup

- [x] 3.1 Remove `directPostThreadHint` and its two call sites from `buildDeliveryContext`.
- [x] 3.2 Remove the corresponding `promptBuilder.test.ts` cases and the now-unused import.

## 4. Docs

- [x] 4.1 `docs/gemini-image-plugin.md`: store-then-render model; `slack_file` rendering; permalink-for-edit note.
- [x] 4.2 `data/default_configuration/user/block-kit-formatting.md`: image block accepts `image_url` OR `slack_file`.

## 5. Verification

- [x] 5.1 `npx tsc --noEmit` clean.
- [x] 5.2 Full `vitest` suite green; oxlint + oxfmt clean on changed files.
- [ ] 5.3 Manual smoke in Slack: generate an image, confirm it renders via `slack_file: { id }` in a DM and a channel, and that no file is posted before the message.

## 6. Archive

- [x] 6.1 Archive this change WITH the code and the synced spec deltas (`gemini-image-generation`, `clack-tool-response`, `delivery-context`) in one commit.
