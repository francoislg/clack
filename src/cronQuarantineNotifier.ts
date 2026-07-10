import { logger } from "./logger.js";
import { errorMessage } from "./errors.js";
import { getOwnerUserId, sendOwnerDm, type OwnerNotifierDeps } from "./slack/ownerDm.js";
import { t } from "./i18n/t.js";
import {
  setCronQuarantineNotifier,
  type CronQuarantineEntry,
  type CronQuarantineReport,
} from "./cronJobs.js";

export type CronQuarantineNotifierDeps = OwnerNotifierDeps;

export const defaultCronQuarantineNotifierDeps: CronQuarantineNotifierDeps = {
  getOwnerUserId,
  sendOwnerDm,
};

function buildQuarantineText(entries: CronQuarantineEntry[]): string | null {
  if (entries.length === 0) return null;
  const lines = entries.map((e) =>
    t("cron.quarantine.dm_job", { id: e.id, field: e.field, error: e.error }),
  );
  return [
    t("cron.quarantine.dm_title", { count: entries.length }),
    ...lines,
    "",
    t("cron.quarantine.dm_footer"),
  ].join("\n");
}

function buildFreezeText(snapshotPath: string | null): string {
  const snapshotLine = snapshotPath
    ? t("cron.quarantine.freeze_snapshot", { path: snapshotPath })
    : t("cron.quarantine.freeze_no_snapshot");
  return [
    t("cron.quarantine.freeze_title"),
    snapshotLine,
    "",
    t("cron.quarantine.freeze_footer"),
  ].join("\n");
}

/**
 * DM the workspace owner about a quarantine or a persistence freeze. Best-effort: every failure
 * (no owner configured, no Slack client, DM rejected) is logged and swallowed so the load path
 * never breaks. A freeze report and a quarantine report are mutually exclusive per load.
 */
export async function notifyOwnerOfCronQuarantine(
  report: CronQuarantineReport,
  deps: CronQuarantineNotifierDeps = defaultCronQuarantineNotifierDeps,
): Promise<void> {
  try {
    const owner = await deps.getOwnerUserId();
    if (!owner) {
      logger.info("cron-quarantine-notify: no owner configured — skipping DM");
      return;
    }

    const text = report.frozen
      ? buildFreezeText(report.frozen.snapshotPath)
      : buildQuarantineText(report.quarantined);
    if (!text) return;

    await deps.sendOwnerDm(owner, text, { suppressUnfurls: true });
  } catch (err) {
    logger.warn(`cron-quarantine-notify: failed: ${errorMessage(err)}`);
  }
}

/**
 * Wire the notifier into the cron load path. Called once at boot. The registered callback is
 * synchronous and fires-and-forgets the async DM so `loadJobs` never awaits Slack I/O.
 */
export function registerCronQuarantineNotifier(
  deps: CronQuarantineNotifierDeps = defaultCronQuarantineNotifierDeps,
): void {
  setCronQuarantineNotifier((report) => {
    notifyOwnerOfCronQuarantine(report, deps).catch((err) =>
      logger.warn(`cron-quarantine-notify: unexpected error: ${errorMessage(err)}`),
    );
  });
}
