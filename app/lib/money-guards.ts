// Guards for the GoHealthMe money routes.
//
// WHY THIS EXISTS
// The faucet and the balance withdrawal are callable by anyone with curl.
// There is no wallet-signature auth in front of them and adding one would
// break the one-tap flow the product is built on, so safety here comes from
// the SHAPE OF THE RULES rather than from knowing who is calling. Every guard
// below is a pure function over (stored state, request, now): the cap
// arithmetic, the cooldown windows, and the treasury floor are unit-testable
// and cannot drift between the routes that enforce them.
//
// THE INVARIANTS THESE BUY
//   - The faucet only grants to a wallet whose spendable balance has fallen
//     below FAUCET_REFILL_BALANCE_THRESHOLD_UUSDC, so a wallet that still holds
//     practice money is never topped up further. This is what lets a genuine
//     user who SPENT their grant on a pool entry get more before the window
//     rolls over, without opening a treasury drain for a wallet that is fine.
//   - One address is granted at most FAUCET_ADDRESS_DAILY_CAP_UUSDC per
//     FAUCET_COOLDOWN_MS, the absolute per-address ceiling that bounds an
//     attacker who empties a wallet between grants (send-out, then re-claim).
//   - Across all addresses the faucet cannot hand out more than
//     FAUCET_DAILY_BUDGET_UUSDC per window, so a script with a thousand fresh
//     addresses is bounded by the budget rather than by the address count.
//   - One address cannot move more than WITHDRAW_DAILY_CAP_UUSDC of real Arc
//     USDC out of the treasury per window.
//   - No route may take the treasury below TREASURY_FLOOR_UUSDC. Refusing is
//     the correct answer; attempting a transfer that empties the treasury is
//     not.
//   - The Blink signer only ever authorizes a deposit INTO the merchant, in
//     the configured token, on the configured chain, under a hard amount cap.
//
// Amounts are uUSDC: integer micro-USDC with 6 decimals (1 USDC == 1_000_000n).
// This module is dependency-free and safe to import from a client component;
// BalanceCard reads the withdraw cap so its button can tell the truth about
// how much it is going to move.

// ------------------------------------------------------------------ constants

/** One day in milliseconds. Both rate windows use it. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Faucet grant per top-up: 12.00 USDC. Pool entry fees run up to 10 USDC and
 * joins are gas-sponsored, so a grant just needs to cover one entry with a
 * little margin - the old 0.50 grant left a wallet unable to join anything and
 * was the pilot-blocking bug. It is deliberately NOT much larger: testnet USDC
 * is faucet-scarce (the treasury refills at ~1 USDC/5min from the CDP faucet,
 * see cron/treasury-topup), so a grant far above the entry fee only strands
 * USDC in idle wallets and funds fewer total joins. Paired with the refill
 * threshold below (a wallet is topped up whenever it holds less than one grant),
 * this self-refills a player across successive 10 USDC joins. It must also stay
 * below what the treasury can cover after the 5 USDC floor.
 */
export const FAUCET_GRANT_UUSDC = 12_000_000n;

/** An address may claim the faucet once per this interval. */
export const FAUCET_COOLDOWN_MS = DAY_MS;

/**
 * Total the faucet may hand out across every address inside one window: 2,400
 * USDC (pilot capacity: ~200 grants/day at 12 each). This is the guard that
 * actually bounds a scripted attack, because fresh addresses are free and the
 * per-address cap alone is not a limit. It is additionally bounded by the live
 * treasury balance via treasuryCanCover, so raising it never hands out more
 * USDC than the treasury actually holds - the treasury balance, not this
 * number, is the real ceiling, so keep the treasury funded for a busy pilot.
 */
export const FAUCET_DAILY_BUDGET_UUSDC = 2_400_000_000n;

/**
 * Sub-ceiling for AUTOMATIC faucet grants, on the same daily counter: 1,200
 * USDC (half the daily budget). A grant the app fires automatically (the
 * first-block auto-fund) is charged against this lower ceiling, so the auto
 * path can consume at most half the day's budget no matter how many pages are
 * loaded. The other half is reserved for DELIBERATE taps - a real user who
 * actually wants to fund, and the on-camera demo tap - which are charged
 * against the full FAUCET_DAILY_BUDGET_UUSDC. Because auto contributions can
 * never exceed this, a deliberate tap always has at least
 * (FAUCET_DAILY_BUDGET_UUSDC - FAUCET_AUTO_BUDGET_UUSDC) left to draw on. This
 * is a strictly LOWER ceiling than the daily budget, never a raise. It must
 * stay a whole number of grants and strictly below the daily budget.
 */
export const FAUCET_AUTO_BUDGET_UUSDC = 1_200_000_000n;

