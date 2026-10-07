// Open beta (Andre and Nikki, 2026-10-07). NEXT_PUBLIC_ACCESS_GATE_DISABLED=1
// used to be a Playwright-only switch that opened the closed beta; it is now
// the product's open-beta switch, set on production on purpose. With it on:
//
//   - the closed-beta list is gone: signing in is the whole way in
//   - World ID is OPTIONAL at every gate it used to hold. A player who verifies
//     keeps the "one human, one entry" badge and SPOTTER's World ID payout
//     confirmation; a player who skips it still creates a character, joins,
//     claims a name and is paid on the verdict alone
//   - the server agrees: requireHuman stands down, isAllowed passes everyone,
//     names are capped per wallet, unknown wallets are paid on the verdict
//
// With it off, everything behaves as the closed beta did (list or World).
// One reader for both the browser bundle and the server, so the two never
// disagree. NEXT_PUBLIC_ is inlined at build time: changing it means a
// redeploy, not a restart.

export function openBeta(): boolean {
  return process.env.NEXT_PUBLIC_ACCESS_GATE_DISABLED === "1";
}
