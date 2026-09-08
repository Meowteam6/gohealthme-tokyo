// Whether a person may be offered a join on a wearable pool, decided once.
//
// WHY THIS IS A MODULE AND NOT A BRANCH IN A COMPONENT
//
// The pool page grew a careful chain of these checks - outage, device cannot
// measure this, capability not read yet, no device linked - and it was the ONLY
// place in the product that had them. A challenge link goes straight to
// components/ChallengeAccept.tsx, which mounts the same JoinPool primitive with
// no device check of any kind. So every limit the pool page surfaces before the
// stake was bypassed entirely by the share link, which for this product is
// probably the commonest way anyone arrives at a pool at all.
//
// Two surfaces that decide the same thing differently is how the first version
// of this gate ended up inert on cold loads, and how capabilityUnknown and
// viewerMetricsOf drifted into disagreeing. The decision lives here; the two
// surfaces differ only in how they render it.

import { evidenceTypeOf } from "@/lib/contract";
import { classifyWearableGoal, type WearableMetric } from "@/lib/wearable-goal";

export type JoinBlock =
  /** Nothing in the way. The join may be offered. */
  | { kind: "ok" }
  /**
   * The provider is refusing us right now. Temporary; the answer is to wait,
   * and it is NOT about this person's hardware.
   */
  | { kind: "outage"; reason: string }
  /**
   * This wallet's device cannot measure what the goal is scored on, and never
   * will while they stay on that provider.
   */
  | { kind: "unsupported"; metric: WearableMetric }
  /** A wallet is connected and we have not established what it can measure. */
  | { kind: "unchecked" }
  /** Nothing is linked at all. Signing cannot answer this; connecting can. */
  | { kind: "no-device" };

export interface JoinGateInput {
  goalSpec: string;
  /** Null when nobody is signed in. A visitor browsing is not about to stake. */
  address: string | null;
  /** Already in the pool: the fee is spent and the gate has nothing to protect. */
  joined: boolean;
  /** Why the provider is unreachable, or null when it is fine or unknown. */
  providerDown: string | null;
  /** What this wallet's device measures, or null when that is not known. */
  viewerMetrics: readonly WearableMetric[] | null;
  /** True when a wallet is connected and the capability read has not landed. */
  capabilityPending: boolean;
  /** True when the capability is known to be nothing, because nothing is linked. */
  needsDevice: boolean;
}

/**
 * The single decision. Order matters and encodes what is most useful to say:
 *
 *  1. Not a wearable goal at all - a document pool needs no device.
 *  2. Already joined - the fee is spent; withholding the join now protects
 *     nothing and would only hide a claim they are entitled to make.
 *  3. Nobody signed in - browsing is not staking, and hiding the board from a
 *     visitor is its own dead end.
 *  4. Outage first, because during one NOTHING wearable can be verified
 *     regardless of hardware, and "come back shortly" beats "your device
 *     cannot do this" when the device is fine.
 *  5. A metric this device will never produce.
 *  6. Nothing linked, then not-yet-checked. Both mean "we cannot say", and
 *     they differ only in what the person should do next.
 */
export function wearableJoinBlock(input: JoinGateInput): JoinBlock {
  if (evidenceTypeOf(input.goalSpec) !== "wearable") return { kind: "ok" };
  if (input.joined) return { kind: "ok" };
  if (input.address === null) return { kind: "ok" };

  if (input.providerDown !== null) {
    return { kind: "outage", reason: input.providerDown };
  }

  if (input.viewerMetrics !== null) {
    const metric = classifyWearableGoal(input.goalSpec).metric;
    // A goal that maps to no metric is left alone: it fails closed later, at
    // the claim, where the verdict can say precisely why. Blocking it here
    // would hide a pool for a reason we cannot state.
    if (metric !== null && !input.viewerMetrics.includes(metric)) {
      return { kind: "unsupported", metric };
    }
    return { kind: "ok" };
  }

  if (input.needsDevice) return { kind: "no-device" };
  if (input.capabilityPending) return { kind: "unchecked" };

  // Capability unknown for a reason none of the above covers. Withhold rather
  // than guess: this is the branch that used to read "unknown" as "fine".
  return { kind: "unchecked" };
}

/** True when the join action must not be offered. */
export function joinIsBlocked(block: JoinBlock): boolean {
  return block.kind !== "ok";
}
