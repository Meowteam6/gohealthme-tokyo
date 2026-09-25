# Evaluating GoHealthMe V4 (ETHGlobal Tokyo 2026)

Live build: https://gohealthme-tokyo.vercel.app (V4's own Vercel project; V3 at www.gohealthme.app is untouched). Base Sepolia test USDC only.

## Verified by the session on 2026-09-26 (signed out)

| Check | Result |
|---|---|
| Landing, lobby, feed, character creation render | 200, no console errors |
| Lobby reads V4's contract `0x0B6E8D47...A12F` | 3 runs, 1 USDC stake, 2 USDC pot, live countdown |
| SPOTTER's Circle wallet | `0x5BEC...d483` on Base Sepolia, 2 USDC budget |
| ENSv2 names | `senorclown.gohealthme.eth` reported available from Sepolia |
| Dares store | pre-check passes against V4's own Supabase |
| Database | 4 tables, RLS verified live (17 of 17 checks) |
| Tests | 1718 vitest, 70 forge, tsc and eslint clean, next build green |

## Your walk (phone width, about 10 minutes)

1. Open the live build on your phone. Tap **Make your player**.
2. **Sign in** with your email code. The header should flip to your wallet.
3. **Prove you are one human.** Until the World Portal keys are set this step says it is not switched on and lets you continue. That is expected.
4. **Pick your name.** Claim a label; it mints `<label>.gohealthme.eth` on Sepolia and shows the tx link. Check it on sepolia.app.ens.domains.
5. **Pair your sensor.** Junction shows "not set up" until Nikki's key lands. Expected.
6. **Lobby.** Each run shows Playable or Locked with a reason. Nothing lets you stake on a run your sensor cannot measure.
7. **Wallet.** Add practice money, then join run 1 (sleep, settles today 19:00 JST). Your USDC should drop by 1.00.
8. **The Run** (My runs): tally, time left, stake and prize.
9. After 19:00 JST: **The Verdict** on the run page. SPOTTER checks, then the payout or refund screen with a claim button. Confirm the USDC delta on Basescan.

## Known limits right now (honest)

- World ID: off until the Portal app exists (`WORLD_*` env). Production refuses mocked proofs by design.
- Junction: no API key, so no sensor can verify a goal yet. Runs will read locked.
- Intercepta: no key, so payout screening says "not enabled on this deployment".
- Google (Gemini): not set; SPOTTER uses its deterministic rule and says so.
- Preview deployments are missing three env vars that exist only on production; test on the live build above.

## Evidence

- Continuity split: README "Continuity" section; every commit after `a86387d` is the event.
- Addresses and tx hashes: `DEPLOYMENTS.md` Tokyo headings (Base Sepolia pools, ENSv2 Sepolia).
- QA punch list and fixes: `docs/QA-2026-09-26.md`.
