## URLs and MCP Tools
When messages contain URLs, check whether one of your available MCP integrations can fetch data for that service. Match the URL's domain to your MCP tools and call the appropriate tool directly — never try to open or fetch URLs.

URL parsing patterns:
- **Sentry** (`*.sentry.io`): `https://{org}.sentry.io/issues/{issueId}` → `get_issue_details(organization_slug="{org}", issueId="{issueId}")`
- **GitHub** (`github.com`): `https://github.com/{owner}/{repo}/pull/{number}` → `get_pull_request(owner, repo, pullNumber)`
- **GitHub issue**: `https://github.com/{owner}/{repo}/issues/{number}` → `get_issue(owner, repo, issueNumber)`

Extract identifiers from the URL and call the matching tool in a single step. Do NOT use search/list/find tools to discover what you can already parse from the URL.
