import {
  getQuarantinedJobSummaries,
  retryQuarantinedJob,
  deleteQuarantinedJob,
  isCronPersistenceFrozen,
  setCronQuarantineNotifier,
} from "../cronJobs.js";
import { registerQuarantineStore, emitStateQuarantine } from "./stateQuarantineRegistry.js";

const CRON_SOURCE = "cron schedules";

/**
 * Fold cron into the unified quarantine surface without touching its internals: register a registry
 * descriptor over cron's existing accessors (its quarantine is keyed by positional index, adapted to
 * the string key the registry uses), and route cron's quarantine/freeze notifications through the
 * shared owner-DM sink. Called once at boot.
 */
export function registerCronQuarantineStore(): void {
  setCronQuarantineNotifier((report) => {
    emitStateQuarantine({
      source: CRON_SOURCE,
      quarantined: report.quarantined.map((e) => ({ key: e.id, field: e.field, error: e.error })),
      frozen: report.frozen,
    });
  });

  registerQuarantineStore({
    storeId: "cron",
    label: CRON_SOURCE,
    getSummaries: async () => {
      const summaries = await getQuarantinedJobSummaries();
      return summaries.map((s) => ({ key: String(s.index), field: s.field, error: s.error }));
    },
    retry: (key) => retryQuarantinedJob(Number(key)),
    remove: (key) => deleteQuarantinedJob(Number(key)),
    isFrozen: isCronPersistenceFrozen,
  });
}
