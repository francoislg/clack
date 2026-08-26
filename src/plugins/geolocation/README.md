# geolocation

An isolated IP-geolocation plugin. It exposes one MCP tool — `mcp__geolocation__geolocate_ip(ip)` — that resolves a public IPv4/IPv6 address to **country-level** location data from a local, in-memory database. No API key, no per-lookup network call — the IP never leaves the deployment.

## What it returns

On a hit: `{ ip, found: true, countryCode, country, continent, continentCode, isEU }`.

A private, reserved, or unknown address returns `{ ip, found: false, reason }` — reported plainly, not as an error.

## What it does NOT do

- **Country-level only** — no city, region, latitude/longitude, timezone, or ASN. (Those live in the larger City database; this plugin deliberately uses the small Country database for a minimal footprint.)
- No reverse geocoding, no batch lookups.

## Data source & license

The database is **[DB-IP Country Lite](https://db-ip.com/db/download/ip-to-country-lite)**, released monthly under **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**. Attribution is required: the plugin's usage instruction already tells Claude to credit *"IP geolocation by DB-IP" (https://db-ip.com)* whenever it presents results.

CC BY (unlike MaxMind's GeoLite2) needs no account or signed EULA, which is why this plugin defaults to it.

## Setup

The plugin loads its database from `data/plugins/geolocation/dbip-country-lite.mmdb` — a **gitignored runtime file**, not shipped in the repo. If the file is absent the plugin still loads; `geolocate_ip` just reports that the database is not installed. To enable it:

**1. Download the database** (current month):

```bash
mkdir -p data/plugins/geolocation
curl -L "https://download.db-ip.com/free/dbip-country-lite-$(date +%Y-%m).mmdb.gz" \
  | gunzip > data/plugins/geolocation/dbip-country-lite.mmdb
```

**2. Enable the plugin** — add `"geolocation"` to the `plugins` array in `data/config.json` and restart.

That's it locally. Verify with a call to `geolocate_ip` (e.g. `8.8.8.8` → `US`).

## Deploying to the VM

The GCE deploy (`scripts/gce-update-image.sh`) **does not touch the persistent data disk**, so the `.mmdb` is placed there **once** and survives every subsequent image deploy — no per-deploy sync, and the core deploy script stays plugin-agnostic. Push it with the same surgical SSH-tar pattern the operator uses for `worker-settings.json`:

```bash
tar -C data/plugins/geolocation -cf - dbip-country-lite.mmdb \
  | gcloud compute ssh clack --zone=<zone> --quiet --command="
      set -e
      sudo mkdir -p /mnt/disks/clack-data/data/plugins/geolocation
      sudo tar -C /mnt/disks/clack-data/data/plugins/geolocation -xf -
      sudo chown -R 1001:1001 /mnt/disks/clack-data/data/plugins/geolocation
    "
```

Then add `"geolocation"` to the VM's `data/config.json` (also on the persistent disk) and restart the container.

## Refreshing

DB-IP publishes a new Country Lite build monthly. To update, re-run the download step (locally and/or on the VM) to overwrite the `.mmdb`, then restart so the plugin reloads it at boot. Refresh is an operator task — the plugin does not auto-update.

## Dependency

[`mmdb-lib`](https://www.npmjs.com/package/mmdb-lib) — a pure `Buffer` → `Reader` MaxMind-DB parser (no filesystem coupling), so the plugin loads the database through the SDK's `readFileBuffer` and keeps every lookup in memory. IP validation uses the `node:net` built-in.
