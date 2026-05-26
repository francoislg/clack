import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { extractFiles, classifyMimeType } from "./fileExtractor.js";

describe("classifyMimeType", () => {
  it("classifies application/pdf as pdf", () => {
    assert.equal(classifyMimeType("application/pdf"), "pdf");
  });

  it("classifies text/* as text", () => {
    assert.equal(classifyMimeType("text/plain"), "text");
    assert.equal(classifyMimeType("text/csv"), "text");
    assert.equal(classifyMimeType("text/html"), "text");
    assert.equal(classifyMimeType("text/markdown"), "text");
  });

  it("classifies code MIME types as text", () => {
    assert.equal(classifyMimeType("application/json"), "text");
    assert.equal(classifyMimeType("application/xml"), "text");
    assert.equal(classifyMimeType("application/javascript"), "text");
    assert.equal(classifyMimeType("application/typescript"), "text");
    assert.equal(classifyMimeType("application/x-yaml"), "text");
    assert.equal(classifyMimeType("application/x-sh"), "text");
  });

  it("classifies unknown types as unsupported", () => {
    assert.equal(classifyMimeType("application/zip"), "unsupported");
    assert.equal(
      classifyMimeType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      "unsupported",
    );
    assert.equal(classifyMimeType("video/mp4"), "unsupported");
  });
});

describe("extractFiles", () => {
  const validPdf = {
    id: "F100",
    name: "report.pdf",
    mimetype: "application/pdf",
    size: 2048,
    url_private: "https://files.slack.com/files-pri/T123/report.pdf",
  };

  const validText = {
    id: "F200",
    name: "data.csv",
    mimetype: "text/csv",
    size: 512,
    url_private: "https://files.slack.com/files-pri/T123/data.csv",
  };

  const validJson = {
    id: "F300",
    name: "config.json",
    mimetype: "application/json",
    size: 256,
    url_private: "https://files.slack.com/files-pri/T123/config.json",
  };

  const validBinary = {
    id: "F400",
    name: "archive.zip",
    mimetype: "application/zip",
    size: 4096,
    url_private: "https://files.slack.com/files-pri/T123/archive.zip",
  };

  it("extracts PDF files", () => {
    const result = extractFiles([validPdf]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "F100");
    assert.equal(result[0].mimetype, "application/pdf");
  });

  it("extracts text-based files", () => {
    const result = extractFiles([validText, validJson]);
    assert.equal(result.length, 2);
  });

  it("extracts unsupported binary files (for metadata-only viewing)", () => {
    const result = extractFiles([validBinary]);
    assert.equal(result.length, 1);
    assert.equal(result[0].mimetype, "application/zip");
  });

  it("excludes image MIME types", () => {
    const imageFiles = [
      { ...validPdf, id: "I1", mimetype: "image/png" },
      { ...validPdf, id: "I2", mimetype: "image/jpeg" },
      { ...validPdf, id: "I3", mimetype: "image/gif" },
      { ...validPdf, id: "I4", mimetype: "image/webp" },
    ];
    const result = extractFiles(imageFiles);
    assert.equal(result.length, 0);
  });

  it("rejects files exceeding 20MB", () => {
    const large = { ...validPdf, size: 21 * 1024 * 1024 };
    const result = extractFiles([large]);
    assert.equal(result.length, 0);
  });

  it("accepts files at exactly 20MB", () => {
    const exact = { ...validPdf, size: 20 * 1024 * 1024 };
    const result = extractFiles([exact]);
    assert.equal(result.length, 1);
  });

  it("caps at 10 files per message", () => {
    const files = Array.from({ length: 15 }, (_, i) => ({
      ...validPdf,
      id: `F${i}`,
    }));
    const result = extractFiles(files);
    assert.equal(result.length, 10);
  });

  it("skips files with missing required fields", () => {
    assert.equal(extractFiles([{ ...validPdf, id: undefined }]).length, 0);
    assert.equal(extractFiles([{ ...validPdf, name: undefined }]).length, 0);
    assert.equal(extractFiles([{ ...validPdf, url_private: undefined }]).length, 0);
    assert.equal(extractFiles([{ ...validPdf, mimetype: undefined }]).length, 0);
  });

  it("skips non-object entries", () => {
    const result = extractFiles([null, undefined, "string", 42, validPdf]);
    assert.equal(result.length, 1);
  });

  it("returns empty for undefined input", () => {
    assert.deepEqual(extractFiles(undefined), []);
  });

  it("returns empty for empty array", () => {
    assert.deepEqual(extractFiles([]), []);
  });

  it("handles mixed image and non-image files", () => {
    const files = [
      { ...validPdf, id: "I1", mimetype: "image/png" }, // excluded
      validPdf, // included
      validText, // included
      { ...validPdf, id: "I2", mimetype: "image/jpeg" }, // excluded
      validJson, // included
    ];
    const result = extractFiles(files);
    assert.equal(result.length, 3);
    assert.deepEqual(
      result.map((f) => f.id),
      ["F100", "F200", "F300"],
    );
  });
});
