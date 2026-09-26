// Gas drip: a small Base Sepolia ETH top-up from the treasury for a wallet
// that cannot pay its own gas (server only).
//
// WHY THIS EXISTS
// Signing in with email gives a player a Dynamic embedded wallet that is a
// plain EOA holding 0 ETH. The CDP paymaster only sponsors smart accounts
// (lib/useGasSponsorship.ts), and turning the email wallet into one would
// change every player's address, so it stays off. Without this drip the EOA's
// first approve fails with "gas required exceeds allowance (0)" and no retry
// can ever succeed. The treasury already holds Base Sepolia ETH (the
// treasury-topup cron refills it from the CDP faucet), so it hands the wallet
// just enough to pay for a few transactions.
//
// THE RULES (all enforced here, all unit-tested in gas-drip.test.ts)
//   - only a wallet below minWei gets anything, and the balance is re-read
//     under the send lock so a double tap drips once
//   - one address gets at most maxPerAddress drips per day, reserved
//     atomically through the same spend windows the faucet uses
//   - every address together gets at most dailyBudgetWei per day, because
//     fresh addresses are free and a per-address cap alone bounds nothing
//   - the treasury never goes below treasuryFloorWei, because its ETH also
//     pays for the USDC deliveries every other money route makes
//   - sends from the treasury key are serialised by one lock (nonce safety)
//   - success is the recipient's balance going up by the drip, read back
//     from chain, never the bare receipt
//
// The windows are fixed daily buckets (the same shape as the faucet), not a
// rolling 24 hours: an address that drips just before midnight UTC can drip
// again just after. The global budget still bounds the day.

import type { Address, Hex } from "viem";
import {
  releaseFromWindow,
  spendFromWindow,
} from "@/app/api/_money/rate-limit";
import { treasuryEthBalanceWei } from "@/app/api/_money/treasury-balance";
import { arcPublicClient } from "@/lib/server/arc-client";
import { LockUnavailableError } from "@/lib/server/store";
import {
  TREASURY_SEND_LOCK,
  sendTreasuryEth,
  withTreasurySendLock,
} from "@/lib/server/treasury";
import { treasuryCanCover } from "@/lib/money-guards";
import { ETH_FAUCET_URL } from "@/lib/tx-errors";

const DAY_MS = 24 * 60 * 60 * 1000;
const GWEI = 1_000_000_000n;

export const GAS_DRIP_WINDOW_MS = DAY_MS;

export interface GasDripConfig {
  /** Sent per drip. */
  dripWei: bigint;
  /** A wallet at or above this is funded and gets nothing. */
  minWei: bigint;
  /** All drips together per day. */
  dailyBudgetWei: bigint;
  /** The treasury must keep at least this after a drip. */
  treasuryFloorWei: bigint;
  /** Drips per address per day. */
  maxPerAddress: number;
}

export const DEFAULT_GAS_DRIP_CONFIG: GasDripConfig = {
  dripWei: 500_000_000_000_000n, // 0.0005 ETH
  minWei: 200_000_000_000_000n, // 0.0002 ETH
  dailyBudgetWei: 30_000_000_000_000_000n, // 0.03 ETH
  treasuryFloorWei: 10_000_000_000_000_000n, // 0.01 ETH
  maxPerAddress: 3,
};

function positiveWei(raw: string | undefined, fallback: bigint): bigint {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
  const value = BigInt(raw.trim());
  return value > 0n ? value : fallback;
}

/** Read the drip limits from env (wei strings), falling back per field. */
export function gasDripConfig(
  env: Record<string, string | undefined> = process.env,
): GasDripConfig {
  return {
    dripWei: positiveWei(env.GAS_DRIP_WEI, DEFAULT_GAS_DRIP_CONFIG.dripWei),
    minWei: positiveWei(env.GAS_DRIP_MIN_WEI, DEFAULT_GAS_DRIP_CONFIG.minWei),
    dailyBudgetWei: positiveWei(
      env.GAS_DRIP_DAILY_BUDGET_WEI,
      DEFAULT_GAS_DRIP_CONFIG.dailyBudgetWei,
    ),
    treasuryFloorWei: positiveWei(
      env.GAS_DRIP_TREASURY_FLOOR_WEI,
      DEFAULT_GAS_DRIP_CONFIG.treasuryFloorWei,
    ),
    maxPerAddress: DEFAULT_GAS_DRIP_CONFIG.maxPerAddress,
  };
}

