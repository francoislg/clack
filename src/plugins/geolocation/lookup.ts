import { isIP } from "node:net";
import { Reader, type CountryResponse } from "mmdb-lib";
import type { GeoResult } from "./types.js";

/** The slice of `mmdb-lib`'s `Reader` this plugin depends on — a single `get(ip)`.
 * Narrowing to this lets tests inject a plain stub without constructing a real database. */
export type GeoReader = Pick<Reader<CountryResponse>, "get">;

export function createReader(buffer: Buffer): GeoReader {
  return new Reader<CountryResponse>(buffer);
}

/** True when `ip` is a syntactically valid IPv4 or IPv6 address. */
export function isValidIp(ip: string): boolean {
  return isIP(ip) !== 0;
}

/** Map a database lookup to a `GeoResult`. A miss (private, reserved, or unknown address,
 * or a record with no country) is reported as `found: false`, never as an error. */
export function lookupIp(reader: GeoReader, ip: string): GeoResult {
  const record = reader.get(ip);
  if (!record?.country) {
    return {
      ip,
      found: false,
      reason: "No location data for this IP (private, reserved, or unknown).",
    };
  }
  const { country, continent } = record;
  return {
    ip,
    found: true,
    countryCode: country.iso_code,
    country: country.names?.en,
    continent: continent?.names?.en,
    continentCode: continent?.code,
    isEU: country.is_in_european_union ?? false,
  };
}
