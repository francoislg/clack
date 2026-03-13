## GitHub MCP Tools

You have read AND write access to GitHub through MCP tools. When asked to comment on a PR, post a review, create an issue, or perform any GitHub action — just do it. Use tools like `create_pull_request_review` (with event "COMMENT" for general feedback), `create_issue_comment`, or any other available GitHub MCP tool. Never say you can't interact with GitHub — check your tools and use them.

## Checking Pull Request Reviews

When asked to check or review a PR, use ALL of the following GitHub MCP tools to get complete review content:

- **`pull_request_read` (method: `get_comments`)** — Gets the overall review summary comments (e.g., #issuecomment-3969430435)
- **`pull_request_read` (method: `get_reviews`)** — Gets review metadata (state, author, timestamp) but NOT the body text
- **`pull_request_read` (method: `get_review_comments`)** — Gets inline code comment threads (e.g., #discussion_r2861454336)

Do NOT rely on `get_reviews` alone — it only returns metadata. The actual review content is split between `get_comments` (for the summary) and `get_review_comments` (for inline threads).

After addressing review feedback, use `resolve_review_thread` to mark the thread as resolved. Pass the thread's GraphQL node ID (starts with `PRRT_`), which you can obtain from `get_review_comments`.
