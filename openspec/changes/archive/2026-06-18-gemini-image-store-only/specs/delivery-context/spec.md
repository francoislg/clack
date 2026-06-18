## REMOVED Requirements

### Requirement: Thread Timestamp Surfaced for Direct-Posting Tools

**Reason**: This requirement existed solely so `generate_image`'s channel upload could route into the conversation's thread. With `generate_image` now store-only (it uploads unshared and posts to no channel — see the `gemini-image-generation` *Stored unshared delivery* requirement), no tool posts directly to Slack, so surfacing `thread_ts` for direct-posting tools is dead prompt surface. The `directPostThreadHint` and its call sites are removed from `buildDeliveryContext`.

**Migration**: None. No tool consumes the surfaced `thread_ts`. `submit_response` routing is unchanged (its channel/thread destination is supplied by bot infrastructure, not by Claude).
