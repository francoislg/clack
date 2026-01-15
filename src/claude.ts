import { query } from "@anthropic-ai/claude-agent-sdk";
import { getConfig, getRepositoriesDir } from "./config.js";
import type { SessionContext } from "./sessions.js";

export interface ClaudeResponse {
  success: boolean;
  answer: string;
  error?: string;
}

function buildSystemPrompt(): string {
  const config = getConfig();
  const repoList = config.repositories
    .map((r) => `- **${r.name}**: ${r.description}`)
    .join("\n");

  return `You are a helpful assistant that answers questions about codebases. You have access to the following repositories:

${repoList}

IMPORTANT INSTRUCTIONS:

## Step 1: Investigate the Codebase
- Determine which repository is relevant and focus your search there.
- Explore the code to understand how it works before answering.
- Only go deeper if the question specifically requires investigation.

## Step 2: Craft the Response (as a Support Agent)
- Give the answer directly. No preamble like "Based on my exploration of the codebase..." or "Answer:" headers.
- Keep it short and to-the-point. Only add structure (bullets, sections) if the question is complex.
- **Use broad, non-technical explanations by default**—explain like you're talking to a teammate who doesn't code.
- **Never include**: file paths, line numbers, function names, table/field names, or code snippets—unless the user explicitly asks for technical details.
- Focus on WHAT is happening and WHY, not HOW it's implemented.
- If the user asks for "more details", "technical info", or "specifics", then you may include code references.

## Critical: Information Only
- Never suggest code changes, fixes, or solutions that would require modifying the codebase.
- Your role is to explain how things currently work, not to recommend what should change.
- If asked "how do I fix X?", explain what X does and why it behaves that way—do not propose code modifications.

## Critical: No Hallucination
- ONLY describe features, UI elements, or functionality that you have directly verified in the codebase.
- If you cannot find evidence of something in the code, say "I couldn't find information about this in the codebase" rather than guessing.
- NEVER invent or assume features exist. Do not generate plausible-sounding answers about features you haven't verified.
- When describing how something works, base your answer solely on what you found in the code—not on what similar applications typically have.
- It's perfectly acceptable to say "I don't know" or "I wasn't able to find that" when you genuinely cannot locate the information.`;
}

function formatThreadContext(messages: SessionContext["threadContext"]): string {
  if (messages.length === 0) return "";

  const formatted = messages.map((msg) => {
    const speaker = msg.isBot ? "[Clack Bot]" : "[User]";
    return `${speaker}: ${msg.text}`;
  });

  return formatted.join("\n\n");
}

function buildPrompt(session: SessionContext): string {
  const parts: string[] = [];

  // Original question
  parts.push(`QUESTION: ${session.originalQuestion}`);

  // Thread context if any
  if (session.threadContext.length > 0) {
    const contextIntro = `\nTHREAD CONTEXT (previous messages in the Slack thread, in chronological order):
Messages marked [User] are from team members asking questions.
Messages marked [Clack Bot] are previous answers from you (this bot).
Use this context to understand the conversation flow and provide relevant answers.\n`;
    parts.push(contextIntro + formatThreadContext(session.threadContext));
  }

  // Previous answer if refining
  if (session.lastAnswer && session.refinements.length > 0) {
    parts.push(`\nPREVIOUS ANSWER:\n${session.lastAnswer}`);
  }

  // Refinements
  if (session.refinements.length > 0) {
    parts.push(`\nADDITIONAL INSTRUCTIONS FROM USER:\n${session.refinements.join("\n")}`);
  }

  return parts.join("\n");
}

export async function askClaude(session: SessionContext): Promise<ClaudeResponse> {
  const config = getConfig();
  const reposDir = getRepositoriesDir();

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildPrompt(session);

  console.log(`Querying Claude via Agent SDK for session ${session.sessionId}...`);

  try {
    let answer = "";

    // Use the Agent SDK query function
    for await (const message of query({
      prompt: userPrompt,
      options: {
        cwd: reposDir,
        systemPrompt,
        model: config.claudeCode.model,
        allowedTools: ["Read", "Glob", "Grep"],
        permissionMode: "bypassPermissions",
      },
    })) {
      // Collect text from assistant messages
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block && typeof block.text === "string") {
            answer += block.text;
          }
        }
      }
      // Get the final result
      if (message.type === "result") {
        if (message.subtype === "success" && message.result) {
          answer = message.result;
        } else if (message.subtype !== "success") {
          const errorMessage = "errors" in message ? message.errors?.join(", ") : "Unknown error";
          return {
            success: false,
            answer: "",
            error: `Claude query failed: ${errorMessage}`,
          };
        }
      }
    }

    if (answer.trim()) {
      return {
        success: true,
        answer: answer.trim(),
      };
    }

    return {
      success: false,
      answer: "",
      error: "No response received from Claude",
    };
  } catch (error) {
    console.error("Claude Agent SDK error:", error);
    return {
      success: false,
      answer: "",
      error: `Claude Agent SDK error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function convertMarkdownToSlack(markdown: string): string {
  let result = markdown;

  // Convert bold: **text** or __text__ to *text*
  result = result.replace(/\*\*(.+?)\*\*/g, "*$1*");
  result = result.replace(/__(.+?)__/g, "*$1*");

  // Convert italic: *text* or _text_ to _text_ (Slack uses _ for italic)
  // Be careful not to convert already-converted bold
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "_$1_");

  // Convert strikethrough: ~~text~~ to ~text~
  result = result.replace(/~~(.+?)~~/g, "~$1~");

  // Convert inline code: `code` stays the same in Slack
  // Code blocks: ```code``` stays the same in Slack

  // Convert headers: # Header to *Header*
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // Convert links: [text](url) to <url|text>
  result = result.replace(/\[(.+?)\]\((.+?)\)/g, "<$2|$1>");

  return result;
}

export function truncateForSlack(text: string, maxLength = 3000): string {
  if (text.length <= maxLength) {
    return text;
  }

  const truncated = text.substring(0, maxLength - 50);
  return `${truncated}\n\n_(Response truncated due to length)_`;
}
