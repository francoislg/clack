import { z } from "zod";
import type { JsonObject, JsonValue } from "../config.js";

/**
 * The subset of JSON Schema (draft-07, as a served `tools/list` emits it) that
 * {@link argsFromSchema} reads. Unknown keywords are stripped on parse.
 */
export interface SchemaNode {
  $ref?: string;
  type?: string | string[];
  const?: JsonValue;
  enum?: JsonValue[];
  anyOf?: SchemaNode[];
  oneOf?: SchemaNode[];
  allOf?: SchemaNode[];
  properties?: Record<string, SchemaNode>;
  required?: string[];
  items?: SchemaNode | SchemaNode[];
  prefixItems?: SchemaNode[];
  minItems?: number;
  uniqueItems?: boolean;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  definitions?: Record<string, SchemaNode>;
  $defs?: Record<string, SchemaNode>;
}

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);

export const schemaNode: z.ZodType<SchemaNode> = z.lazy(() =>
  z.object({
    $ref: z.string().optional(),
    type: z.union([z.string(), z.array(z.string())]).optional(),
    const: jsonValue.optional(),
    enum: z.array(jsonValue).optional(),
    anyOf: z.array(schemaNode).optional(),
    oneOf: z.array(schemaNode).optional(),
    allOf: z.array(schemaNode).optional(),
    properties: z.record(z.string(), schemaNode).optional(),
    required: z.array(z.string()).optional(),
    items: z.union([schemaNode, z.array(schemaNode)]).optional(),
    prefixItems: z.array(schemaNode).optional(),
    minItems: z.number().optional(),
    uniqueItems: z.boolean().optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    exclusiveMinimum: z.number().optional(),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    pattern: z.string().optional(),
    format: z.string().optional(),
    definitions: z.record(z.string(), schemaNode).optional(),
    $defs: z.record(z.string(), schemaNode).optional(),
  }),
);

/** Strings tried, in order, against a `pattern`. Extend when a new tool's pattern matches none. */
const PATTERN_CANDIDATES = [
  "probe",
  "probe.md",
  "C0123456789",
  "U0123456789",
  "1234567890.123456",
  "2026-09-22",
  "2026-09-22T12:00:00Z",
  "12:00",
  "0 9 * * 1-5",
  "https://example.com",
  "a",
  "1",
  "abc-def",
];

/** Past this many visits of one `$ref` on the current path, the subtree drops to required-only. */
const MAX_REF_REVISITS = 2;

/**
 * `"minimal"` sets only the properties each object lists as `required`; `"full"` sets every
 * advertised property. Either way every value satisfies the advertised constraints, so a
 * validator rejecting the result disagrees with the schema it advertised.
 */
export type ArgsMode = "minimal" | "full";

export function argsFromSchema(root: SchemaNode, mode: ArgsMode): JsonObject {
  return objectFor(root, root, mode === "full", new Map());
}

function resolveRef(ref: string, root: SchemaNode): SchemaNode {
  if (ref === "#") return root;
  const match = /^#\/(definitions|\$defs)\/([^/]+)$/.exec(ref);
  const target = match ? root[match[1] === "$defs" ? "$defs" : "definitions"]?.[match[2]] : null;
  if (!target) throw new Error(`unsupported $ref ${ref} — extend testArgsFromSchema`);
  return target;
}

function build(
  node: SchemaNode,
  root: SchemaNode,
  full: boolean,
  refVisits: Map<string, number>,
): JsonValue {
  if (node.$ref) {
    const visits = (refVisits.get(node.$ref) ?? 0) + 1;
    const next = new Map(refVisits).set(node.$ref, visits);
    return build(resolveRef(node.$ref, root), root, full && visits <= MAX_REF_REVISITS, next);
  }
  if (node.const !== undefined) return node.const;
  if (node.enum) return node.enum.find((e) => e !== null) ?? node.enum[0];
  const variants = node.anyOf ?? node.oneOf;
  if (variants) {
    const pick = variants.find((v) => v.type !== "null") ?? variants[0];
    return build(pick, root, full, refVisits);
  }
  if (node.allOf) {
    // A described `$ref` is served as `allOf: [{ $ref }]` (draft-07 ignores `$ref` siblings).
    if (node.allOf.length !== 1) throw new Error("multi-member allOf — extend testArgsFromSchema");
    return build(node.allOf[0], root, full, refVisits);
  }

  switch (primaryType(node)) {
    case "string":
      return stringFor(node);
    case "integer":
      return Math.ceil(numberFor(node));
    case "number":
      return numberFor(node);
    case "boolean":
      return true;
    case "null":
      return null;
    case "array":
      return arrayFor(node, root, full, refVisits);
    case "object":
      return objectFor(node, root, full, refVisits);
    default:
      return "probe";
  }
}

function primaryType(node: SchemaNode): string | undefined {
  const type = Array.isArray(node.type) ? node.type.find((t) => t !== "null") : node.type;
  if (type) return type;
  if (node.properties) return "object";
  if (node.items || node.prefixItems) return "array";
  return undefined;
}

function stringFor(node: SchemaNode): string {
  if (node.format === "date-time") return "2026-09-22T12:00:00.000Z";
  if (node.format === "date") return "2026-09-22";
  if (node.format === "email") return "probe@example.com";
  if (node.format === "uri" || node.format === "url") return "https://example.com";
  if (node.pattern) {
    const re = new RegExp(node.pattern, "u");
    const hit = PATTERN_CANDIDATES.find((c) => re.test(c));
    if (hit === undefined) {
      throw new Error(`no candidate matches pattern ${node.pattern} — extend PATTERN_CANDIDATES`);
    }
    return hit;
  }
  let value = "probe";
  if (node.minLength !== undefined) value = value.padEnd(node.minLength, "x");
  if (node.maxLength !== undefined) value = value.slice(0, Math.max(node.maxLength, 1));
  return value;
}

function numberFor(node: SchemaNode): number {
  const floor =
    node.minimum ?? (node.exclusiveMinimum !== undefined ? node.exclusiveMinimum + 1 : 1);
  const value = Math.max(1, floor);
  return node.maximum !== undefined ? Math.min(value, node.maximum) : value;
}

function arrayFor(
  node: SchemaNode,
  root: SchemaNode,
  full: boolean,
  refVisits: Map<string, number>,
): JsonValue[] {
  const tuple = node.prefixItems ?? (Array.isArray(node.items) ? node.items : undefined);
  if (tuple) return tuple.map((item) => build(item, root, full, refVisits));

  const item = Array.isArray(node.items) ? undefined : node.items;
  const count = Math.max(node.minItems ?? 0, full ? 1 : 0);
  return Array.from({ length: count }, (_, i) =>
    node.uniqueItems && item?.enum
      ? item.enum[i % item.enum.length]
      : build(item ?? {}, root, full, refVisits),
  );
}

function objectFor(
  node: SchemaNode,
  root: SchemaNode,
  full: boolean,
  refVisits: Map<string, number>,
): JsonObject {
  const required = new Set(node.required ?? []);
  const out: JsonObject = {};
  for (const [key, prop] of Object.entries(node.properties ?? {})) {
    if (full || required.has(key)) out[key] = build(prop, root, full, refVisits);
  }
  return out;
}
