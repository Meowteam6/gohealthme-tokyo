// POST /api/blink/topup
//   (file path: app/app/api/blink/topup/route.ts -> route /api/blink/topup)
//
// WHAT THIS IS: a testnet faucet. It grants a small, fixed amount of in-app
// GoHealthMe balance so somebody new can try a pool without first hunting down
// testnet USDC.
//
// WHAT THIS IS NOT: a payment. Nothing is pulled from the caller's wallet,
// nothing settles on Base Sepolia, and no USDC changes hands here. The route
// name is a leftover from the Blink one-tap deposit experiment; the behaviour
// has only ever been a grant, so the limits and the UI copy now say so.
//
// WHY THE LIMITS: this route is unauthenticated and always was. The previous
// version credited a flat 10 USDC keyed on a caller-supplied `ref` string, so
// a fresh ref bought a fresh credit and a loop of curl calls plus
// /api/balance/withdraw drained the treasury. Safety here is by construction:
//   - the ledger idempotency key is derived server-side from the address, the
//     window, and the per-address grant sequence, never from the request body
//   - the grant is BALANCE-AWARE: it fires only for a wallet whose spendable
//     balance (on-chain Arc USDC plus any undelivered in-app balance) has
//     dropped below one grant's worth. A wallet that still holds practice money
//     is not topped up, so a user who SPENT their grant on a pool entry can
//     claim again before the window rolls over, while a funded wallet cannot
//     drain the treasury by tapping repeatedly. This replaced a flat one-grant-
//     per-window cooldown that locked a genuine user out the moment they spent.
//   - an absolute per-address cap of FAUCET_ADDRESS_DAILY_CAP_UUSDC per window,
//     reserved atomically, so an attacker who sends the grant away to slip back
//     under the balance threshold still draws a bounded amount per address
//   - a global budget per window, because fresh addresses cost an attacker
//     nothing and a per-address limit alone therefore bounds nothing
//   - a treasury floor, because in-app balance is a claim on real Arc USDC
// The cap arithmetic lives in app/lib/money-guards.ts with unit tests; the
// atomic reservation lives in app/app/api/_money/rate-limit.ts.
//
// Request JSON:  { address: string, auto?: boolean }
//   `auto: true` marks a grant the app fired automatically (the first-block
//   auto-fund) rather than one a user deliberately tapped. Automatic grants are
//   charged against FAUCET_AUTO_BUDGET_UUSDC, a lower reserve, so incidental
//   page loads cannot exhaust the budget a deliberate tap needs. It can only
//   narrow the budget for a request, never widen it.
//   A `ref` field is accepted and IGNORED. It used to be the idempotency key
//   and old clients still send one; honouring it is the exploit.
//
// Response JSON:
//   503 new money is paused on this build (KILL_BASE_MONEY_IN): nothing read,
//       reserved or credited. Money already in is untouched.
//   200 { balanceUusdc: string, grantedUusdc: string, applied: boolean }
//       applied:false with grantedUusdc "0" is the honest no-op for a wallet
//       that already holds enough practice money - a skip, not a failure.
//   400 bad address
//   429 per-address daily cap or global budget exhausted (with Retry-After)
//   503 treasury too low, balance unreadable, or the ledger is busy | 500

import { isAddress, type Address } from "viem";
import { credit, getBalance } from "@/lib/server/balance";
import { killSwitches } from "@/lib/server/kill-switches";
import { MONEY_ALREADY_IN_LINE, withKillReason } from "@/lib/switches";
import { jsonError, readJsonBody } from "@/lib/server/http";
import {
  USDC_ADDRESS,
  erc20Abi,
  formatUsdc,
  getArcPublicClient,
} from "@/lib/contract";
import {
  FAUCET_ADDRESS_DAILY_CAP_UUSDC,
  FAUCET_AUTO_BUDGET_UUSDC,
  FAUCET_COOLDOWN_MS,
  FAUCET_DAILY_BUDGET_UUSDC,
  FAUCET_GRANT_UUSDC,
  FAUCET_REFILL_BALANCE_THRESHOLD_UUSDC,
  faucetClaimRef,
  serverFailure,
  treasuryCanCover,
} from "@/lib/money-guards";
import { treasuryUsdcBalanceUusdc } from "@/app/api/_money/treasury-balance";
import {
  LEDGER_LOCK,
  releaseFromWindow,
  spendFromWindow,
  withLock,
} from "@/app/api/_money/rate-limit";

// The floor check reads Arc over RPC, which needs the Node runtime.
export const runtime = "nodejs";

const SCOPE = "api/blink/topup";
const GLOBAL_BUDGET_KEY = "faucet:global";

