import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../plugins-sdk/sdk.js";
import { geolocateOne, type GeoReader } from "./lookup.js";

export interface GeolocateDeps {
  /** In-memory database reader, or `null` when the `.mmdb` file was not installed. */
  reader: GeoReader | null;
}

const DB_NOT_INSTALLED =
  "Geolocation database is not installed. An admin needs to place a DB-IP Country Lite .mmdb file at data/plugins/geolocation/dbip-country-lite.mmdb — see the geolocation usage instructions.";

export function createGeolocateTool(deps: GeolocateDeps) {
  return tool(
    "geolocate_ip",
    "Resolve one or more public IP addresses to country-level location data from a local, in-memory database. " +
      "Accepts a batch of IPs (no limit) and returns { results: [{ ip, found, countryCode, country, continent, " +
      "continentCode, isEU }] } — one entry per input IP, in the same order. A private, reserved, unknown, or " +
      "malformed IP yields { ip, found: false, reason } for that entry, never a whole-batch error. Works for both " +
      "IPv4 and IPv6.",
    {
      ips: z
        .array(z.string())
        .min(1)
        .describe(
          "One or more IPv4 or IPv6 addresses to geolocate in a single batch, e.g. " +
            "['8.8.8.8', '2001:4860:4860::8888']. No limit on batch size.",
        ),
    },
    async (args) => {
      if (!deps.reader) {
        return errorResult(DB_NOT_INSTALLED);
      }
      const reader = deps.reader;
      const results = args.ips.map((ip) => geolocateOne(reader, ip));
      return textResult({ results });
    },
  );
}
