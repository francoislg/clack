import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getDataDir } from "../config.js";
import { getCachedFile, cacheFile, readCachedFileBase64, readCachedFileBuffer } from "./fileCache.js";

const TEST_FILE_ID = "__test_file_cache__";

function cleanupTestFiles() {
  const cacheDir = resolve(getDataDir(), "cache/files");
  for (const ext of [".png", ".jpg", ".gif", ".webp", ".pdf", ".json", ".txt", ".csv", ".html", ".md", ".bin", ".meta.json"]) {
    const p = resolve(cacheDir, `${TEST_FILE_ID}${ext}`);
    if (existsSync(p)) rmSync(p);
  }
}

describe("fileCache", () => {
  afterEach(() => {
    cleanupTestFiles();
  });

  it("getCachedFile returns null for non-existent file", async () => {
    const result = await getCachedFile("NONEXISTENT_FILE_ID_999");
    assert.equal(result, null);
  });

  it("readCachedFileBase64 returns null for non-existent file", async () => {
    const result = await readCachedFileBase64("NONEXISTENT_FILE_ID_999");
    assert.equal(result, null);
  });

  it("readCachedFileBuffer returns null for non-existent file", async () => {
    const result = await readCachedFileBuffer("NONEXISTENT_FILE_ID_999");
    assert.equal(result, null);
  });

  it("cacheFile stores and getCachedFile retrieves metadata for image", async () => {
    const data = Buffer.from("fake png data");
    await cacheFile(TEST_FILE_ID, data, {
      mimeType: "image/png",
      originalName: "test-screenshot.png",
    });

    const meta = await getCachedFile(TEST_FILE_ID);
    assert.ok(meta);
    assert.equal(meta.mimeType, "image/png");
    assert.equal(meta.originalName, "test-screenshot.png");
    assert.ok(meta.cachedAt);
  });

  it("cacheFile stores and retrieves PDF files", async () => {
    const data = Buffer.from("fake pdf data");
    await cacheFile(TEST_FILE_ID, data, {
      mimeType: "application/pdf",
      originalName: "report.pdf",
    });

    const meta = await getCachedFile(TEST_FILE_ID);
    assert.ok(meta);
    assert.equal(meta.mimeType, "application/pdf");

    const result = await readCachedFileBase64(TEST_FILE_ID);
    assert.ok(result);
    assert.equal(result.mimeType, "application/pdf");
    assert.equal(result.data, data.toString("base64"));
  });

  it("cacheFile stores and retrieves text files", async () => {
    const data = Buffer.from("name,value\nfoo,42");
    await cacheFile(TEST_FILE_ID, data, {
      mimeType: "text/csv",
      originalName: "data.csv",
    });

    const result = await readCachedFileBuffer(TEST_FILE_ID);
    assert.ok(result);
    assert.equal(result.mimeType, "text/csv");
    assert.equal(result.data.toString("utf-8"), "name,value\nfoo,42");
  });

  it("readCachedFileBase64 returns base64 after caching", async () => {
    const original = Buffer.from("hello image bytes");
    await cacheFile(TEST_FILE_ID, original, {
      mimeType: "image/jpeg",
      originalName: "photo.jpg",
    });

    const result = await readCachedFileBase64(TEST_FILE_ID);
    assert.ok(result);
    assert.equal(result.mimeType, "image/jpeg");
    assert.equal(result.data, original.toString("base64"));
  });

  it("cache persists across separate reads", async () => {
    const data = Buffer.from("persistent data");
    await cacheFile(TEST_FILE_ID, data, {
      mimeType: "image/webp",
      originalName: "diagram.webp",
    });

    const first = await readCachedFileBase64(TEST_FILE_ID);
    assert.ok(first);

    const second = await readCachedFileBase64(TEST_FILE_ID);
    assert.ok(second);
    assert.equal(first.data, second.data);
    assert.equal(first.mimeType, second.mimeType);
  });
});
