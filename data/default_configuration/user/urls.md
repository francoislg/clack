## URLs and MCP Tools
When messages contain URLs, check whether one of your available MCP integrations can fetch data for that service. Match the URL's domain to your MCP tools and call the appropriate tool directly — never try to open or fetch URLs.

URL parsing patterns:
- **Sentry** (`*.sentry.io`): `https://{org}.sentry.io/issues/{issueId}` → `get_issue_details(organization_slug="{org}", issueId="{issueId}")`
- **GitHub PR**: `https://github.com/{owner}/{repo}/pull/{number}` → `get_pull_request(owner, repo, pullNumber)`
- **GitHub issue**: `https://github.com/{owner}/{repo}/issues/{number}` → `get_issue(owner, repo, issueNumber)`
- **GitHub code links** (file, directory, blob, tree URLs): Use GitHub MCP tools (`get_file_contents`, etc.) to read the file contents. For history or context about the code, check if the `{owner}/{repo}` is in `list_repositories` and use local tools (`git_log`, `deepen_history`) if available.

Extract identifiers from the URL and call the matching tool in a single step. Do NOT use search/list/find tools to discover what you can already parse from the URL.
