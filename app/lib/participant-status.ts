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
  pool: { settled: boolean; cancelled?: boolean; bountyModel?: number },
  p: {
    resultRecorded: boolean;
    verdict: boolean;
    multiplierBps: number;
    refunded?: boolean;
  },
  /** The World ID payout confirmation's final status, when one was asked
   *  for. A settled refund after a pay decision is not "no proof": the proof
   *  passed and only the human confirmation was missing. */
  approval?: "approved" | "declined" | "expired" | "cancelled" | null,
  /** SPOTTER read a hit on this run that was never confirmed (the approval
   *  status route's hit flag). A settled refund then is not "no proof". */
  hitUnconfirmed?: boolean,
): StatusLabel {
  // A cancelled pool owes every joiner their stake back; claimRefund() credits
  // it and flips `refunded`. Nothing about verification applies any more.
  if (pool.cancelled === true) {
    return p.refunded === true
      ? { text: "Run called off - stake claimed back", tone: "muted" }
      : { text: "Run called off - claim your stake back", tone: "warning" };
  }
  if (!p.resultRecorded) {
    if (pool.settled && approval !== undefined && approval !== null) {
      return approval === "approved"
        ? { text: "Refunded - result not recorded before settle", tone: "warning" }
        : { text: "Refunded - payout not confirmed", tone: "muted" };
    }
    if (pool.settled && hitUnconfirmed === true) {
      return { text: "Refunded - hit not confirmed before settle", tone: "muted" };
    }
    return pool.settled
      ? { text: "Refunded - no proof was submitted", tone: "muted" }
      : { text: "Pending verification", tone: "warning" };
  }
  if (p.verdict) {
    const multiplier = (p.multiplierBps / 10_000).toFixed(2);
    return { text: `Achieved at ${multiplier}x`, tone: "accent" };
  }
  if (!pool.settled) return { text: "Goal missed", tone: "muted" };
  // Self-staked (model 2): a recorded miss goes to the players who hit, or
  // comes back when nobody hit. Which one needs the pool's tally, which this
  // label does not have; the run page says it.
  return pool.bountyModel === 2
    ? { text: "Goal missed - see the run for your stake", tone: "muted" }
    : { text: "Goal missed - stake forfeited", tone: "muted" };
}
