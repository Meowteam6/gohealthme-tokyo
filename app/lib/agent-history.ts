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
