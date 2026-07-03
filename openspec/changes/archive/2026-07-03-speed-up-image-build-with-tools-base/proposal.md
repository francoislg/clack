## Why

Every deploy rebuilds the entire image from scratch on an ephemeral Cloud Build worker with no layer cache, so the slow, rarely-changing system layers — `apk add … ffmpeg`, the `github-mcp-server` download, and (on the applauz-me instance) `apk add jq` + the `claude-dont` hook — re-run on every code push. Base builds measure ~155–223s and, when the per-instance overlay exists, a second ~48s `gcloud builds submit` runs on top. Registry-based cache (`--cache-from`) is a weak fit here: the ~1.4 GB pull tax and multi-stage blind spot (the builder-stage `npm ci` isn't restored) undercut the savings, and Kaniko is archived/unmaintained as of June 2025. A structural split moves the stable layers out of the hot path so a normal deploy only rebuilds application code.

## What Changes

- Introduce a pinned **tools base image** (`clack:tools`) that carries the rarely-changing layers: `git/curl/bash/ffmpeg/lsof`, `corepack`, and the `github-mcp-server` binary. The application `Dockerfile`'s production stage bases `FROM clack:tools` instead of re-installing them.
- The **per-instance overlay** (`data/docker/Dockerfile.custom`: `jq` + the `claude-dont` worker hook) collapses one level down — it now layers on the tools base image, not on the deployed app image, so it is rebuilt only when tools inputs change rather than on every deploy. The stable in-image hook path (`/opt/worker-hooks/claude-dont/`) referenced by `data/worker-settings.json` is preserved.
- `scripts/gce-update-image.sh` builds/pushes `clack:tools` **only when its inputs changed** (content hash of the tools Dockerfile + system-dep/github-mcp version + `data/docker/` overlay); otherwise it reuses the already-pushed tools image and runs a **single** app build straight to `clack:latest`. The unconditional two-build overlay path is removed.
- A normal code-only deploy no longer runs `apk add ffmpeg`, the `github-mcp-server` download, or a separate overlay build — only `npm ci` + `tsc` + copy.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `docker-deployment`: the Dockerfile no longer installs system dependencies and the `github-mcp-server` binary directly in the app image — they move to a pinned `clack:tools` base image the app builds `FROM`; the GCE image-update script gains conditional tools-image rebuild keyed on a content hash and drops the unconditional second overlay build, folding the per-instance `jq`/`claude-dont` overlay onto the tools base image.

## Impact

- **Code/build:** new `Dockerfile.tools` (checked-in generic tools image); `Dockerfile` production stage rebased `FROM clack:tools`; `scripts/gce-update-image.sh` (conditional tools build + hash tracking, removed overlay double-build); `scripts/gce-common.sh` (a `TOOLS_IMAGE_NAME` reference); `data/docker/Dockerfile.custom` + `.example` (now `FROM clack:tools-base`).
- **Docs:** `CLAUDE.md` deploy/overlay notes, `docs/worker-settings.md`, `data/docker/README.md`.
- **Deploy behavior:** first deploy after this change (and any deploy that touches tools inputs) pays a one-time tools-image build; subsequent code-only deploys are faster. No change to runtime container behavior, mounts, ports, drain, or the data disk.
- **Not affected:** worker-settings injection contract, the `/deploy` skill phase markers (unless build-phase log lines change), Artifact Registry provisioning, VM auth.
