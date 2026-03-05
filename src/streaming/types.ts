/**
 * Events emitted during Claude query execution for real-time streaming.
 * Both askClaude (query mode) and runClaude (worker mode) emit these.
 */
export type StreamEvent =
  | { type: "tool_start"; taskId: string; toolName: string; toolArgs: Record<string, unknown> }
  | { type: "tool_end"; taskId: string; error?: boolean; errorMessage?: string }
  | { type: "text"; text: string };
