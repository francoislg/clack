import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import type { CountryResponse } from "mmdb-lib";
import { createGeolocateTool } from "./geolocate.js";
import { parseToolResult } from "../../plugins-sdk/testHelpers.js";
import type { GeoReader } from "./lookup.js";

const SESSION = { sessionId: "test" };

const US_RECORD: CountryResponse = {
  continent: { code: "NA", geoname_id: 6255149, names: { en: "North America" } },
  country: {
    geoname_id: 6252001,
    iso_code: "US",
    names: { en: "United States" },
    is_in_european_union: false,
  },
};

describe("geolocate_ip tool", () => {
  it("returns a found result for a known public IP", async () => {
    const get = vi.fn<GeoReader["get"]>().mockReturnValue(US_RECORD);
    const tool = createGeolocateTool({ reader: { get } });

    const result = await tool.handler({ ip: "8.8.8.8" }, SESSION);

    assert.equal(result.isError, undefined);
    const parsed = parseToolResult(result);
    assert.equal(parsed.found, true);
    assert.equal(parsed.countryCode, "US");
    assert.equal(parsed.country, "United States");
    assert.deepEqual(get.mock.calls, [["8.8.8.8"]]);
  });

  it("returns found: false (not an error) for a private/unknown IP", async () => {
    const get = vi.fn<GeoReader["get"]>().mockReturnValue(null);
    const tool = createGeolocateTool({ reader: { get } });

    const result = await tool.handler({ ip: "10.0.0.1" }, SESSION);

    assert.equal(result.isError, undefined);
    const parsed = parseToolResult(result);
    assert.equal(parsed.found, false);
    assert.ok(parsed.reason);
  });

  it("rejects an invalid IP without touching the database", async () => {
    const get = vi.fn<GeoReader["get"]>();
    const tool = createGeolocateTool({ reader: { get } });

    const result = await tool.handler({ ip: "not-an-ip" }, SESSION);

    assert.equal(result.isError, true);
    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("not a valid"));
    assert.equal(get.mock.calls.length, 0);
  });

  it("errors with an install hint when the database is not loaded", async () => {
    const tool = createGeolocateTool({ reader: null });

    const result = await tool.handler({ ip: "8.8.8.8" }, SESSION);

    assert.equal(result.isError, true);
    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("not installed"));
    assert.ok(parsed.error.includes("data/plugins/geolocation/dbip-country-lite.mmdb"));
  });
});
