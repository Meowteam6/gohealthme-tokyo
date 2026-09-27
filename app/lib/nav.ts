// The header nav (components/Header.tsx), kept in lib so it is testable
// without rendering the header.
//
// "Create pool" is deliberately NOT here. It is the sponsor's action - it
// costs money and a first-time visitor has none - so it lives one level down,
// as the primary button on /pools, and the create page links to the sponsor
// console ("Sponsor a challenge"). One vocabulary (Andre, 2026-09-27): a
// CHALLENGE is anything a player can join, so the lobby tab is "Challenges",
// "My challenges" is the scoreboard for the ones you entered, History is
// SPOTTER's verdicts and payouts (yours first), Settings holds the wallet.
// /challenges (challenges with friends) left the nav; the lobby and My
// challenges link to it. Routes are unchanged.

export interface NavItem {
  href: string;
  label: string;
}

/** A signed-out visitor's header: where the challenges are and how one pays.
 *  The player tabs mean nothing before there is a player. */
export const SIGNED_OUT_NAV_ITEMS: readonly NavItem[] = [
  { href: "/pools", label: "Challenges" },
  { href: "/#how", label: "How it pays" },
];

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/pools", label: "Challenges" },
  { href: "/dashboard", label: "My challenges" },
  { href: "/agent", label: "History" },
  { href: "/settings", label: "Settings" },
];
