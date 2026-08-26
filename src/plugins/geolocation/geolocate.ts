import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../plugins-sdk/sdk.js";
import { isValidIp, lookupIp, type GeoReader } from "./lookup.js";

export interface GeolocateDeps {
  /** In-memory database reader, or `null` when the `.mmdb` file was not installed. */
  reader: GeoReader | null;
}

const DB_NOT_INSTALLED =
  "Geolocation database is not installed. An admin needs to place a DB-IP Country Lite .mmdb file at data/plugins/geolocation/dbip-country-lite.mmdb — see the geolocation usage instructions.";

export function createGeolocateTool(deps: GeolocateDeps) {
  return tool(
    "geolocate_ip",
    "Resolve a public IP address to country-level location data from a local, in-memory database. " +
      "Returns { ip, found, countryCode, country, continent, continentCode, isEU }. A private, reserved, " +
      "or unknown IP returns { ip, found: false, reason } — not an error. Works for both IPv4 and IPv6.",
    {
      ip: z
        .string()
        .describe(
          "The IPv4 or IPv6 address to geolocate, e.g. '8.8.8.8' or '2001:4860:4860::8888'.",
        ),
    },
    async (args) => {
      if (!deps.reader) {
        return errorResult(DB_NOT_INSTALLED);
      }
      const ip = args.ip.trim();
      if (!isValidIp(ip)) {
        return errorResult(`"${args.ip}" is not a valid IPv4 or IPv6 address.`);
      }
      return textResult(lookupIp(deps.reader, ip));
    },
  );
}
