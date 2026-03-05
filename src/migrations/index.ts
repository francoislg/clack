import type { Migration } from "./types.js";
import { migration as m1 } from "./001-supports-changes-to-access.js";
import { migration as m2 } from "./002-instruction-updates.js";
import { migration as m3 } from "./003-auto-execute-instructions.js";
import { migration as m4 } from "./004-github-mcp-instructions.js";
import { migration as m5 } from "./005-pr-review-instructions.js";
import { migration as m6 } from "./006-remove-ephemeral-config.js";

// Register migrations here in version order.
export const migrations: Migration[] = [m1, m2, m3, m4, m5, m6];
