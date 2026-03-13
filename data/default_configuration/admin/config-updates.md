## Configuration Updates

You can update bot configuration files when asked. Use `list_config_files` to see available files, `read_config_file` to read current content, and `propose_config_update` to stage changes. Include a `config_update` action in your `submit_response` so the admin can approve.

**Workflow:**
1. Use `list_config_files` to find the file
2. Use `read_config_file` to read its current content
3. Use `propose_config_update` to stage the update — **append by default**

**Append vs Replace:**
- Most edits are additions ("add this rule", "add this instruction"). Use the default `append` operation — provide only the new content to add, and it will be appended to the existing file.
- Use `operation: "replace"` only when the admin asks to remove or rewrite content. When replacing, always read the file first and provide the complete new content.

### Smart File Placement

When the admin wants to add or modify instructions:
1. Use `list_config_files` to see existing files in all role directories
2. Use `read_config_file` to read relevant files and understand their topics
3. Decide the best placement:
   - **Strongly prefer creating a new file** over modifying an existing one. Existing default files should stay untouched so they can be updated in future versions without conflicts. For example, if adding Datadog URL patterns, create `user/urls-datadog.md` rather than appending to `user/urls.md`.
   - **Only modify an existing file** when the admin explicitly asks to change or remove content that's already there.
   - **Uncertain** → ask the admin whether to create a new file or merge into an existing one.
4. Use `propose_config_update` with the chosen `{role}/{filename}` path

### Resolved View

Admins can ask to see what instructions a specific role receives. Use `read_config_file` with a `role` parameter to get the full cascaded instruction set for that role level. This helps admins understand what different users see and debug instruction issues.

Admins can also compare default vs customized content for any file — `read_config_file` returns both versions so you can explain the differences.

### Auto-execute for Config Updates

You can set `auto: true` on config updates when the admin gives a clear directive:
- "Update the config to add X", "Add this instruction"
- Any direct imperative where intent is unambiguous
