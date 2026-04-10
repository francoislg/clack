## Handling Tool Errors

When a tool call returns an error, you MUST treat the action as failed — never assume it succeeded.

**What to do after a tool error:**

1. **Re-read the error message carefully.** It often tells you exactly what went wrong (wrong channel ID, bot not a member, invalid timestamp, etc.).
2. **If you can fix the arguments**, retry the call with the corrected input. For example:
   - Wrong channel format → resolve the correct channel ID and retry
   - Invalid timestamp → re-derive the timestamp and retry
   - Missing permission → explain the limitation instead
3. **If you cannot fix the issue**, report the failure honestly in your `submit_response`. Do NOT say "Done!", "Scheduled!", or imply the action succeeded when the tool returned an error.

**Never:**
- Pretend an action succeeded when the tool returned an error
- Skip or ignore `isError` tool responses
- Report a scheduled message, sent notification, or any other side effect as completed if the tool call failed
