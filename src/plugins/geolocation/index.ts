import type { ClackSdk, ClackPlugin } from "../../plugins-sdk/sdk.js";
import { createGeolocateTool } from "./geolocate.js";
import { createReader, type GeoReader } from "./lookup.js";
import { GEOLOCATION_USAGE_INSTRUCTION } from "./usageInstruction.js";

const DB_FILENAME = "dbip-country-lite.mmdb";

export const geolocationPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  sdk.registerDictionary({
    en: { "label.geolocate": "Geolocating IPs — {ips}" },
    fr: { "label.geolocate": "Géolocalisation des IP — {ips}" },
  });
  sdk.addInstruction("user", "usage", GEOLOCATION_USAGE_INSTRUCTION);

  let reader: GeoReader | null = null;
  const buffer = await sdk.readFileBuffer(DB_FILENAME);
  if (buffer) {
    try {
      reader = createReader(buffer);
    } catch (err) {
      sdk.error(
        `failed to load geolocation database "${DB_FILENAME}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    sdk.logger.warn(
      `geolocation database "${DB_FILENAME}" not found — geolocate_ip will report it is not installed`,
    );
  }

  sdk.registerTool("member", createGeolocateTool({ reader }), sdk.t("label.geolocate"));
};
