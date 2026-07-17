# Status server

Clack runs a small loopback-bound HTTP server (`src/statusServer.ts`) alongside the bot. It binds `127.0.0.1` only — it is never reachable from outside the host/container. Port defaults to `8787`, overridable via the `STATUS_PORT` env var.

## `GET /status`

Always available, no auth. Returns a JSON snapshot of runtime state:

```json
{
  "version": "1.2.3",
  "uptimeSec": 4210,
  "activeRuns": { "count": 1, "runs": [ ... ] },
  "workers": { "active": 0, "changes": [] },
  "busy": true
}
```

`busy` is the union of active query runs and executing Changes-Workflow runs. The deploy script's drain phase (`scripts/gce-update-image.sh`) polls this endpoint to wait for in-flight work before swapping containers — which is why it stays unauthenticated.

## `GET /prompt`

Renders the assembled system prompt (language directive + cascaded instruction files, byte-for-byte what `buildSystemPrompt` produces for those inputs) so operators can inspect and size it — e.g. auditing what a channelless idler fire pays for on every API call.

**Disabled unless `STATUS_TOKEN` is set.** Without the secret the route returns 404. Configure it in `data/auth/.env`:

```
STATUS_TOKEN=<any long random string>
```

Every request must present the token, either way:

```bash
curl -s -H "x-status-token: $STATUS_TOKEN" 'localhost:8787/prompt?role=owner&topics=idler'
curl -s -H "Authorization: Bearer $STATUS_TOKEN" 'localhost:8787/prompt?role=dev&changesWorkflow=1'
# Interactive sessions auto-attach the response-rendering built-in topic — include it
# to reproduce what a DM/mention session actually pays:
curl -s -H "x-status-token: $STATUS_TOKEN" 'localhost:8787/prompt?role=dev&topics=response-rendering'
```

### Query parameters

| Param | Values | Default | Meaning |
|---|---|---|---|
| `role` | `member` `dev` `admin` `owner` | `member` | Role tier whose instruction cascade is rendered |
| `topics` | comma-separated topic names | none | Pre-attached topics (e.g. `idler`, `trivia` — same names as `attach_integration`) |
| `changesWorkflow` | `1` | off | Render with the Changes Workflow instruction set enabled |
| `workMode` | `1` | off | Render the worker-mode variant |

### Response

- Body: the raw prompt, `text/plain; charset=utf-8`.
- `x-prompt-chars` header: prompt length in characters (÷4 ≈ rough token count).
- `400` on an invalid role, `401` on a missing/wrong token, `500` (with the message) if rendering throws.

### Scope

The endpoint renders the instruction cascade only. Session-specific additions — a cron job's `additionalSystemPrompt`, the MCP integrations catalog, skill-pack catalogs, the tracked-memory block — need live session context and are not included. The cascade is the bulk of the prompt, so this is the right surface for size audits.

### On the VM

The server lives inside the container:

```bash
gcloud compute ssh clack --zone=northamerica-northeast1-a --command 'docker exec clack node -e "
  const t = require(\"fs\").readFileSync(\"/app/data/auth/.env\", \"utf8\")
    .match(/^STATUS_TOKEN=(.*)$/m)[1].trim();
  fetch(\"http://127.0.0.1:8787/prompt?role=owner&topics=idler\", { headers: { \"x-status-token\": t } })
    .then((r) => r.text()).then((x) => console.log(x));
"'
```

(dotenv loads `data/auth/.env` into the bot process only — a `docker exec` shell does not inherit it, so the snippet reads the token from the file.)

Env vars are read at boot: after changing `data/auth/.env` on the VM, restart the container with `scripts/gce-restart.sh` — it waits for the bot to go idle before restarting (aborts if still busy at the deadline; `--force` overrides). Never `docker restart clack` by hand; that skips the drain gate.
