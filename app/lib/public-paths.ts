// Which routes render without character creation in front of them.
//
// Browsing is public: the landing, the legal pages, public profiles, invite
// links, the lobby (/pools, exact) and the payout feed (/feed). A signed-out
// visitor can read every open run and every payout before committing to
// anything. Taking a position is not: the run page (/pools/<id>), the create
// forms and every money surface stay behind the gate, and the server keeps
// enforcing isAllowed on the routes that act regardless of what renders.
//
// Kept in lib (not in the AccessGate client component) so the rule is testable
// without pulling in the character-creation tree.

const PUBLIC_EXACT = new Set(["/", "/privacy", "/terms", "/pools", "/feed"]);
const PUBLIC_PREFIXES = ["/u/", "/c/"];

export function isPublicPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (PUBLIC_EXACT.has(path)) return true;
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}