/** 429 with an honest wait, so a client can show a countdown, not a stack trace. */
function tooManyRequests(message: string, retryAfterSeconds: number): Response {
  return Response.json(
    { error: message, retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

function hoursFrom(seconds: number): string {
  const hours = Math.ceil(seconds / 3600);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * How much spendable practice USDC a wallet holds right now, in uUSDC, and how
 * much of that is still sitting in the in-app ledger.
 *
 * `spendableUusdc` is the on-chain Arc USDC that actually pays gas and pool
 * entry fees PLUS any in-app ledger balance not yet delivered onto Arc. Reading
 * both matters: the funding chain (lib/faucet-funding.ts) withdraws every grant
 * onto Arc, so a funded wallet reads ~0 in the ledger while holding real USDC
 * on chain. A balance-aware faucet that looked only at the ledger would see
 * that zero and re-grant on every tap - a treasury drain - so the on-chain
 * figure is the one that tells us whether the user has genuinely run out.
 *
 * `inAppUusdc` is returned alongside so the skip response can report the ledger
 * balance the success contract already carries, without a second read.
 */
async function readSpendable(
  address: Address,
): Promise<{ spendableUusdc: bigint; inAppUusdc: bigint }> {
  const [onChainUusdc, inAppUusdc] = await Promise.all([
    getArcPublicClient().readContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    }),
    getBalance(address),
  ]);
  return { spendableUusdc: onChainUusdc + inAppUusdc, inAppUusdc };
}

export async function POST(request: Request) {
  try {
    // New test USDC is new money: refused first, before any read or
    // reservation, while KILL_BASE_MONEY_IN is thrown.
    const switches = killSwitches();
    if (switches.baseMoneyIn) {
      return jsonError(
        503,
        withKillReason(
          `Test USDC top-ups are paused for now, along with new stakes. ${MONEY_ALREADY_IN_LINE} Nothing was credited.`,
          switches.reason,
        ),
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch {
      return jsonError(400, "Body must be a JSON object.");
    }

    const { address, auto } = body;
    if (typeof address !== "string" || !isAddress(address)) {
      return jsonError(400, "address must be a valid 0x address");
    }
    // A grant the app fires AUTOMATICALLY (the first-block auto-fund) is charged
    // against a lower reserve so incidental page loads cannot drain the budget a
    // deliberate tap - a real user, or the on-camera demo - needs. Any non-true
    // value (absent, false) is a deliberate grant. This only ever NARROWS the
    // budget for a request, never widens it.
    const isAuto = auto === true;
    const budgetCapUusdc = isAuto
      ? FAUCET_AUTO_BUDGET_UUSDC
      : FAUCET_DAILY_BUDGET_UUSDC;
    const recipient = address as Address;
    const now = Date.now();
    const addressKey = `faucet:address:${recipient.toLowerCase()}`;

    // 1. Treasury floor first, because it is a pure read: checking it before
    //    anything is reserved means the common refusal needs no cleanup.
    //    In-app balance is a claim on real Arc USDC, so the faucet must not
    //    write claims the treasury cannot honour.
    let treasuryUusdc: bigint;
    try {
      treasuryUusdc = await treasuryUsdcBalanceUusdc();
    } catch (err) {
      return serverFailure(SCOPE, err, {
        status: 503,
        message:
          "Could not read the treasury balance, so no faucet grant was made.",
      });
    }
    if (!treasuryCanCover(treasuryUusdc, FAUCET_GRANT_UUSDC)) {
      return jsonError(
        503,
        "The testnet treasury is too low to back a faucet grant right now. Nothing was credited.",
      );
    }

    // 2. Balance-aware eligibility, also a pure read so it needs no cleanup.
    //    The faucet exists to unblock a wallet that has run out of practice
    //    USDC, not to top up one that still has some. A wallet holding at least
    //    one grant's worth of spendable balance does not need more, and
    //    re-granting it on every tap is how the treasury drains. Reading the
    //    on-chain balance (not just the in-app ledger, which the funding chain
    //    empties onto Arc after every grant) is what lets a user who SPENT their
    //    grant on a pool entry claim again before the window rolls over: their
    //    spendable balance is now below the threshold. This is not a cap and not
    //    an error - it is a skip, reported as applied:false so the funding chain
    //    can still deliver any undelivered in-app balance onto Arc.
    let spendableUusdc: bigint;
    let inAppUusdc: bigint;
    try {
      ({ spendableUusdc, inAppUusdc } = await readSpendable(recipient));
    } catch (err) {
      return serverFailure(SCOPE, err, {
        status: 503,
        message:
          "Could not read your current balance, so no faucet grant was made.",
      });
    }
    if (spendableUusdc >= FAUCET_REFILL_BALANCE_THRESHOLD_UUSDC) {
      return Response.json({
        balanceUusdc: inAppUusdc.toString(),
        grantedUusdc: "0",
        applied: false,
      });
    }

    // 3. Absolute per-address ceiling, reserved atomically so two simultaneous
    //    requests for the same address cannot both slip past it. This bounds an
    //    attacker who empties a wallet between grants to slip back under the
    //    balance threshold: no address is granted more than
    //    FAUCET_ADDRESS_DAILY_CAP_UUSDC per window however it shuffles funds.
    //    The reserved running total is the grant sequence the ledger ref uses,
    //    so each grant this window credits a distinct ref instead of collapsing.
    const perAddress = await spendFromWindow(
      addressKey,
      FAUCET_GRANT_UUSDC,
      FAUCET_ADDRESS_DAILY_CAP_UUSDC,
      FAUCET_COOLDOWN_MS,
      now,
    );
    if (perAddress.kind === "deny") {
      return tooManyRequests(
        `This address has reached its daily practice-money limit of ${formatUsdc(FAUCET_ADDRESS_DAILY_CAP_UUSDC)} USDC. Try again in about ${hoursFrom(perAddress.retryAfterSeconds)}.`,
        perAddress.retryAfterSeconds,
      );
    }
    // Running per-address total including this reservation. Distinct per grant,
    // so the ledger ref below is distinct per grant.
    const reservedTotalUusdc =
      FAUCET_ADDRESS_DAILY_CAP_UUSDC - perAddress.remainingUusdc;

    // 4. Global budget across every address. This is the guard that actually
    //    bounds a scripted attack, since fresh addresses are free.
    const budget = await spendFromWindow(
      GLOBAL_BUDGET_KEY,
      FAUCET_GRANT_UUSDC,
      budgetCapUusdc,
      FAUCET_COOLDOWN_MS,
      now,
    );
    if (budget.kind === "deny") {
      await releaseFromWindow(
        addressKey,
        FAUCET_GRANT_UUSDC,
        FAUCET_COOLDOWN_MS,
        now,
      );
      return tooManyRequests(
        isAuto
          ? "The automatic faucet reserve for today is used up. Tap Get test USDC to draw from the full faucet."
          : `The faucet has handed out its ${formatUsdc(FAUCET_DAILY_BUDGET_UUSDC)} USDC for today. Try again tomorrow.`,
        budget.retryAfterSeconds,
      );
    }

    // 5. Credit under the server-derived ref for this grant sequence. A retry of
    //    the SAME reserved slot produces the same ref, so the ledger applies it
    //    exactly once; a later, legitimate grant in the same window carries a
    //    higher sequence and a distinct ref, so a user who spent their money is
    //    not silently deduped. The ledger lock is what stops this write from
    //    clobbering a concurrent debit elsewhere: the ledger is one JSON blob
    //    with no compare-and-swap, so every mutation of it has to be serialised.
    let applied: boolean;
    try {
      const outcome = await withLock(LEDGER_LOCK, () =>
        credit(
          recipient,
          FAUCET_GRANT_UUSDC,
          faucetClaimRef(recipient, now, reservedTotalUusdc),
        ),
      );
      if (outcome.kind === "busy") {
        await releaseFromWindow(
          addressKey,
          FAUCET_GRANT_UUSDC,
          FAUCET_COOLDOWN_MS,
          now,
        );
        await releaseFromWindow(
          GLOBAL_BUDGET_KEY,
          FAUCET_GRANT_UUSDC,
          FAUCET_COOLDOWN_MS,
          now,
        );
        return jsonError(
          503,
          "Another balance operation is in progress. Nothing was granted; try again in a moment.",
        );
      }
      applied = outcome.value.applied;
    } catch (err) {
      // Nothing was granted, so hand both reservations back.
      await releaseFromWindow(
        addressKey,
        FAUCET_GRANT_UUSDC,
        FAUCET_COOLDOWN_MS,
        now,
      );
      await releaseFromWindow(
        GLOBAL_BUDGET_KEY,
        FAUCET_GRANT_UUSDC,
        FAUCET_COOLDOWN_MS,
        now,
      );
      return serverFailure(SCOPE, err, {
        status: 503,
        message: "Could not credit the faucet grant, so nothing was granted.",
      });
    }

    // The ledger deduped this reserved slot's ref, so no balance moved. Hand
    // both reservations back rather than silently burning them.
    if (!applied) {
      await releaseFromWindow(
        addressKey,
        FAUCET_GRANT_UUSDC,
        FAUCET_COOLDOWN_MS,
        now,
      );
      await releaseFromWindow(
        GLOBAL_BUDGET_KEY,
        FAUCET_GRANT_UUSDC,
        FAUCET_COOLDOWN_MS,
        now,
      );
    }

    const balance = await getBalance(recipient);
    return Response.json({
      balanceUusdc: balance.toString(),
      grantedUusdc: applied ? FAUCET_GRANT_UUSDC.toString() : "0",
      applied,
    });
  } catch (err) {
    return serverFailure(SCOPE, err);
  }
}
