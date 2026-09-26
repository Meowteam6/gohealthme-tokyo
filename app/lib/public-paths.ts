// Which routes render without character creation in front of them.
//
// Browsing is public: the landing, the legal pages, public profiles, invite
// links, the lobby (/pools, exact), the payout feed (/feed) and History
// (/agent, SPOTTER's public claims feed). A signed-out visitor can read every
// open run and every payout before committing to anything.
//
// A run page (/pools/<id>) is readable signed out, so "Put 1 USDC on myself"
// on the landing lands on the run itself, with its terms and a "Sign in to
// stake" action, instead of on a wall. It is a preview only: once a visitor
// signs in, the run page goes back behind character creation, so a player who
// has not proved they are one person is sent to do that before the hold button
// is ever in front of them, never refused at the stake. The create forms and
// every other money surface stay behind the gate, and the server keeps
// enforcing isAllowed on every route that acts regardless of what renders.
//
// Kept in lib (not in the AccessGate client component) so the rule is testable
// without pulling in the character-creation tree.

const PUBLIC_EXACT = new Set(["/", "/privacy", "/terms", "/pools", "/feed", "/agent"]);
const PUBLIC_PREFIXES = ["/u/", "/c/"];
const SIGNED_OUT_PREVIEW = /^\/pools\/\d+$/;

function normalise(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

export function isPublicPath(pathname: string): boolean {
  const path = normalise(pathname);
  if (PUBLIC_EXACT.has(path)) return true;
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** A route a signed-out visitor may read (a run page by its numeric id). */
export function isSignedOutPreviewPath(pathname: string): boolean {
  return SIGNED_OUT_PREVIEW.test(normalise(pathname));
}

/** Whether a route renders without the character gate for this visitor. */
export function rendersWithoutGate(
  pathname: string,
  visitor: { ready: boolean; signedIn: boolean },
): boolean {
  if (isPublicPath(pathname)) return true;
  return visitor.ready && !visitor.signedIn && isSignedOutPreviewPath(pathname);
}
