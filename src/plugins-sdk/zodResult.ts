/**
 * Shared SDK-layer validation-result helper. Plugins that validate config with
 * zod import this to format failures into a labeled `{ ok, error }` `Result`.
 *
 * It is a deliberate LEAF of the SDK layer — it imports only `zod`, nothing from
 * bot core. Plugins import it directly rather than through `sdk.ts`: a value
 * import of the `sdk.ts` barrel from a plugin's config core would form a module
 * cycle (sdk → slack/app → plugin registry → plugin → back). A leaf module
 * shared across plugins avoids both the cycle and per-plugin duplication.
 */

import type { ZodError } from "zod";

/** Tagged validation result. `ok:false` carries a human-readable, labeled error. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Format a `ZodError` into a single labeled error string under the `Result`
 * shape. Each issue becomes `'<fieldLabel><path>' <message>` where `<path>`
 * joins object keys with `.` and array/tuple indices with `[n]`
 * (e.g. `answersFormat.boolean`, `questions[1].categories`). Multiple issues
 * join with `; `. The per-rule message comes from the schema; this supplies the
 * quoted path prefix.
 */
export function zodErrorToResult(
  error: ZodError,
  fieldLabel: string,
): { ok: false; error: string } {
  const parts = error.issues.map((issue) => {
    let path = fieldLabel;
    for (const segment of issue.path) {
      path += typeof segment === "number" ? `[${segment}]` : `.${String(segment)}`;
    }
    return `'${path}' ${issue.message}`;
  });
  return { ok: false, error: parts.join("; ") };
}
