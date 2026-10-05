import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { extractAttachments, classifyMimeType } from "./fileExtractor.js";

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

describe("extractAttachments", () => {
  function raw(id: string, mimetype: string, extra: object = {}) {
    return { id, name: `${id}.bin`, mimetype, size: 100, url_private: `https://x/${id}`, ...extra };
  }

  it("extracts every kind into one list, in message order, with Slack's type labels", () => {
    const result = extractAttachments([
      raw("F1", "image/png"),
      raw("F2", "application/pdf", { pretty_type: "PDF" }),
      raw("F3", "text/plain"),
      raw("F4", "application/json", { filetype: "list", pretty_type: "List" }),
    ]);
    assert.deepEqual(
      result.files?.map((f) => f.id),
      ["F1", "F2", "F3", "F4"],
    );
    assert.equal(result.files?.[1].pretty_type, "PDF");
    assert.equal(result.files?.[3].filetype, "list");
    assert.equal("filetype" in (result.files?.[0] ?? {}), false);
  });

  it("keeps a file whose type labels are malformed, without them", () => {
    const result = extractAttachments([
      raw("F1", "application/pdf", { filetype: 7, pretty_type: {} }),
    ]);
    assert.equal(result.files?.length, 1);
    assert.equal(result.files?.[0].filetype, undefined);
    assert.equal(result.files?.[0].pretty_type, undefined);
  });

  it("keeps a file's title when present and omits it otherwise", () => {
    const result = extractAttachments([
      raw("F1", "application/vnd.slack-docs", { title: "Infrastructure TODO" }),
      raw("F2", "image/png"),
    ]);
    assert.equal(result.files?.[0].title, "Infrastructure TODO");
    assert.equal("title" in (result.files?.[1] ?? {}), false);
  });

  it("keeps a file whose title is malformed, without it", () => {
    const result = extractAttachments([raw("F1", "application/pdf", { title: 7 })]);
    assert.equal(result.files?.length, 1);
    assert.equal("title" in (result.files?.[0] ?? {}), false);
  });

  it("skips malformed file objects", () => {
    const result = extractAttachments([
      null,
      "string",
      raw("F1", "image/png", { id: "" }),
      raw("F2", "application/pdf", { size: "big" }),
      raw("F3", "text/plain", { url_private: undefined }),
      raw("F4", "image/png"),
    ]);
    assert.deepEqual(
      result.files?.map((f) => f.id),
      ["F4"],
    );
  });

  it("skips a file missing any required field", () => {
    for (const field of ["id", "name", "mimetype", "size", "url_private"]) {
      assert.deepEqual(
        extractAttachments([raw("F1", "application/pdf", { [field]: undefined })]),
        {},
      );
    }
  });

  it("accepts a file of exactly 20MB as available", () => {
    const result = extractAttachments([raw("F1", "application/pdf", { size: 20 * 1024 * 1024 })]);
    assert.equal(result.files?.length, 1);
    assert.equal(result.files?.[0].unavailable, undefined);
  });

  it("marks an oversized file unavailable and keeps it", () => {
    const result = extractAttachments([
      raw("F1", "image/png", { size: 21 * 1024 * 1024 }),
      raw("F2", "application/pdf"),
    ]);
    assert.equal(result.files?.[0].unavailable, "too_large");
    assert.equal(result.files?.[1].unavailable, undefined);
  });

  it("keeps up to 10 images and 10 other files", () => {
    const images = Array.from({ length: 12 }, (_, i) => raw(`I${i}`, "image/png"));
    const others = Array.from({ length: 12 }, (_, i) => raw(`P${i}`, "application/pdf"));
    const result = extractAttachments([...images, ...others]);
    const ids = result.files?.map((f) => f.id) ?? [];
    assert.equal(ids.length, 20);
    assert.equal(ids.filter((id) => id.startsWith("I")).length, 10);
    assert.equal(ids.filter((id) => id.startsWith("P")).length, 10);
    assert.ok(!ids.includes("I10") && !ids.includes("P10"));
  });

  it("omits files when nothing usable is attached", () => {
    assert.deepEqual(extractAttachments(undefined), {});
    assert.deepEqual(extractAttachments([]), {});
    assert.deepEqual(extractAttachments([{ id: "F1" }]), {});
  });
});
