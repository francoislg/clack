import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { CountryResponse } from "mmdb-lib";
import { isValidIp, lookupIp, type GeoReader } from "./lookup.js";

const US_RECORD: CountryResponse = {
  continent: { code: "NA", geoname_id: 6255149, names: { en: "North America" } },
  country: {
    geoname_id: 6252001,
    iso_code: "US",
    names: { en: "United States" },
    is_in_european_union: false,
  },
};

const FR_RECORD: CountryResponse = {
  continent: { code: "EU", geoname_id: 6255148, names: { en: "Europe" } },
  country: {
    geoname_id: 3017382,
    iso_code: "FR",
    names: { en: "France" },
    is_in_european_union: true,
  },
};

function readerReturning(record: CountryResponse | null): GeoReader {
  return { get: () => record };
}

const NOT_FOUND_REASON = "No location data for this IP (private, reserved, or unknown).";

describe("isValidIp", () => {
  it("accepts IPv4 and IPv6 addresses", () => {
    assert.equal(isValidIp("8.8.8.8"), true);
    assert.equal(isValidIp("2001:4860:4860::8888"), true);
    assert.equal(isValidIp("::1"), true);
  });

  it("rejects non-addresses", () => {
    assert.equal(isValidIp("not-an-ip"), false);
    assert.equal(isValidIp("999.1.1.1"), false);
    assert.equal(isValidIp(""), false);
  });
});

describe("lookupIp", () => {
  it("maps a country record to a found result", () => {
    const result = lookupIp(readerReturning(US_RECORD), "8.8.8.8");
    assert.deepEqual(result, {
      ip: "8.8.8.8",
      found: true,
      countryCode: "US",
      country: "United States",
      continent: "North America",
      continentCode: "NA",
      isEU: false,
    });
  });

  it("reports European-Union membership", () => {
    assert.deepEqual(lookupIp(readerReturning(FR_RECORD), "2.2.2.2"), {
      ip: "2.2.2.2",
      found: true,
      countryCode: "FR",
      country: "France",
      continent: "Europe",
      continentCode: "EU",
      isEU: true,
    });
  });

  it("returns found: false with a reason when the reader has no record", () => {
    assert.deepEqual(lookupIp(readerReturning(null), "10.0.0.1"), {
      ip: "10.0.0.1",
      found: false,
      reason: NOT_FOUND_REASON,
    });
  });

  it("returns found: false when the record has no country", () => {
    assert.deepEqual(lookupIp(readerReturning({ continent: FR_RECORD.continent }), "1.2.3.4"), {
      ip: "1.2.3.4",
      found: false,
      reason: NOT_FOUND_REASON,
    });
  });
});