export type GasDripOutcome =
  | { kind: "dripped"; tx: Hex; balanceWei: bigint; minWei: bigint }
  | { kind: "funded"; balanceWei: bigint; minWei: bigint }
  | { kind: "address-cap"; retryAfterSeconds: number; message: string }
  | { kind: "budget"; retryAfterSeconds: number; message: string }
  | { kind: "treasury-low"; message: string }
  | { kind: "busy"; message: string }
  | { kind: "failed"; message: string; error?: unknown };

export interface GasDripDeps {
  getBalance: (address: Address) => Promise<bigint>;
  treasuryBalance: () => Promise<bigint>;
  send: (to: Address, valueWei: bigint) => Promise<Hex>;
  waitForReceipt: (hash: Hex) => Promise<{ status: "success" | "reverted" }>;
  spend: typeof spendFromWindow;
  release: typeof releaseFromWindow;
  /** Serialise treasury sends. Throws LockUnavailableError when busy. */
  lock: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export function liveGasDripDeps(): GasDripDeps {
  return {
    getBalance: (address) => arcPublicClient().getBalance({ address }),
    treasuryBalance: treasuryEthBalanceWei,
    send: sendTreasuryEth,
    waitForReceipt: async (hash) => {
      const receipt = await arcPublicClient().waitForTransactionReceipt({
        hash,
        timeout: 45_000,
      });
      return { status: receipt.status };
    },
    spend: spendFromWindow,
    release: releaseFromWindow,
    lock: (_name, fn) => withTreasurySendLock(fn),
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

const FAUCET_LINE = `or get Base Sepolia ETH from the faucet at ${ETH_FAUCET_URL}.`;

function hoursFrom(seconds: number): string {
  const hours = Math.max(1, Math.ceil(seconds / 3600));
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** Budget counters run in gwei so the Redis INCRBY stays an exact integer. */
function toGweiCeil(wei: bigint): bigint {
  return (wei + GWEI - 1n) / GWEI;
}

/** How many times the post-send balance is re-read before giving up. */
const DELTA_READS = 6;
const DELTA_READ_GAP_MS = 1_000;

/**
 * Drip gas to `address` if it needs it and every limit allows it. Never
 * throws for an expected refusal: each one comes back as an outcome with a
 * plain sentence the route can hand to the player.
 */
export async function runGasDrip(
  address: Address,
  config: GasDripConfig,
  deps: GasDripDeps,
): Promise<GasDripOutcome> {
  const now = deps.now();

  // 1. Already funded: nothing to do, nothing reserved.
  const startBalance = await deps.getBalance(address);
  if (startBalance >= config.minWei) {
    return { kind: "funded", balanceWei: startBalance, minWei: config.minWei };
  }

  // 2. Treasury floor, a pure read, before anything is reserved.
  const treasuryWei = await deps.treasuryBalance();
  if (!treasuryCanCover(treasuryWei, config.dripWei, config.treasuryFloorWei)) {
    return {
      kind: "treasury-low",
      message:
        "Our test ETH supply is low right now, so we could not send gas. " +
        `It refills on its own; try again in an hour, ${FAUCET_LINE}`,
    };
  }

  // 3. Per-address cap, atomic.
  const addressKey = `gasdrip:address:${address.toLowerCase()}`;
  const perAddress = await deps.spend(
    addressKey,
    1n,
    BigInt(config.maxPerAddress),
    GAS_DRIP_WINDOW_MS,
    now,
  );
  if (perAddress.kind === "deny") {
    return {
      kind: "address-cap",
      retryAfterSeconds: perAddress.retryAfterSeconds,
      message:
        `This wallet has had ${config.maxPerAddress} gas top-ups today, the most one wallet gets. ` +
        `Try again in about ${hoursFrom(perAddress.retryAfterSeconds)}, ${FAUCET_LINE}`,
    };
  }

  // 4. Global budget, atomic.
  const dripGwei = toGweiCeil(config.dripWei);
  const budgetGwei = config.dailyBudgetWei / GWEI;
  const budget = await deps.spend(
    "gasdrip:global",
    dripGwei,
    budgetGwei,
    GAS_DRIP_WINDOW_MS,
    now,
  );
  if (budget.kind === "deny") {
    await deps.release(addressKey, 1n, GAS_DRIP_WINDOW_MS, now);
    return {
      kind: "budget",
      retryAfterSeconds: budget.retryAfterSeconds,
      message:
        "We have handed out all of today's test ETH for gas. Try again tomorrow, " +
        FAUCET_LINE,
    };
  }

  const releaseBoth = async () => {
    await deps.release(addressKey, 1n, GAS_DRIP_WINDOW_MS, now);
    await deps.release("gasdrip:global", dripGwei, GAS_DRIP_WINDOW_MS, now);
  };

  // 5. Send under the treasury lock, re-checking the balance first so two
  //    taps from one player cannot both drip.
  type Sent =
    | { kind: "sent"; tx: Hex; before: bigint }
    | { kind: "funded"; balance: bigint }
    | { kind: "reverted"; tx: Hex }
    | { kind: "unconfirmed"; tx: Hex; error: unknown };
  let sent: Sent;
  try {
    sent = await deps.lock(TREASURY_SEND_LOCK, async (): Promise<Sent> => {
      const before = await deps.getBalance(address);
      if (before >= config.minWei) return { kind: "funded", balance: before };
      const tx = await deps.send(address, config.dripWei);
      try {
        const receipt = await deps.waitForReceipt(tx);
        if (receipt.status !== "success") return { kind: "reverted", tx };
      } catch (error) {
        return { kind: "unconfirmed", tx, error };
      }
      return { kind: "sent", tx, before };
    });
  } catch (err) {
    await releaseBoth();
    if (err instanceof LockUnavailableError) {
      return {
        kind: "busy",
        message:
          "We are sending gas to someone else right now. Nothing was sent; try again in a few seconds.",
      };
    }
    return {
      kind: "failed",
      message: "We could not send test ETH for gas. Nothing was sent; try again in a moment.",
      error: err,
    };
  }

  if (sent.kind === "funded") {
    await releaseBoth();
    return { kind: "funded", balanceWei: sent.balance, minWei: config.minWei };
  }
  if (sent.kind === "reverted") {
    await releaseBoth();
    return {
      kind: "failed",
      message: `The gas top-up ${sent.tx} reverted, so nothing was sent. Try again in a moment.`,
    };
  }
  if (sent.kind === "unconfirmed") {
    // It may still land, so the reservations stay: the safe direction.
    return {
      kind: "failed",
      message:
        "We sent test ETH for gas but the network has not confirmed it yet. Give it a minute, then try again.",
      error: sent.error,
    };
  }

  // 6. Assert the delta. A lagging RPC node can serve the old balance for a
  //    moment, so re-read briefly before calling it a failure.
  const target = sent.before + config.dripWei;
  for (let read = 0; read < DELTA_READS; read += 1) {
    const after = await deps.getBalance(address);
    if (after >= target) {
      return { kind: "dripped", tx: sent.tx, balanceWei: after, minWei: config.minWei };
    }
    if (read < DELTA_READS - 1) await deps.sleep(DELTA_READ_GAP_MS);
  }
  return {
    kind: "failed",
    message:
      "We sent test ETH for gas but your wallet balance has not shown it yet. Give it a minute, then try again.",
  };
}
