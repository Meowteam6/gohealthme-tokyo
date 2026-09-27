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

import { evidenceTypeOf, proofPolicyOf } from "@/lib/contract";
import { classifyWearableGoal, type WearableMetric } from "@/lib/wearable-goal";

/**
 * Why a LINKED device cannot be judged yet. Both are holds that clear on their
 * own or with a sync, never a reason to re-pair.
 *
 *   awaiting-sync  nothing has arrived from the device yet, so what it
 *                  measures is not known. A multi-brand provider (Junction)
 *                  lands here right after linking; before this existed its
 *                  declared union was read as the device's capability, and a
 *                  WHOOP strap was offered steps runs it can never win.
 *   unreadable     the provider would not say what the device measures right
 *                  now. The device is fine; the answer is to wait.
 */
export type SensorHold = "awaiting-sync" | "unreadable";

export type JoinBlock =
  /**
   * Nothing in the way. The join may be offered.
   *
   * `proof: "upload"` means the pool also takes an upload (a hybrid
   * wearable-plus-photo pool) and this viewer's wearable is NOT confirmed for
   * it, so the upload is the path they can count on. Surfaces say so next to
   * the join, before the stake.
   */
  | { kind: "ok"; proof?: "upload" }
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
  /**
   * A wallet is connected and we have not established what it can measure.
   * `hold` says why when a device IS linked (see SensorHold); absent, a
   * signature or a first read would answer it.
   *
   * Carried as a detail of "unchecked" rather than a new kind on purpose: a
   * consumer that does not know about holds still locks the run, where a new
   * kind it did not recognise would fall through to "playable".
   */
  | { kind: "unchecked"; hold?: SensorHold }
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
  /**
   * From capabilityHoldOf (lib/wearable-connect.ts): why a linked device has
   * no capability answer yet. Optional so an older caller still locks the run.
   */
  capabilityHold?: SensorHold | null;
  /**
   * True only when the upload path (document or photo) is switched on right
   * now (lib/useProofStatus.ts). A hybrid pool is joinable without a working
   * wearable only then. Absent reads as false, because offering a join whose
   * only workable proof is paused is the trap this module exists to stop.
   */
  uploadAvailable?: boolean;
}

/**
 * The single decision. Order matters and encodes what is most useful to say:
 *
 *  1. Not a wearable goal at all - a document pool needs no device.
 *  2. Already joined - the fee is spent; withholding the join now protects
 *     nothing and would only hide a claim they are entitled to make.
 *  3. Nobody signed in - browsing is not staking, and hiding the board from a
 *     visitor is its own dead end.
 *  4. The wearable decision below. Then, on a hybrid pool whose upload path
 *     is on, any wearable refusal becomes "ok, prove it with the upload":
 *     the pool takes a photo, so a missing or unfit sensor is not a reason to
 *     keep the person out.
 */
export function wearableJoinBlock(input: JoinGateInput): JoinBlock {
  if (evidenceTypeOf(input.goalSpec) !== "wearable") return { kind: "ok" };
  if (input.joined) return { kind: "ok" };
  if (input.address === null) return { kind: "ok" };

  const block = wearableOnlyBlock(input);
  if (block.kind === "ok") return block;

  if (input.uploadAvailable === true && acceptsUpload(input.goalSpec)) {
    return { kind: "ok", proof: "upload" };
  }
  return block;
}

/**
 * The wearable decision alone:
 *
 *  1. Outage first, because during one NOTHING wearable can be verified
 *     regardless of hardware, and "come back shortly" beats "your device
 *     cannot do this" when the device is fine.
 *  2. A metric this device will never produce.
 *  3. Nothing linked; then linked-but-held (not synced, or unreadable); then
 *     not-yet-checked. All mean "we cannot say", and they differ only in what
 *     the person should do next.
 */
function wearableOnlyBlock(input: JoinGateInput): JoinBlock {
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
  const hold = input.capabilityHold ?? null;
  if (hold !== null) return { kind: "unchecked", hold };
  if (input.capabilityPending) return { kind: "unchecked" };

  // Capability unknown for a reason none of the above covers. Withhold rather
  // than guess: this is the branch that used to read "unknown" as "fine".
  return { kind: "unchecked" };
}

/** True when the pool accepts some proof other than the wearable. */
function acceptsUpload(goalSpec: string): boolean {
  return proofPolicyOf(goalSpec).accepted.some((m) => m !== "wearable");
}

/** True when the join action must not be offered. */
export function joinIsBlocked(block: JoinBlock): boolean {
  return block.kind !== "ok";
}

// ------------------------------------------------------------------ copy

/**
 * What a held run says. Shaped like LockCopy in lib/game/lobby.ts so the lobby
 * can return it directly; kept here so the wording of a wearable limit lives
 * beside the decision that produces it.
 */
export interface SensorHoldCopy {
  title: string;
  detail: string;
  /** Re-reads the sensor. The same one-tap check the lobby already offers. */
  fix: { kind: "check-sensor"; label: string };
  tone: "wait";
}

/**
 * Plain-English lock copy for a hold, in SPOTTER's voice. No provider
 * internals, no env names; what it means for the player and what to do.
 */
export function sensorHoldCopy(
  hold: SensorHold,
  deviceLabel: string | null,
): SensorHoldCopy {
  const device = deviceLabel ?? "your wearable";
  switch (hold) {
    case "awaiting-sync":
      return {
        title: "Your wearable has not synced yet",
        detail:
          (deviceLabel === null
            ? "Open your wearable's app so it syncs, then come back. "
            : `Open the ${deviceLabel} app so it syncs, then come back. `) +
          // "may": a Dynamic session token checks with no prompt; only the
          // signature fallback asks the wallet (lib/client-auth.ts).
          "Checking may ask your wallet to sign; it never sends a payment.",
        fix: { kind: "check-sensor", label: "Check my wearable" },
        tone: "wait",
      };
    case "unreadable":
      return {
        title: "I cannot read your wearable right now",
        detail:
          `${capitalise(device)} is linked and nothing is wrong on your side. ` +
          "It is not telling me what it measures this minute, so wearable challenges " +
          "stay locked until it answers. Check again shortly.",
        fix: { kind: "check-sensor", label: "Check my wearable" },
        tone: "wait",
      };
  }
}

/**
 * The line a hybrid run shows beside its join when `proof` is "upload": the
 * wearable will not carry this one for this player, the upload will. Worded
 * for the modality the pool actually takes.
 */
export function uploadFallbackNote(goalSpec: string): string {
  const accepted = proofPolicyOf(goalSpec).accepted;
  return accepted.includes("self-reported")
    ? "Your wearable cannot prove this one for you right now, so you would " +
        "prove it with a photo. Photo proof is self-reported and counts as low trust."
    : "Your wearable cannot prove this one for you right now, so you would " +
        "prove it by uploading a document instead.";
}

function capitalise(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}
