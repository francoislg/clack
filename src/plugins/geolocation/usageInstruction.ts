export const GEOLOCATION_USAGE_INSTRUCTION = `## Geolocation

You can resolve IP addresses to countries using the \`geolocate_ip\` tool.

- Call \`geolocate_ip\` with \`ips\` — an array of one or more addresses (IPv4 or IPv6), sent as a single batch (no limit). It returns \`{ results: [...] }\` with one entry per input IP, in the same order: \`{ ip, found, countryCode, country, continent, continentCode, isEU }\`.
- Pass every address you need to resolve in one call rather than calling the tool once per IP.
- A private, reserved, unknown, or malformed address returns \`{ ip, found: false, reason }\` for that entry — report it plainly; it is not an error and does not fail the rest of the batch.
- If the tool reports the database is not installed, tell the user an admin needs to add the local database file; do not try to guess a location.
- This is **country-level** only — there is no city, region, latitude/longitude, or timezone. Do not infer finer detail than the tool returns.

**Attribution (required):** this data comes from the DB-IP Country Lite database (CC BY 4.0). When you present geolocation results, credit "IP geolocation by DB-IP" (https://db-ip.com).
`;
