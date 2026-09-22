import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { argsFromSchema, schemaNode, type SchemaNode } from "./testArgsFromSchema.js";

describe("argsFromSchema", () => {
  const schema: SchemaNode = {
    type: "object",
    properties: {
      id: { type: "string" },
      note: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["id"],
  };

  it("sets only required properties in minimal mode", () => {
    assert.deepEqual(argsFromSchema(schema, "minimal"), { id: "probe" });
  });

  it("sets every property, with one array item, in full mode", () => {
    assert.deepEqual(argsFromSchema(schema, "full"), {
      id: "probe",
      note: "probe",
      tags: ["probe"],
    });
  });

  it("follows a definitions $ref, including one wrapped in a single-member allOf", () => {
    const root: SchemaNode = {
      type: "object",
      properties: { block: { allOf: [{ $ref: "#/definitions/Block" }] } },
      required: ["block"],
      definitions: {
        Block: { type: "object", properties: { kind: { const: "divider" } }, required: ["kind"] },
      },
    };

    assert.deepEqual(argsFromSchema(root, "minimal"), { block: { kind: "divider" } });
  });

  it("stops expanding optional properties of a self-referencing $ref in full mode", () => {
    const root: SchemaNode = {
      type: "object",
      properties: { node: { $ref: "#/definitions/Node" } },
      definitions: {
        Node: {
          type: "object",
          properties: { name: { type: "string" }, child: { $ref: "#/definitions/Node" } },
          required: ["name"],
        },
      },
    };

    assert.deepEqual(argsFromSchema(root, "full"), {
      node: { name: "probe", child: { name: "probe", child: { name: "probe" } } },
    });
  });

  it("builds one value per tuple position", () => {
    const root: SchemaNode = {
      type: "object",
      properties: {
        range: { type: "array", items: [{ type: "integer", minimum: 1 }, { type: "boolean" }] },
      },
      required: ["range"],
    };

    assert.deepEqual(argsFromSchema(root, "minimal"), { range: [1, true] });
  });

  it("picks the first non-null variant of an anyOf and the first non-null enum member", () => {
    const root: SchemaNode = {
      type: "object",
      properties: {
        maybe: { anyOf: [{ type: "null" }, { type: "boolean" }] },
        mode: { enum: [null, "append"] },
      },
      required: ["maybe", "mode"],
    };

    assert.deepEqual(argsFromSchema(root, "minimal"), { maybe: true, mode: "append" });
  });

  it("keeps numbers positive and inside their bounds", () => {
    const root: SchemaNode = {
      type: "object",
      properties: {
        zeroFloor: { type: "integer", minimum: 0 },
        capped: { type: "number", maximum: 0.5 },
        exclusive: { type: "integer", exclusiveMinimum: 3 },
      },
      required: ["zeroFloor", "capped", "exclusive"],
    };

    assert.deepEqual(argsFromSchema(root, "minimal"), { zeroFloor: 1, capped: 0.5, exclusive: 4 });
  });

  it("satisfies a pattern from its candidates and throws when none match", () => {
    const matching: SchemaNode = {
      type: "object",
      properties: { file: { type: "string", pattern: "^[\\w][\\w.-]*\\.md$" } },
      required: ["file"],
    };
    const unmatched: SchemaNode = {
      type: "object",
      properties: { code: { type: "string", pattern: "^ZZZ-\\d{9}$" } },
      required: ["code"],
    };

    assert.deepEqual(argsFromSchema(matching, "minimal"), { file: "probe.md" });
    assert.throws(() => argsFromSchema(unmatched, "minimal"), /no candidate matches pattern/);
  });

  it("names an unsupported $ref instead of guessing", () => {
    const root: SchemaNode = {
      type: "object",
      properties: { x: { $ref: "#/properties/y" } },
      required: ["x"],
    };

    assert.throws(() => argsFromSchema(root, "minimal"), /unsupported \$ref #\/properties\/y/);
  });
});

describe("schemaNode", () => {
  it("parses a served schema, stripping keywords the builder does not read", () => {
    const parsed = schemaNode.parse({
      type: "object",
      $schema: "http://json-schema.org/draft-07/schema#",
      additionalProperties: false,
      properties: { id: { type: "string", description: "The id." } },
      required: ["id"],
    });

    assert.deepEqual(parsed, {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    });
  });
});
