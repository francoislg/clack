## 1. Config & Storage Foundation

- [x] 1.1 Add `reactions.responseType` field to config schema and validation (`"ephemeral"` | `"directMessage"`, default `"ephemeral"`)
- [x] 1.2 Create user preferences module: `loadPreferences()`, `savePreferences()`, `getUserPreference()`, `setUserPreference()` with file-based storage at `data/state/user-preferences.json`
- [x] 1.3 Create `getEffectiveResponseType(userId)` helper that resolves config default + user opt-out into the effective response type

## 2. Manifest Generation

- [x] 2.1 Update manifest generator to add `im:write` scope when `reactions.responseType` is `"directMessage"`

## 3. Session Management Updates

- [x] 3.1 Extend `SessionInfo` type with `dmChannel`, `dmThreadTs`, `originChannel`, `originThreadTs`, and `channelPostTs` fields
- [x] 3.2 Update session persistence to include DM delivery coordinates in `context.json`
- [x] 3.3 Update session restoration to recover DM coordinates from disk

## 4. DM Response Delivery

- [x] 4.1 Create `postDmResponse()` function: opens DM via `conversations.open`, posts investigation notice with permalink, returns DM channel and thread ts
- [x] 4.2 Create `postDmThreadReply()` function: posts answer as thread reply in DM with "Send to thread" and "Reject" buttons
- [x] 4.3 Update response delivery routing in `core.ts` to call `postDmResponse` or `postEphemeralResponse` based on `getEffectiveResponseType()`
- [x] 4.4 Suppress `notifyHiddenThread` DM when user's effective response type is `"directMessage"`

## 5. DM Thread Refinement

- [x] 5.1 Extend thread reply handler to detect DM thread replies belonging to reaction-originated sessions (match `dmChannel` + `dmThreadTs`)
- [x] 5.2 Route matched DM thread replies through the refinement pipeline, posting updated answers back in the DM thread with action buttons

## 6. Synthesis & Send to Thread

- [x] 6.1 Create synthesis function: takes full DM conversation history, calls Claude with a synthesis prompt, returns clean unified answer
- [x] 6.2 Add "Send to thread" button handler: triggers synthesis, posts result in DM thread with Accept/Edit/Reject buttons
- [x] 6.3 Add "Accept synthesis" button handler: posts synthesized answer to original channel thread, stores `channelPostTs`
- [x] 6.4 Add "Edit synthesis" button handler: opens modal for editing, posts edited version to channel on submission
- [x] 6.5 Add "Reject synthesis" button handler: posts "Got it, discarded." acknowledgment in DM thread

## 7. Post-Accept Continuation

- [x] 7.1 Allow DM thread replies after accept: detect continued conversation, trigger new refinement round
- [x] 7.2 Add "Update original post" button handler: uses `chat.update` to edit existing channel post with new synthesis
- [x] 7.3 Add "Post new reply" button handler: posts new thread reply in channel, updates `channelPostTs`

## 8. DM Reject Action

- [x] 8.1 Add DM reject button handler: posts "Got it, discarded." acknowledgment in DM thread (distinct from ephemeral reject which deletes the message)

## 9. Home Tab Settings

- [x] 9.1 Add "Settings" button to Home tab view for all users
- [x] 9.2 Create Settings modal with "Response delivery" toggle (radio buttons: DM vs ephemeral)
- [x] 9.3 Conditionally show the DM toggle only when `reactions.responseType` is `"directMessage"`
- [x] 9.4 Handle Settings modal submission: persist preference via user preferences module
