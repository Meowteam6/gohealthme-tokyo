// The dare money path, as a pure orchestrator with injected steps so every
// branch is unit-testable without a wallet or a browser.
//
// A dare is two writes in a fixed order: the reward moves on chain (createPool
// with initialFunding), then the off-chain row that makes the /c/<token> link
// is minted. The second can fail after the first has landed, so this module
// holds three rules the form used to get wrong:
//
//   1. PREFLIGHT BEFORE MONEY. /api/challenges/health must say the store can
//      take the row before the deposit is even offered. An unready build
//      refuses with nothing charged.
//   2. ONLY A LANDED DEPOSIT SAYS "THE REWARD IS UP". A deposit that throws
//      (rejected, short on funds, reverted) is "depositFailed", never a link
//      failure, so the UI cannot claim money moved when it did not.
//   3. A RETRY AFTER A LANDED DEPOSIT IS LINK-ONLY. Once funded, the caller
//      passes the FundedDare back in and the deposit step is skipped entirely,
//      so a retry can never create and fund a second pool.

import type { Hex } from "viem";

/** A dare whose reward has landed on chain. poolId is null when the deposit
 *  landed but the new pool id has not been resolved from its receipt yet. */
export interface FundedDare {
  depositHash: Hex;
  poolId: bigint | null;
}

export type HealthCheck = { ok: true } | { ok: false; message: string };

export type MintResult =
  | { ok: true; token: string }
  | { ok: false; message: string };

export interface DareFlowSteps {
  checkHealth(): Promise<HealthCheck>;
  /** Approve + createPool with the reward. Resolves to the tx hash once the
   *  pool is funded; throws when nothing moved. */
  deposit(): Promise<Hex>;
  resolvePoolId(depositHash: Hex): Promise<bigint>;
  mintLink(poolId: bigint): Promise<MintResult>;
  /** Called the instant money has moved and again once the pool id is known,
   *  so the caller can persist it before anything else can fail. */
  onFunded?(funded: FundedDare): void;
  /** Called when the link step starts. */
  onLinking?(): void;
}

export type DareFlowResult =
  | { kind: "unavailable"; message: string }
  | { kind: "depositFailed" }
  | { kind: "linkFailed"; funded: FundedDare; message: string }
  | { kind: "done"; poolId: bigint; token: string };

export const HEALTH_UNREACHABLE_MESSAGE =
  "Could not confirm challenges are live right now. Nothing was charged. Try again in a moment.";

const POOL_NOT_FOUND_MESSAGE =
  "Your reward is in, but we could not find the new pool yet. Retry the link in a moment.";

const LINK_FAILED_MESSAGE = "Could not mint the challenge link.";

/**
 * Run a dare from wherever it stands. Pass `funded = null` for a fresh dare
 * (preflight, deposit, link); pass the FundedDare from a previous run to retry
 * the link only. The deposit step is unreachable on a retry.
 */
export async function runDareFlow(
  steps: DareFlowSteps,
  funded: FundedDare | null,
): Promise<DareFlowResult> {
  let current: FundedDare;

  if (funded === null) {
    let health: HealthCheck;
    try {
      health = await steps.checkHealth();
    } catch {
      return { kind: "unavailable", message: HEALTH_UNREACHABLE_MESSAGE };
    }
    if (!health.ok) return { kind: "unavailable", message: health.message };

    let depositHash: Hex;
    try {
      depositHash = await steps.deposit();
    } catch {
      return { kind: "depositFailed" };
    }
    current = { depositHash, poolId: null };
    steps.onFunded?.(current);
  } else {
    current = funded;
  }

  steps.onLinking?.();

  if (current.poolId === null) {
    try {
      const poolId = await steps.resolvePoolId(current.depositHash);
      current = { ...current, poolId };
      steps.onFunded?.(current);
    } catch {
      return { kind: "linkFailed", funded: current, message: POOL_NOT_FOUND_MESSAGE };
    }
  }
  const poolId = current.poolId as bigint;

  let minted: MintResult;
  try {
    minted = await steps.mintLink(poolId);
  } catch {
    return { kind: "linkFailed", funded: current, message: LINK_FAILED_MESSAGE };
  }
  if (!minted.ok) {
    return { kind: "linkFailed", funded: current, message: minted.message };
  }
  if (minted.token === "") {
    return { kind: "linkFailed", funded: current, message: LINK_FAILED_MESSAGE };
  }
  return { kind: "done", poolId, token: minted.token };
}

/**
 * Read /api/challenges/health. Any non-ok answer carries the server's player
 * copy; a network failure throws so runDareFlow reports it as unreachable.
 */
export async function fetchChallengesHealth(
  fetchImpl: typeof fetch = fetch,
): Promise<HealthCheck> {
  const response = await fetchImpl("/api/challenges/health", {
    cache: "no-store",
  });
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => ({}))) as { error?: unknown };
  return {
    ok: false,
    message:
      typeof body.error === "string" && body.error !== ""
        ? body.error
        : HEALTH_UNREACHABLE_MESSAGE,
  };
}
