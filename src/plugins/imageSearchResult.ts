/**
 * Shared SDK-layer result helpers for image-search plugins (the visual-questions
 * external tool contract, see docs/image-search-contract.md).
 *
 * Like `zodResult.ts`, this is a deliberate LEAF of the SDK layer — it imports
 * nothing, so plugins can import it directly without forming a module cycle
 * through the `sdk.ts` barrel. The error parameter is typed structurally so each
 * plugin keeps its own `SourceError` union (per-source kinds differ).
 */

/** Structural shape every image-search plugin's `SourceError` union satisfies. */
export interface ImageSourceError {
  kind: string;
  message: string;
}

/**
 * Data-mode multimodal result: one base64 image content block (for Claude to inspect) + one text
 * block carrying the metadata JSON. Both shapes are valid MCP `CallToolResult` content.
 */
export function imageAndTextResult(data: string, mimeType: string, metadata: unknown) {
  return {
    content: [
      { type: "image" as const, data, mimeType },
      { type: "text" as const, text: JSON.stringify(metadata, null, 2) },
    ],
  };
}

/** Structured-error result per the contract: a single JSON text block flagged `isError`. */
export function sourceErrorResult(err: ImageSourceError) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(err) }],
    isError: true as const,
  };
}

export const MAX_QUERY_LENGTH = 200;

/**
 * Shared in-handler query validation: blank (trimmed-empty) or oversized queries become
 * structured `notFound` errors — never a schema-level throw, which would bypass the
 * `SourceError` contract. Returns the trimmed query on success.
 */
export function validateQuery(
  raw: string,
  maxLength: number = MAX_QUERY_LENGTH,
): { ok: true; query: string } | { ok: false; error: ImageSourceError } {
  const query = raw.trim();
  if (query.length === 0) {
    return { ok: false, error: { kind: "notFound", message: "query is empty" } };
  }
  if (query.length > maxLength) {
    return {
      ok: false,
      error: { kind: "notFound", message: `query exceeds ${maxLength} characters` },
    };
  }
  return { ok: true, query };
}
