import type { Migration } from "./types.js";
import { migration as m1 } from "./001-supports-changes-to-access.js";
import { migration as m2 } from "./002-instruction-updates.js";
import { migration as m3 } from "./003-auto-execute-instructions.js";
import { migration as m4 } from "./004-github-mcp-instructions.js";
import { migration as m5 } from "./005-pr-review-instructions.js";
import { migration as m6 } from "./006-remove-ephemeral-config.js";
import { migration as m7 } from "./007-send-to-thread-content-instructions.js";
import { migration as m8 } from "./008-cascade-config-split.js";
import { migration as m9 } from "./009-add-auto-respond-config.js";
import { migration as m10 } from "./010-rename-send-to-thread-to-post-to.js";
import { migration as m11 } from "./011-add-allow-scheduled-messages.js";
import { migration as m12 } from "./012-add-thread-auto-respond-max-age.js";
import { migration as m13 } from "./013-rename-plugins-to-skill-plugins.js";
import { migration as m14 } from "./014-cron-job-block-kit-prompts.js";
import { migration as m15 } from "./015-add-stop-reaction.js";

// Register migrations here in version order.
export const migrations: Migration[] = [
  m1,
  m2,
  m3,
  m4,
  m5,
  m6,
  m7,
  m8,
  m9,
  m10,
  m11,
  m12,
  m13,
  m14,
  m15,
];
