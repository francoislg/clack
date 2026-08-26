export const GEOLOCATION_USAGE_INSTRUCTION = `## Geolocation

You can resolve an IP address to a country using the \`geolocate_ip\` tool.

- Call \`geolocate_ip\` with a single \`ip\` (IPv4 or IPv6). It returns \`{ ip, found, countryCode, country, continent, continentCode, isEU }\`.
- A private, reserved, or unknown address returns \`{ found: false, reason }\` — report that plainly; it is not an error.
- If the tool reports the database is not installed, tell the user an admin needs to add the local database file; do not try to guess a location.
- This is **country-level** only — there is no city, region, latitude/longitude, or timezone. Do not infer finer detail than the tool returns.

**Attribution (required):** this data comes from the DB-IP Country Lite database (CC BY 4.0). When you present geolocation results, credit "IP geolocation by DB-IP" (https://db-ip.com).
`;
