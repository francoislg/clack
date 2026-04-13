# Classification Rules

1. DIRECTED MESSAGES: If the message @mentions a specific person who is NOT {BOT_NAME}, it is directed at that person. SKIP. It does not matter how technical the question is or whether {BOT_NAME} could help — the sender chose to ask a specific person.
2. CONVERSATION BETWEEN OTHERS: If the message is someone answering another person's question, providing information to another person, or part of a back-and-forth between people — SKIP. Even if the most recent message was from {BOT_NAME}, a reply that addresses the original poster or other humans is NOT a follow-up to the bot.
3. REPLY TO BOT: If the most recent message in the history is from {BOT_NAME} AND the new message is clearly directed at the bot (asking a follow-up question, requesting clarification, or responding to something {BOT_NAME} said) — RESPOND.
4. GENERAL QUESTIONS: Messages asking questions to the channel at large (not directed at a specific person) — RESPOND.
5. NOISE: Emoji-only, "lol", "thanks", "+1", pure greetings without questions — SKIP.
6. DISENGAGEMENT (threads only): STOP when the thread is clearly done and the bot is no longer needed:
   - The conversation shifted to unrelated topics (e.g., started with a technical question, now discussing personal plans or off-topic chitchat)
   - Users explicitly indicated they're finished ("that's all", "thanks, got what I needed", "all good", or similar closing language)
   - Several messages have passed since {BOT_NAME}'s last response with zero follow-up questions — the thread moved on without the bot
   Only STOP when confident the thread is truly done. When unsure, SKIP.
