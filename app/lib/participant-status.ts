// The dashboard's per-pool status line, derived from the chain alone.
//
// The pool must be read alongside the participant. HealthPoolsV3's settle()
// refunds anyone the oracle never adjudicated (B-2) but does NOT set the
// participant's `refunded` flag - that flag belongs to claimRefund on a
// cancelled pool - so once a pool has settled, "no result recorded" no longer
// means "still waiting"; it means the stake went back. Measured live 2026-09-04:
// four settled, refunded pools read "Pending verification" because this label
// used to look at the participant only.

export type StatusTone = "accent" | "muted" | "warning";

export interface StatusLabel {
  text: string;
  tone: StatusTone;
}

export function resultLabel(
  pool: { settled: boolean; cancelled?: boolean },
  p: {
    resultRecorded: boolean;
    verdict: boolean;
    multiplierBps: number;
    refunded?: boolean;
  },
): StatusLabel {
  // A cancelled pool owes every joiner their stake back; claimRefund() credits
  // it and flips `refunded`. Nothing about verification applies any more.
  if (pool.cancelled === true) {
    return p.refunded === true
      ? { text: "Pool cancelled - refund claimed", tone: "muted" }
      : { text: "Pool cancelled - claim your refund", tone: "warning" };
  }
  if (!p.resultRecorded) {
    return pool.settled
      ? { text: "Refunded - no proof was submitted", tone: "muted" }
      : { text: "Pending verification", tone: "warning" };
  }
  if (p.verdict) {
    const multiplier = (p.multiplierBps / 10_000).toFixed(2);
    return { text: `Achieved at ${multiplier}x`, tone: "accent" };
  }
  return pool.settled
    ? { text: "Goal missed - stake forfeited", tone: "muted" }
    : { text: "Goal missed", tone: "muted" };
}
