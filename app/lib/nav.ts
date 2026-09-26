// The header nav (components/Header.tsx), kept in lib so it is testable
// without rendering the header.
//
// "Create pool" is deliberately NOT here. It is the sponsor's action - it
// costs money and a first-time visitor has none - so it lives one level down,
// as the primary button on /pools, and the create-run page links to the
// sponsor console ("Put up a prize pot"). Named for the game loop: the lobby is
// where runs are, "My runs" is the scoreboard for the ones you entered,
// History is SPOTTER's verdicts and payouts (yours first), Settings holds the
// wallet. Routes are unchanged.

export interface NavItem {
  href: string;
  label: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/pools", label: "Lobby" },
  { href: "/dashboard", label: "My runs" },
  { href: "/agent", label: "History" },
  { href: "/challenges", label: "Dares" },
  { href: "/settings", label: "Settings" },
];
