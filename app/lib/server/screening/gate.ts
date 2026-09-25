// The payout screening gate SPOTTER runs before it signs.
//
// HealthPoolsV3.settle() credits EVERY recorded achiever in one transaction,
// so a single payee cannot be left out at settle time. Exclusion therefore
// happens one step earlier: recordResult(verdict=true) is what makes a wallet
// an achiever, and a wallet never recorded is refunded its own stake by
// settle() (contract B-2) and paid no reward. The gate runs at both
// signatures (spotter.ts):
//   - "record": the exclusion point. blocked -> no record, the wallet is
//     never an achiever, everyone else in the pool is unaffected.
//   - "settle": the literal before-it-is-signed line, and the only gate the
//     legacy oracle path and the cron sweep pass through. blocked here means
//     the achiever was recorded before screening existed (or by the legacy
//     signer); the honest answer is to hold the pool's settle and say so.
//
// Every non-clear outcome is a thrown PayoutScreeningHold. run.ts already
// turns a throw at either stage into a visible error row and a retry (the
// browser poll for record, the sweep for settle), which is exactly the
// fail-closed behaviour wanted: nothing is signed, nothing is silent, and
// the claim is picked up again once screening answers or the cache expires.
//
// "unconfigured" (no INTERCEPTA_API_KEY) is a no-op by design so the other
// lanes can demo before the key lands; the status endpoint reports it and
// the UI says screening is not enabled on this deployment.

import {
  encodeAbiParameters,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { appendLedger, readLedger } from "@/lib/server/agent/ledger";
import { screenAddress, type ScreeningResult } from "@/lib/server/screening/intercepta";

/** Stable prefix on every hold message, so the receipt can recognise a
 *  screening hold without parsing the rest. */
export const SCREEN_HELD_PREFIX = "payout held by screening:";

/** record and settle are the payout signatures in spotter.ts; x402 is the
 *  agent-to-agent buy side in x402.ts (the seller's payTo is the payee). */
export type ScreenPurpose = "record" | "settle" | "x402";

export class PayoutScreeningHold extends Error {
  constructor(
    readonly purpose: ScreenPurpose,
    readonly result: ScreeningResult,
  ) {
    super(
      `${SCREEN_HELD_PREFIX} Intercepta ${result.status} for ${result.address} at ${purpose}. ${result.reason}`,
    );
    this.name = "PayoutScreeningHold";
  }
}

/** Injectable so spotter tests never reach the network. The live one is the
 *  Intercepta client; there is no other implementation outside tests. */
export interface PayeeScreener {
  screen(address: Address): Promise<ScreeningResult>;
}

export function liveScreener(): PayeeScreener {
  return { screen: (address) => screenAddress(address) };
}

/**
 * Mirror of HealthPoolsV3.computeGoalId, so the record-time gate can key its
 * ledger row without a second contract read: keccak256(abi.encode(pools,
 * poolId, participant, periodStart)). The run loop derives the same id from
 * the chain; this must agree with it or the row lands on the wrong claim.
 */
export function goalIdFor(
  pools: Address,
  poolId: bigint,
  participant: Address,
  periodStart: bigint,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint64" },
      ],
      [pools, poolId, participant, periodStart],
    ),
  );
}

export interface GateInput {
  screener?: PayeeScreener;
  address: Address;
  purpose: ScreenPurpose;
  /** Resolved lazily and only when a row must be written, so the
   *  unconfigured path costs no reads. undefined means "no ledger row". */
  goalId?: Hex | (() => Promise<Hex | undefined>);
}

/**
 * Screen a payee and record the outcome on the claim's ledger. Returns on
 * clear and unconfigured; throws PayoutScreeningHold on blocked and
 * unavailable. A repeat of the last row (same purpose, address, status) is
 * not re-appended, so a 1s poll or a 2-minute sweep cannot flood the
 * receipt while a hold stands.
 */
export async function screenPayeeBeforeSigning(
  input: GateInput,
): Promise<ScreeningResult> {
  const screener = input.screener ?? liveScreener();
  const result = await screener.screen(input.address);
  if (result.status === "unconfigured") return result;

  const goalId =
    typeof input.goalId === "function" ? await input.goalId() : input.goalId;
  if (goalId !== undefined) {
    const ledger = await readLedger(goalId);
    const last = [...ledger]
      .reverse()
      .find(
        (e) =>
          e.kind === "screen" &&
          e.purpose === input.purpose &&
          e.address.toLowerCase() === result.address.toLowerCase(),
      );
    const repeat =
      last !== undefined && last.kind === "screen" && last.status === result.status;
    if (!repeat) {
      await appendLedger(goalId, {
        kind: "screen",
        provider: "intercepta",
        purpose: input.purpose,
        address: result.address,
        status: result.status,
        toxicScore: result.toxicScore ?? undefined,
        traits: result.traits.map((t) => t.name),
        rule: result.rule,
        reason: result.reason,
        cached: result.cached,
      });
    }
  }

  if (result.status === "blocked" || result.status === "unavailable") {
    throw new PayoutScreeningHold(input.purpose, result);
  }
  return result;
}
