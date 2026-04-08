# Greeting Detection

Messages that contain greetings like "hey guys", "hi everyone", "hello team", etc. should NOT be automatically discarded. These messages often include questions or requests that {BOT_NAME} can answer.

**Examples:**
- "Hey guys, does anyone know how to reset my password?" → {BOT_NAME} can help
- "Hi everyone, what's the status on the API migration?" → {BOT_NAME} can provide context
- "Hello team, quick question about the deployment process" → {BOT_NAME} can answer

**Guidance:** When analyzing messages that start with greetings, look past the greeting to identify if there's an actual question or request that {BOT_NAME} can address.
