// The History page (/agent): the signed-in player's own SPOTTER entries first,
// everyone's public feed behind one toggle. Pure, so the choice is testable
// without rendering the feed.

export type HistoryView = "mine" | "everyone";

/** Signed in, the page leads with your own entries; signed out, there is no
 *  "own", so the public feed is the page. */
export function defaultHistoryView(signedIn: boolean): HistoryView {
  return signedIn ? "mine" : "everyone";
}

/**
 * The entries to render. `mine` is only ever what the server matched to the
 * player's address; when it is missing (signed out, or an older response) the
 * "mine" view is empty rather than a guess drawn from everyone's feed.
 */
export function historyItems<T>(
  feed: { claims: T[]; mine?: T[] },
  view: HistoryView,
): T[] {
  return view === "mine" ? (feed.mine ?? []) : feed.claims;
}

/** Where a recorded miss's stake ended up, from its closing ledger row. */
export type MissOutcome = "pending" | "forfeited" | "refunded" | "cancelled";

/**
 * What a recorded miss did with the stake, in plain words: goes (before the
 * pool settles, with the two ways it comes back), went (settle paid the
 * players who hit), came back (nobody hit), or can be claimed back (the
 * creator cancelled the run before it settled; HealthPoolsV3 cancelPool has
 * no time guard, so a recorded miss is refundable until settle). `own` picks
 * "Your" on the player's own history and "The" on everyone's. Never
 * "lost", never a bet.
 */
export function missStakeLine(
  outcome: MissOutcome,
  stakeUsd: string | null,
  own: boolean,
): string {
  const whose = own ? "your" : "the";
  const stake = stakeUsd !== null ? `${whose} ${stakeUsd} stake` : `${whose} stake`;
  const Stake = stake.charAt(0).toUpperCase() + stake.slice(1);
  switch (outcome) {
    case "forfeited":
      return `Missed. ${Stake} went to the players who hit.`;
    case "refunded":
      return `Missed, but nobody hit, so ${stake} came back.`;
    case "cancelled":
      return `Missed, but the creator cancelled the run, so ${stake} can be claimed back.`;
    default:
      // Conditional until settle (docs/MONEY-FLOWS.md section 3, History).
      return `Missed. At settle ${stake} goes to who hits, or comes back if nobody does. A cancel before settle gives it back too.`;
  }
}

/** The History card's miss line, or null when the claim is not a miss. */
export function missLineOf(
  claim: {
    missed?: true;
    stakeUsd?: string;
    settle: { status: string; outcome?: Exclude<MissOutcome, "pending"> } | null;
  },
  own: boolean,
): string | null {
  if (claim.missed !== true) return null;
  const outcome =
    claim.settle?.status === "closed" && claim.settle.outcome !== undefined
      ? claim.settle.outcome
      : "pending";
  return missStakeLine(outcome, claim.stakeUsd ?? null, own);
}
