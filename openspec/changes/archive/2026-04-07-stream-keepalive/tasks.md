## 1. Keepalive Timer

- [x] 1.1 Add keepalive timer state to `SlackStreamer` (interval handle, constant for interval duration)
- [x] 1.2 Implement `startKeepalive()` — starts an interval that re-sends the current thinking task update via `this.append()`
- [x] 1.3 Implement `stopKeepalive()` — clears the interval timer
- [x] 1.4 Call `startKeepalive()` after the initial append succeeds in `start()`
- [x] 1.5 Call `stopKeepalive()` at the top of `stop()` before finalization appends
- [x] 1.6 Call `stopKeepalive()` when `this.failed` is set to `true` in `append()` catch block

## 2. Error Classification

- [x] 2.1 In the `append()` catch block, detect `message_not_in_streaming_state` via `error.data?.error` and log at `warn` level instead of `error`
- [x] 2.2 Ensure `this.failed = true` is still set (fallback path unchanged)

## 3. Tests

- [x] 3.1 Test that keepalive timer is started after successful `start()`
- [x] 3.2 Test that keepalive sends a task_update append at the configured interval
- [x] 3.3 Test that keepalive is cleared on `stop()`
- [x] 3.4 Test that keepalive is cleared when stream fails
- [x] 3.5 Test that `message_not_in_streaming_state` is logged as warning, not error