/**
 * A wallet is eligible for a faucet grant only while its spendable balance sits
 * below this, in uUSDC: one grant's worth (12 USDC). "Spendable" is the
 * on-chain Arc USDC that pays gas and pool entry fees plus any in-app ledger
 * balance not yet delivered onto Arc; the route reads both. The point is to
 * unblock a wallet that has genuinely run out, not to top up one that is fine:
 * a wallet at or above this does not need more, and re-granting it every tap is
 * how the treasury drains. A user who spends their grant on a pool entry drops
 * back below this and can claim again before the window rolls over - the whole
 * fix. It is deliberately equal to the grant, so the faucet refills you by one
 * grant exactly when you hold less than one grant. Keep it at most one grant, or
 * a single tap could leave a wallet still eligible for the next.
 */
export const FAUCET_REFILL_BALANCE_THRESHOLD_UUSDC = FAUCET_GRANT_UUSDC;

/**
 * Absolute ceiling on what ONE address may be granted inside one window: 120
 * USDC (ten grants). The balance threshold above unblocks the honest ran-out
 * user, but it can be defeated by an attacker who sends the granted USDC to
 * another wallet to drop back under the threshold and re-claim. This cap is the
 * backstop that makes that pointless: no address draws more than this per window
 * no matter how it shuffles funds. It is aligned with WITHDRAW_DAILY_CAP_UUSDC
 * so the grant-then-withdraw loop is bounded consistently on both legs, and it
 * is well above one grant so a pilot player can join and re-join many 10 USDC
 * pools in a day. It must stay a whole number of grants.
 */
export const FAUCET_ADDRESS_DAILY_CAP_UUSDC = 120_000_000n;

/**
 * USDC one address may move out of the treasury onto Arc per window: 120. This
 * is the leg that actually delivers a faucet grant onto the chain where it pays
 * pool entry fees and gas, so it must clear the per-address faucet cap or a
 * granted balance would be stranded in the in-app ledger, unable to reach a 10
 * USDC entry. Testnet practice USDC (no real value), kept aligned with the
 * faucet cap so the grant-then-withdraw loop is bounded the same on both legs.
 */
export const WITHDRAW_DAILY_CAP_UUSDC = 120_000_000n;

/** Length of the withdrawal rate window. */
export const WITHDRAW_WINDOW_MS = DAY_MS;

/**
 * uUSDC the treasury must retain after any money-out action: 5.00 USDC. Below
 * this the routes refuse. The treasury is a shared testnet wallet holding
 * roughly 15 USDC, and a transfer that empties it breaks every other demo
 * flow, so a refusal is strictly better than a successful drain.
 */
export const TREASURY_FLOOR_UUSDC = 5_000_000n;

/** Base Sepolia. The only chain the Blink merchant signer will sign for. */
export const BLINK_ALLOWED_CHAIN_ID = 84532;

/** Hard ceiling on a single signed Blink deposit, in human USD. */
export const BLINK_MAX_DEPOSIT_USD = 25;

// ------------------------------------------------------------- rate windows
//
// Windows are FIXED BUCKETS of floor(now / windowMs), not windows anchored to
// the first spend. That is deliberate: a bucket lives entirely in the key, so
// the backing store only has to do one atomic increment, with no read-then-
// write for a concurrent request to lose. See app/app/api/_money/rate-limit.ts
// for why a read-modify-write counter is not a cap at all.

/** Which fixed window a moment falls in. */
export function windowBucket(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs);
}

/** Seconds until the current window rolls over, at least 1. */
export function windowRetryAfterSeconds(
  nowMs: number,
  windowMs: number,
): number {
  const bucketEndMs = (windowBucket(nowMs, windowMs) + 1) * windowMs;
  return Math.max(1, Math.ceil((bucketEndMs - nowMs) / 1000));
}

export interface SpendVerdict {
  kind: "allow" | "deny";
  /** Cap still available in this window. */
  remainingUusdc: bigint;
}

/**
 * Judge an ALREADY-APPLIED increment: totalAfterUusdc is what the counter read
 * back after adding amountUusdc to it.
 *
 * Taking the post-increment total rather than the pre-increment one is the
 * whole point. It lets the caller do a single atomic add and then ask whether
 * that add was allowed, so exactly one of several concurrent requests can see
 * the total cross the cap. A denied caller hands its increment straight back.
 */
export function spendVerdict(
  totalAfterUusdc: bigint,
  amountUusdc: bigint,
  capUusdc: bigint,
): SpendVerdict {
  if (totalAfterUusdc > capUusdc) {
    const usedBefore = totalAfterUusdc - amountUusdc;
    return {
      kind: "deny",
      remainingUusdc: capUusdc > usedBefore ? capUusdc - usedBefore : 0n,
    };
  }
  return { kind: "allow", remainingUusdc: capUusdc - totalAfterUusdc };
}

