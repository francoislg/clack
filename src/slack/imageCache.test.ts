import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getDataDir } from "../config.js";
import { getCachedImage, cacheImage, readCachedImageBase64 } from "./imageCache.js";

const TEST_FILE_ID = "__test_image_cache__";

function cleanupTestFiles() {
  const cacheDir = resolve(getDataDir(), "cache/images");
  for (const ext of [".png", ".jpg", ".gif", ".webp", ".bin", ".meta.json"]) {
    const p = resolve(cacheDir, `${TEST_FILE_ID}${ext}`);
    if (existsSync(p)) rmSync(p);
  }
}

describe("imageCache", () => {
  afterEach(() => {
    cleanupTestFiles();
  });

  it("getCachedImage returns null for non-existent file", async () => {
    const result = await getCachedImage("NONEXISTENT_FILE_ID_999");
    assert.equal(result, null);
  });

  it("readCachedImageBase64 returns null for non-existent file", async () => {
    const result = await readCachedImageBase64("NONEXISTENT_FILE_ID_999");
    assert.equal(result, null);
  });

  it("cacheImage stores and getCachedImage retrieves metadata", async () => {
    const data = Buffer.from("fake png data");
    await cacheImage(TEST_FILE_ID, data, {
      mimeType: "image/png",
      originalName: "test-screenshot.png",
    });

    const meta = await getCachedImage(TEST_FILE_ID);
    assert.ok(meta);
    assert.equal(meta.mimeType, "image/png");
    assert.equal(meta.originalName, "test-screenshot.png");
    assert.ok(meta.cachedAt);
  });

  it("readCachedImageBase64 returns base64 after caching", async () => {
    const original = Buffer.from("hello image bytes");
    await cacheImage(TEST_FILE_ID, original, {
      mimeType: "image/jpeg",
      originalName: "photo.jpg",
    });

    const result = await readCachedImageBase64(TEST_FILE_ID);
    assert.ok(result);
    assert.equal(result.mimeType, "image/jpeg");
    assert.equal(result.data, original.toString("base64"));
  });

  it("cache persists across separate reads", async () => {
    const data = Buffer.from("persistent data");
    await cacheImage(TEST_FILE_ID, data, {
      mimeType: "image/webp",
      originalName: "diagram.webp",
    });

    // First read
    const first = await readCachedImageBase64(TEST_FILE_ID);
    assert.ok(first);

    // Second read (simulates different session)
    const second = await readCachedImageBase64(TEST_FILE_ID);
    assert.ok(second);
    assert.equal(first.data, second.data);
    assert.equal(first.mimeType, second.mimeType);
  });
});
