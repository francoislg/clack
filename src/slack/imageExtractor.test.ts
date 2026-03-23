import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractImageFiles } from "./imageExtractor.js";

describe("extractImageFiles", () => {
  const validFile = {
    id: "F123ABC",
    name: "screenshot.png",
    mimetype: "image/png",
    size: 1024,
    url_private: "https://files.slack.com/files-pri/T123/screenshot.png",
  };

  it("extracts valid image files", () => {
    const result = extractImageFiles([validFile]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "F123ABC");
    assert.equal(result[0].name, "screenshot.png");
    assert.equal(result[0].mimetype, "image/png");
  });

  it("supports jpeg, gif, and webp", () => {
    const files = [
      { ...validFile, id: "F1", mimetype: "image/jpeg" },
      { ...validFile, id: "F2", mimetype: "image/gif" },
      { ...validFile, id: "F3", mimetype: "image/webp" },
    ];
    const result = extractImageFiles(files);
    assert.equal(result.length, 3);
  });

  it("rejects non-image MIME types", () => {
    const files = [
      { ...validFile, mimetype: "application/pdf" },
      { ...validFile, mimetype: "text/plain" },
      { ...validFile, mimetype: "video/mp4" },
    ];
    const result = extractImageFiles(files);
    assert.equal(result.length, 0);
  });

  it("rejects files exceeding 20MB", () => {
    const large = { ...validFile, size: 21 * 1024 * 1024 };
    const result = extractImageFiles([large]);
    assert.equal(result.length, 0);
  });

  it("accepts files at exactly 20MB", () => {
    const exact = { ...validFile, size: 20 * 1024 * 1024 };
    const result = extractImageFiles([exact]);
    assert.equal(result.length, 1);
  });

  it("caps at 10 images per message", () => {
    const files = Array.from({ length: 15 }, (_, i) => ({
      ...validFile,
      id: `F${i}`,
    }));
    const result = extractImageFiles(files);
    assert.equal(result.length, 10);
  });

  it("skips files with missing id", () => {
    const result = extractImageFiles([{ ...validFile, id: undefined }]);
    assert.equal(result.length, 0);
  });

  it("skips files with missing name", () => {
    const result = extractImageFiles([{ ...validFile, name: undefined }]);
    assert.equal(result.length, 0);
  });

  it("skips files with missing url_private", () => {
    const result = extractImageFiles([{ ...validFile, url_private: undefined }]);
    assert.equal(result.length, 0);
  });

  it("skips non-object entries", () => {
    const result = extractImageFiles([null, undefined, "string", 42, validFile]);
    assert.equal(result.length, 1);
  });

  it("returns empty for undefined input", () => {
    assert.deepEqual(extractImageFiles(undefined), []);
  });

  it("returns empty for empty array", () => {
    assert.deepEqual(extractImageFiles([]), []);
  });

  it("returns empty for non-array input", () => {
    assert.deepEqual(extractImageFiles("not an array" as unknown as unknown[]), []);
  });
});
