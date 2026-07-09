export class PoolExhausted extends Error {
  constructor(repo: string, queueDepth: number, maxQueueDepth: number) {
    super(
      `Worker pool for repo '${repo}' is at capacity (queue ${queueDepth}/${maxQueueDepth}). Try again shortly.`,
    );
    this.name = "PoolExhausted";
  }
}

export class DirtyWorkerQuarantined extends Error {
  readonly workerId: string;
  readonly dirtyFiles: string[];

  constructor(workerId: string, dirtyFiles: string[]) {
    super(
      `Worker ${workerId} has uncommitted modifications in ${dirtyFiles.length} file(s) and was quarantined.`,
    );
    this.name = "DirtyWorkerQuarantined";
    this.workerId = workerId;
    this.dirtyFiles = dirtyFiles;
  }
}

export class AlreadyInFlight extends Error {
  readonly repo: string;
  readonly branch: string;
  readonly claimedBy: string;

  constructor(repo: string, branch: string, claimedBy: string) {
    super(
      `Branch '${branch}' on repo '${repo}' is already in flight (claimed by session ${claimedBy}).`,
    );
    this.name = "AlreadyInFlight";
    this.repo = repo;
    this.branch = branch;
    this.claimedBy = claimedBy;
  }
}

export class RemoteBranchNotFound extends Error {
  readonly branch: string;

  constructor(repo: string, branch: string) {
    super(
      `Remote branch 'origin/${branch}' for repo '${repo}' was not found — cannot resume it (refusing to fall back to the default branch, which would discard the PR's commits).`,
    );
    this.name = "RemoteBranchNotFound";
    this.branch = branch;
  }
}

export class RemoteBranchUnreachable extends Error {
  readonly branch: string;

  constructor(repo: string, branch: string, reason: string) {
    super(
      `Could not reach origin to resume branch '${branch}' on repo '${repo}' (${reason}). The branch may still exist — retry shortly.`,
    );
    this.name = "RemoteBranchUnreachable";
    this.branch = branch;
  }
}

export class Cancelled extends Error {
  readonly reason: string | undefined;

  constructor(reason?: string) {
    super(reason ? `Cancelled: ${reason}` : "Cancelled");
    this.name = "Cancelled";
    this.reason = reason;
  }
}