/**
 * Ledger idempotency key for a faucet grant, derived server-side from the
 * address, the window, and the per-address grant sequence within that window.
 *
 * The caller-supplied part of the old key was the whole bug: a fresh UUID per
 * request bought a fresh credit and the faucet was a money printer. Nothing
 * here is caller-supplied, so that exploit stays dead. What is different from
 * the first server-derived version is the grantSeqUusdc segment: because the
 * faucet now grants more than once per window (a user who spent their grant is
 * refilled before the window rolls over), a key scoped to the window alone
 * would collapse the second, legitimate grant onto the first and silently
 * credit nothing. The sequence is the running per-address reserved total from
 * the rate limiter's atomic counter, so each distinct reservation gets a
 * distinct ref while a retry of the SAME reserved slot still dedupes to one
 * credit. The per-address daily cap, not this key, is what bounds concurrent
 * distinct reservations; the money printer is dead by cap now, not by collapse.
 *
 * It uses the same bucket function as the rate limiter, so the ledger's
 * idempotency and the faucet's per-address gate can never disagree about which
 * window a request belongs to.
 */
export function faucetClaimRef(
  address: string,
  nowMs: number,
  grantSeqUusdc: bigint,
): string {
  return `faucet:${address.toLowerCase()}:${windowBucket(nowMs, FAUCET_COOLDOWN_MS)}:${grantSeqUusdc.toString()}`;
}

// ------------------------------------------------------------ treasury floor

/**
 * True when the treasury can pay amountUusdc and still hold floorUusdc. Read
 * the treasury balance from chain and check this BEFORE debiting or crediting
 * anything: an honest refusal beats a transfer that reverts halfway.
 */
export function treasuryCanCover(
  treasuryUusdc: bigint,
  amountUusdc: bigint,
  floorUusdc: bigint = TREASURY_FLOOR_UUSDC,
): boolean {
  return treasuryUusdc >= amountUusdc + floorUusdc;
}

// ------------------------------------------------------- blink signer limits

export interface BlinkDepositRequest {
  amount: number;
  chainId: number;
  address: string;
  token: string;
}

export interface BlinkDepositLimits {
  /** The only destination the merchant key will sign a deposit to. */
  merchantAddress: string;
  /** The only token the merchant key will sign a deposit in. */
  tokenAddress: string;
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Reject anything the merchant key must not sign. Returns a reason string, or
 * null when the request is within limits.
 *
 * The signer is unauthenticated by design (the Blink Web SDK cannot hold the
 * merchant key, so it POSTs here on every deposit). Pinning the destination
 * and the token to the configured merchant is what makes that safe: a signed
 * payload can then only ever authorize a deposit INTO our merchant address in
 * our token, which is worthless to an attacker. The amount cap bounds what a
 * single stolen signature could pull from a real user's wallet.
 */
export function checkBlinkDeposit(
  request: BlinkDepositRequest,
  limits: BlinkDepositLimits,
): string | null {
  const { amount, chainId, address, token } = request;

  if (!Number.isFinite(amount) || amount <= 0) {
    return "amount must be a positive number";
  }
  if (amount > BLINK_MAX_DEPOSIT_USD) {
    return `amount must not exceed ${BLINK_MAX_DEPOSIT_USD} USDC per deposit`;
  }
  // Blink takes a human USD number. Anything finer than a cent is either a
  // float artefact or an attempt to smuggle precision past the cap.
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
    return "amount must be a whole number of cents";
  }
  if (chainId !== BLINK_ALLOWED_CHAIN_ID) {
    return `chainId must be ${BLINK_ALLOWED_CHAIN_ID} (Base Sepolia)`;
  }
  if (!sameAddress(address, limits.merchantAddress)) {
    return "address must be the configured Blink merchant address";
  }
  if (!sameAddress(token, limits.tokenAddress)) {
    return "token must be the configured Base Sepolia USDC address";
  }
  return null;
}

// ----------------------------------------------------------- error reporting

export interface ServerFailureOptions {
  /** HTTP status. Defaults to 500. */
  status?: number;
  /**
   * Replacement for the generic sentence. Use it to tell the caller what
   * happened to their money ("nothing moved", "your balance was refunded").
   * It must be written by us, never derived from the error.
   */
  message?: string;
}

/**
 * Log an unexpected failure server-side against a correlation id and answer
 * the caller with a message we wrote, carrying only that id.
 *
 * Money routes touch a treasury key, an RPC, and a ledger. Their exception
 * text names env vars, RPC endpoints, and internal balances, none of which a
 * public caller should ever read back. The correlation id is the whole bridge
 * between a user report and the server log.
 */
export function serverFailure(
  scope: string,
  err: unknown,
  options: ServerFailureOptions = {},
): Response {
  const { status = 500, message } = options;
  const reference = crypto.randomUUID();
  // Passing the error object (not a flattened string) keeps the cause chain
  // and stack intact in the log.
  console.error(`[${scope}] failure reference=${reference}`, err);
  const summary = message ?? "Something went wrong on our side.";
  return Response.json(
    { error: `${summary} Quote reference ${reference} if you report this.`, reference },
    { status },
  );
}
