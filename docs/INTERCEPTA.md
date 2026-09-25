# Intercepta payout screening

Every wallet SPOTTER is about to pay is screened against mainnet risk data
with one live Intercepta (Web3 Antivirus) call before the transaction is
signed. The result decides what happens next: clear signs, blocked is
excluded or held, unavailable holds. Nothing is signed on a guess and nothing
is mocked outside tests.

Stage word: hackathon build. Pools stay on Base Sepolia; the screening API
takes a bare address with no chain parameter, so the participant's wallet is
screened as the mainnet identity it is.

## Getting the API key (Andre, once)

1. Open https://intercepta.io/ethglobal and fill the form on that page:
   name, email, "what are you building" (optional, one line is enough:
   "GoHealthMe, SPOTTER screens every payee before settling USDC payouts").
2. The key arrives by email, "within a few hours during the event". Quota
   1,000 requests per key, valid through judging. More quota: message
   `@intercepta_` on X or Telegram, "typically approved within the hour".
3. Put it in `app/.env.local` as `INTERCEPTA_API_KEY=...` for local runs and
   in the `gohealthme-tokyo` Vercel project (Production and Preview) for the
   demo. Never in git.
4. Calibrate: `scripts/intercepta-probe.sh <andre-wallet> <spotter-wallet>`.
   It screens those plus four OFAC SDN Lazarus addresses through the same
   endpoint and prints `toxicScore` and trait names. Expect the clean
   wallets to clear and the sanctioned ones to carry `sanction_address`.

There is no self-serve or sandbox path; the form is the only one. The
`getting-started` page at docs.web3antivirus.io points at a Typeform for
non-hackathon keys.

## Env vars (server only)

| Var | Required | Meaning |
|---|---|---|
| `INTERCEPTA_API_KEY` | for gating | Unset means no gate and the UI says "Payout screening not enabled on this deployment." |
| `INTERCEPTA_BASE_URL` | no | Default `https://api.web3antivirus.io`. |
| `INTERCEPTA_BLOCK_TRAITS` | no | Comma-separated trait names that block. Default list below. |
| `INTERCEPTA_BLOCK_SCORE` | no | Block when `toxicScore >=` this. Unset means traits alone decide. The docs publish no score range; set it only after the probe. |
| `INTERCEPTA_TIMEOUT_MS` | no | Default 5000. One retry on transport errors and 5xx. |
| `X402_DEMO_SELLER_PAYTO` | no | Payee of the demo x402 seller. Default is a documented OFAC SDN address. |

## The rule (printed on every ledger row)

`block if any trait in {sanction_address, sanction_address_communication,
blacklist, known_scammer, initiator_scam_transactions, mixer_transfers,
fake_phishing_transfer, fake_phishing_contract_communication, rug_pull,
zero_address_risk}; toxicScore is reported, not decisive`

Victim-side traits (`attack_money_target`, `rug_pull_trader`) and exposure
traits (`non_kyc_transfers`, `suspicious_deployer`,
`suspicious_dex_pair_deployer`) never block: a payout gate must not punish
someone for having been scammed or for using a non-KYC exchange. The trait
names are the documented enum from
https://docs.web3antivirus.io/reference/quick-scan-address.

## Where it sits in the code

| File | What |
|---|---|
| `app/lib/server/screening/intercepta.ts` | The client. `GET /api/public/v2/extension/account/{address}/quick-scan`, `X-API-KEY`, 5s timeout, one retry, 1h per-address cache in the shared store, `parseQuickScan`, `decide`, `describeRule`. Statuses `clear`, `blocked`, `unavailable`, `unconfigured`. |
| `app/lib/server/screening/gate.ts` | `screenPayeeBeforeSigning`: runs the screen, writes the `screen` ledger row, throws `PayoutScreeningHold` on `blocked` and `unavailable`. |
| `app/lib/server/agent/spotter.ts` | Two fenced `// --- intercepta ---` blocks. In `recordResultAsSpotter` before `recordResult(verdict=true)` is signed, and in `settlePoolAsSpotter` before the settle lock and before `settle()` is signed. |
| `app/lib/server/agent/x402.ts` | Fenced blocks: the seller's `payTo` rides on the quote; `buyLive` screens it before `gw.pay()` signs. A 402 with no `payTo` is never paid. |
| `app/lib/server/agent/ledger.ts` | Ledger entry kind `screen` (provider, purpose, address, status, toxicScore, trait names, rule, reason, cached). |
| `app/app/api/screen/status/route.ts` | `GET /api/screen/status?goalId=` reads the newest screen row; `pending` with a key and no row, `unconfigured` without a key. Never calls Intercepta. |
| `app/app/api/screen/demo-seller/route.ts` | A real HTTP 402 x402 seller whose `payTo` is the OFAC address, for the blocked demo. |
| `app/components/intercepta/PayoutScreening.tsx` | The one line in The Verdict. Props `{ status, reason? }`. Plus `useScreeningStatus(goalId)` and `PayoutScreeningForGoal`. |
| `app/lib/server/agent/feed-view.ts`, `app/lib/agent-receipt.ts`, `app/components/AgentReceipt.tsx` | The screen row on the public feed and on the receipt; hold errors get honest labels. |

## Why two gates, and what "excluded" means here

`HealthPoolsV3.settle()` credits every recorded achiever in one transaction
and cannot leave one out. The only place a single payee can be excluded is
one step earlier: `recordResult(poolId, user, true, ...)` is what makes a
wallet an achiever. So:

- **record gate**: blocked means the achiever verdict is never recorded. At
  settle the contract treats the wallet as unadjudicated and refunds its own
  entry fee to `owed[]` (contract rule B-2). It is never paid the reward, and
  every other achiever in the pool is unaffected.
