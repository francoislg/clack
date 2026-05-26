import type { JsonValue } from "../../config.js";

export interface FieldDoc {
  type: "string" | "boolean" | "number" | "enum" | "array" | "object" | "record";
  description: string;
  default?: JsonValue;
  example?: JsonValue;
  enum?: readonly string[];
  /** Whether the field may be `null` in addition to its declared type. */
  nullable?: boolean;
  /** Whether the field is required at the parent level. Defaults to `true`. */
  required?: boolean;
  /** Free-form note (constraints, range, cross-references). */
  notes?: string;
}

/**
 * Recursive shape mirroring `T`. Adding a field anywhere in `Config` (or any nested
 * interface) forces `CONFIG_SCHEMA` to grow a matching doc entry — the file fails to
 * compile otherwise. That is the 100% coverage guarantee.
 *
 * - Arrays → `FieldDoc & { items: SchemaFor<U> }`
 * - Records (string index signature) → `FieldDoc & { entries: SchemaFor<V> }`
 * - Objects → `FieldDoc & { fields: { [K]: SchemaFor<T[K]> } }`
 * - Primitives / literal unions → `FieldDoc`
 */
export type SchemaFor<T> = T extends (infer U)[]
  ? FieldDoc & { items: SchemaFor<U> }
  : string extends keyof T
    ? FieldDoc & { entries: SchemaFor<T[string]> }
    : T extends object
      ? FieldDoc & {
          fields: {
            [K in keyof Required<T>]: SchemaFor<NonNullable<T[K]>>;
          };
        }
      : FieldDoc;
