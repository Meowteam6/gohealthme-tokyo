// The hero's second trust line (components/landing/Landing.tsx, HeroMore).
// Open beta (lib/open-beta.ts) names the beta and its money; with the switch
// off the line says how this deployment lets a player in: World ID, or the
// closed-beta list.

export function entryBadge(flags: { human: boolean; openBeta?: boolean }): string {
  if (flags.openBeta === true) return "Open beta, test USDC";
  return flags.human ? "One person, one entry" : "Invite-only beta";
}
