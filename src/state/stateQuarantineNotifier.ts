import { logger } from "../logger.js";
import { errorMessage } from "../errors.js";
import { getOwnerUserId, sendOwnerDm, type OwnerNotifierDeps } from "../slack/ownerDm.js";
import { t } from "../i18n/t.js";
import type { QuarantineEntry, QuarantineReport } from "./resilientCollection.js";
import { setStateQuarantineSink } from "./stateQuarantineRegistry.js";

export type StateQuarantineNotifierDeps = OwnerNotifierDeps;

export const defaultStateQuarantineNotifierDeps: StateQuarantineNotifierDeps = {
  getOwnerUserId,
  sendOwnerDm,
};

function buildQuarantineText(source: string, entries: QuarantineEntry[]): string | null {
  if (entries.length === 0) return null;
  const lines = entries.map((e) =>
    t("state.quarantine.dm_entry", { key: e.key, field: e.field, error: e.error }),
  );
  return [
    t("state.quarantine.dm_title", { count: entries.length, source }),
    ...lines,
    "",
    t("state.quarantine.dm_footer"),
  ].join("\n");
}

function buildFreezeText(source: string, snapshotPath: string | null): string {
  const snapshotLine = snapshotPath
    ? t("state.quarantine.freeze_snapshot", { path: snapshotPath })
    : t("state.quarantine.freeze_no_snapshot");
  return [
    t("state.quarantine.freeze_title", { source }),
    snapshotLine,
    "",
    t("state.quarantine.freeze_footer"),
  ].join("\n");
}

/**
 * DM the workspace owner about a quarantine or a persistence freeze in some store. Best-effort: every
 * failure is logged and swallowed so a load path never breaks. `report.source` labels the store.
 */
export async function notifyOwnerOfStateQuarantine(
  report: QuarantineReport,
  deps: StateQuarantineNotifierDeps = defaultStateQuarantineNotifierDeps,
): Promise<void> {
  try {
    const owner = await deps.getOwnerUserId();
    if (!owner) {
      logger.info("state-quarantine-notify: no owner configured — skipping DM");
      return;
    }
    const text = report.frozen
      ? buildFreezeText(report.source, report.frozen.snapshotPath)
      : buildQuarantineText(report.source, report.quarantined);
    if (!text) return;
    await deps.sendOwnerDm(owner, text, { suppressUnfurls: true });
  } catch (err) {
    logger.warn(`state-quarantine-notify: failed: ${errorMessage(err)}`);
  }
}

/** Wire the owner-notification sink into every store's load path. Called once at boot. */
export function registerStateQuarantineNotifier(
  deps: StateQuarantineNotifierDeps = defaultStateQuarantineNotifierDeps,
): void {
  setStateQuarantineSink((report) => {
    notifyOwnerOfStateQuarantine(report, deps).catch((err) =>
      logger.warn(`state-quarantine-notify: unexpected error: ${errorMessage(err)}`),
    );
  });
}