- **settle gate**: the literal before-it-is-signed line. It is also the only
  gate the legacy oracle-signer record path and the cron sweep pass through.
  A blocked wallet that was recorded before screening existed holds the
  pool's settle with a visible reason rather than paying it.
- **unavailable** (timeout, 5xx, quota, rejected key, unreadable body) holds
  at both gates. The run loop writes the error row, the browser poll (record)
  or the two-minute sweep (settle) retries, the cache never stores it.

## Before and after (continuity prize)

Same flow, same pool, same wallet. Open a V3 receipt from
www.gohealthme.app next to a V4 one.

| Step | V3 (fork `a86387d`) | V4 (this repo) |
|---|---|---|
| Verdict "pay" | recordResult signed immediately | `screen` row (`purpose: record`) lands first; blocked means no recordResult |
| Period ends | settle signed as soon as `canSettle` opened | `screen` row (`purpose: settle`) precedes the settle tx |
| Post-settle x402 chain read | paid whatever seller the 402 named | seller `payTo` screened; a flagged seller is refused before `gw.pay()` |
| Receipt | plan, spends, verdict, decision, record, settle | the same plus one screening line per gate |
| `/api/agent/feed` | no screening facts | `screen: { status, traits, toxicScore, reason }` on the claim |
| Screening down | not applicable | payout held, labelled "payout held until Intercepta answers", retried |

## Demo: one approved, one blocked

Prerequisites: `INTERCEPTA_API_KEY` set on the deployment; SPOTTER's Circle
wallet holds the oracle role (`scripts/set-agent-oracle.sh`) so the record
gate runs; a preview URL without the Vercel login wall.

**Approved payout (the human achiever).** Join a short pool with Andre's
Dynamic wallet, submit evidence, let SPOTTER reach "pay". The receipt shows
`Payout screening: clear.` before "recorded on-chain", and again before
"settled: +X.XX paid" with the Basescan link. Assert on `AchieverPaid`, not
on the tx status. The feed at `/agent` shows the same screen facts.

**Blocked payment (the sanctioned seller).** Nobody holds the key of a
sanctioned wallet, so the honest way to put one in a payment flow is as the
recipient of an agent payment. Set on the deployment:

```
X402_PRIVATE_KEY=<throwaway EOA; it needs no funds to be refused>
X402_CHAIN_READ_URL=https://<deployment>/api/screen/demo-seller
```

After the approved settle above, SPOTTER's post-settle chain-read purchase
quotes the demo seller, reads `payTo` = `0x098B716B8Aaf21512996dC57EB0615e2383E2f96`
(OFAC SDN, Lazarus Group, listed 2022-04-14), screens it live, and refuses
before any Gateway authorization is signed. The settle row's note reads
`chain-read purchase failed (payout held by screening: Intercepta blocked for
0x098B... at x402. Intercepta flagged sanction_address ...); the free-RPC
verification stands`. One flow, one approved USDC payout, one blocked agent
payment, both with the reason on screen.

**Blocked payout (a flagged participant).** Only if the probe shows a wallet
we own carrying a trait: add that trait to `INTERCEPTA_BLOCK_TRAITS` on a
demo-only deployment. The rule is printed on the row, so the judge sees
what decided it. Do not create a flagged wallet by touching a sanctioned
address; that is a sanctions violation, not a demo.

`curl -i https://<deployment>/api/screen/demo-seller` shows the raw 402 and
its `PAYMENT-REQUIRED` header; `curl https://<deployment>/api/screen/status?goalId=0x...`
shows the claim's screening state.

## Tests

`app/lib/server/screening/intercepta.test.ts` (client: documented URL and
header, clear, blocked by trait, blocked by score only when configured,
victim traits never block, cache hit and expiry, 5xx retried once then
unavailable, 403 not retried, timeout, unreadable body, unavailable never
cached, unconfigured never fetches), `gate.test.ts` (settle and record gates
against the real spotter functions: blocked signs nothing and takes no lock,
unavailable fails closed, clear proceeds with a row, unconfigured is a
no-op, repeats do not flood, false verdicts are not screened, goalId mirrors
the contract), `x402-gate.test.ts` (sanctioned seller refused before
`gw.pay`, down provider holds, clean seller paid, unnamed recipient never
paid, prepaid path unscreened), `app/api/screen/status/route.test.ts` and
`app/api/screen/demo-seller/route.test.ts`.

## Which users are worse off

- A participant whose wallet Intercepta flags: they are never paid the
  reward and get their own stake back at settle. They see it as soon as
  SPOTTER reaches the record step, on the receipt and in `/api/screen/status`,
  with the trait name. Still to do (UX lane): surface the same screen at
  character creation and the join gate so this is known before any stake.
  Until then this is the one segment that learns a limit after committing.
- Everyone, when Intercepta is down: payouts wait instead of paying. The
  receipt says "payout held until Intercepta answers" and the sweep retries.
- Deployments without a key: nothing changes and the line says so.

## API feedback for Intercepta (3 to 5 lines for the README)

1. `toxicScore` has no documented range or threshold, so integrators cannot
   pick a score cutoff without calibrating against known addresses first.
2. There is no chain parameter on quick-scan; a note saying "address is
   screened across all supported chains" would remove the guesswork.
3. The reference lists 200 only; the real 403 body
   (`{"status":403,"response":"This authentication key is incorrect..."}`)
   and any 429 shape should be documented so clients can fail closed on
   purpose.
4. A documented test address that returns `sanction_address` (or a sandbox
   key with fixtures) would let teams prove the blocked path without
   pointing at a real SDN entry.
5. The ETHGlobal page says keys arrive "within a few hours"; a same-day
   self-serve key with a low quota would remove the one human gate in the
   integration.
