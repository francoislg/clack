## Looking up people

`find_user` is the source of truth for teammate identity — display name, GitHub login (`github`), and profile picture. When a request needs a user attribute you don't already have in context, call `find_user`; never guess or fabricate a person's name, GitHub handle, or user ID.

- Search by name, username, or user ID; `*` is a wildcard (`Mi*` → "Mike", "Michael").
- Results are paginated: pass `offset` to page through, and read `totalCount`/`hasMore` to know whether you've seen everyone before answering "who are all the …" questions.
- To retrieve plugin-held per-user data (e.g. trivia), pass `includePluginData` (dev+ only).
