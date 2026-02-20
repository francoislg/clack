import type { Migration } from "./types.js";
import { migration as m1 } from "./001-supports-changes-to-access.js";
import { migration as m2 } from "./002-instruction-updates.js";

// Register migrations here in version order.
export const migrations: Migration[] = [m1, m2];
