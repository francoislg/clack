import { convertMarkdownToSlack, splitForSlack } from "../claude.js";

function answerSections(answer: string) {
  return splitForSlack(convertMarkdownToSlack(answer)).map((chunk) => ({
    type: "section" as const,
    text: { type: "mrkdwn" as const, text: chunk },
  }));
}

export function getResponseBlocks(answer: string, sessionId: string) {
  return [
    ...answerSections(answer),
    {
      type: "divider" as const,
    },
    {
      type: "actions" as const,
      elements: [
        {
          type: "button" as const,
          text: {
            type: "plain_text" as const,
            text: "✅ Accept",
            emoji: true,
          },
          style: "primary" as const,
          action_id: "clack_accept",
          value: sessionId,
        },
        {
          type: "button" as const,
          text: {
            type: "plain_text" as const,
            text: "✏️ Edit & Accept",
            emoji: true,
          },
          action_id: "clack_edit",
          value: sessionId,
        },
        {
          type: "button" as const,
          text: {
            type: "plain_text" as const,
            text: "🔄 Refine",
            emoji: true,
          },
          action_id: "clack_refine",
          value: sessionId,
        },
        {
          type: "button" as const,
          text: {
            type: "plain_text" as const,
            text: "🔃 Update",
            emoji: true,
          },
          action_id: "clack_update",
          value: sessionId,
        },
        {
          type: "button" as const,
          text: {
            type: "plain_text" as const,
            text: "❌ Reject",
            emoji: true,
          },
          style: "danger" as const,
          action_id: "clack_reject",
          value: sessionId,
        },
      ],
    },
  ];
}

export function getAcceptedBlocks(answer: string) {
  return answerSections(answer);
}

export function getThinkingBlocks() {
  return [
    {
      type: "section" as const,
      text: {
        type: "mrkdwn" as const,
        text: ":thinking_face: _Analyzing the codebase..._",
      },
    },
  ];
}

export function getErrorBlocks(message: string) {
  return [
    {
      type: "section" as const,
      text: {
        type: "mrkdwn" as const,
        text: `:x: ${message}`,
      },
    },
  ];
}

export function getErrorBlocksWithRetry(sessionId: string) {
  return [
    {
      type: "section" as const,
      text: {
        type: "mrkdwn" as const,
        text: ":warning: Claude seems to have crashed, maybe try again?",
      },
    },
    {
      type: "actions" as const,
      elements: [
        {
          type: "button" as const,
          text: {
            type: "plain_text" as const,
            text: "🔄 Try Again",
            emoji: true,
          },
          action_id: "clack_retry",
          value: sessionId,
        },
      ],
    },
  ];
}

export function getInvestigatingBlocks() {
  return [
    {
      type: "section" as const,
      text: {
        type: "mrkdwn" as const,
        text: ":mag: _Investigating..._",
      },
    },
  ];
}

export function getHiddenThreadNotificationBlocks(text: string, sessionId: string) {
  return [
    {
      type: "section" as const,
      text: {
        type: "mrkdwn" as const,
        text,
      },
    },
    {
      type: "actions" as const,
      elements: [
        {
          type: "button" as const,
          text: {
            type: "plain_text" as const,
            text: "Send the message again",
            emoji: true,
          },
          action_id: "clack_resend",
          value: sessionId,
        },
      ],
    },
  ];
}

export function getMessageBlocks(answer: string) {
  return answerSections(answer);
}
