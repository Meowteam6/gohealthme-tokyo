// The lobby's one decision per run: can this player enter it, and if not, why
// and what fixes it. Pure and node-tested.
//
// It composes decisions that already exist rather than re-deriving them: the
// pool lifecycle (lib/pool-lifecycle.ts), payability, and the wearable join
// gate (lib/wearable-join-gate.ts), which both staking surfaces must keep
// using. What is new is where the answer shows up: as a lock on the lobby row
// and on the run page, with its fix, before any stake - instead of five
// separate refusal screens at the join.

import type { JoinBlock } from "@/lib/wearable-join-gate";
import type { PoolPhase } from "@/lib/pool-lifecycle";
import { metricLabel, type WearableMetric } from "@/lib/wearable-goal";

export type RunLock =
  | { kind: "sign-in" }
  /** World is on for this build and this player has not proven they are one
   *  human. One human, one entry is checked at the join, so it is shown here. */
  | { kind: "not-human" }
  | { kind: "no-sensor" }
  /** A wallet is connected and SPOTTER has not looked at the sensor this
   *  visit. One signature, free, answers it for every run at once. */
  | { kind: "sensor-unchecked" }
  | { kind: "cannot-measure"; metric: WearableMetric; deviceLabel: string | null }
  /** The wearable provider is refusing SPOTTER right now. Not the player's
   *  hardware, and it clears on its own. */
  | { kind: "outage" };

export type RunSlot =
  | { kind: "playable" }
  | { kind: "in-run" }
  | { kind: "locked"; lock: RunLock }
  | { kind: "closed"; joined: boolean }
  | { kind: "cannot-pay" };

export interface RunSlotInput {
  phase: PoolPhase;
  canPay: boolean;
  joined: boolean;
  address: string | null;
  /** From wearableJoinBlock, unchanged. */
  joinBlock: JoinBlock;
  /** True when World is on for this build. */
  humanRequired: boolean;
  humanVerified: boolean;
  /** Label of the player's paired device, for the cannot-measure copy. */
  deviceLabel: string | null;
}

/**
 * Order encodes what is most useful to say:
 *  1. A closed run is closed; a run that cannot pay is never offered.
 *  2. Already in: the stake is spent and nothing should stand in front of it.
 *  3. Nobody signed in.
 *  4. The device can never measure this goal (a hardware fact, not a delay).
 *  5. The provider is down (clears on its own).
 *  6. Not proven human (World on).
 *  7. No sensor, then sensor not checked this visit.
 */
export function runSlotOf(input: RunSlotInput): RunSlot {
  if (input.phase !== "live") return { kind: "closed", joined: input.joined };
  if (!input.canPay) return { kind: "cannot-pay" };
  if (input.joined) return { kind: "in-run" };
  if (input.address === null) return { kind: "locked", lock: { kind: "sign-in" } };
  const block = input.joinBlock;
  if (block.kind === "unsupported") {
    return {
      kind: "locked",
      lock: {
        kind: "cannot-measure",
        metric: block.metric,
        deviceLabel: input.deviceLabel,
      },
    };
  }
  if (block.kind === "outage") return { kind: "locked", lock: { kind: "outage" } };
  if (input.humanRequired && !input.humanVerified) {
    return { kind: "locked", lock: { kind: "not-human" } };
  }
  if (block.kind === "no-device") return { kind: "locked", lock: { kind: "no-sensor" } };
  if (block.kind === "unchecked") {
    return { kind: "locked", lock: { kind: "sensor-unchecked" } };
  }
  return { kind: "playable" };
}

export type LockFix =
  | { kind: "link"; label: string; href: string }
  /** Sign once so SPOTTER can read the sensor. No transaction, no charge. */
  | { kind: "check-sensor"; label: string }
  | { kind: "none" };

export interface LockCopy {
  title: string;
  detail: string;
  fix: LockFix;
  /** Permanent for this device (cannot-measure) versus fixable now. */
  tone: "fixable" | "hardware" | "wait";
}

/**
 * What a locked row says. SPOTTER's voice, no plumbing: the provider's raw
 * outage text never reaches the player, only what it means for them.
 */
export function lockCopy(lock: RunLock, returnTo: string): LockCopy {
  const next = encodeURIComponent(returnTo);
  switch (lock.kind) {
    case "sign-in":
      return {
        title: "Sign in to enter",
        detail: "One email, and a wallet is made for you. No seed phrase.",
        fix: { kind: "link", label: "Sign in", href: `/character?next=${next}` },
        tone: "fixable",
      };
    case "not-human":
      return {
        title: "Prove you are one human first",
        detail:
          "One human, one entry. It takes one scan with World ID and it covers every run.",
        fix: {
          kind: "link",
          label: "Prove I am human",
          href: `/character?step=human&next=${next}`,
        },
        tone: "fixable",
      };
    case "no-sensor":
      return {
        title: "Pair a sensor to enter",
        detail:
          "I pay on what your wearable reports, so no sensor means nothing for me to check.",
        fix: {
          kind: "link",
          label: "Pair my sensor",
          href: `/character?step=sensor&next=${next}`,
        },
        tone: "fixable",
      };
    case "sensor-unchecked":
      return {
        title: "I have not looked at your sensor this visit",
        detail:
          "Sign once so I can read what it measures. Free, no transaction, and it unlocks every run at once.",
        fix: { kind: "check-sensor", label: "Check my sensor" },
        tone: "fixable",
      };
    case "cannot-measure": {
      const metric = metricLabel(lock.metric);
      const device = lock.deviceLabel ?? "Your sensor";
      return {
        title: `${device} cannot measure this one`,
        detail: `This run is scored on ${metric}, and ${device} does not report it. That is the hardware, so waiting will not change it. Pair a sensor that tracks ${metric} to play it.`,
        fix: {
          kind: "link",
          label: "Change my sensor",
          href: `/character?step=sensor&next=${next}`,
        },
        tone: "hardware",
      };
    }
    case "outage":
      return {
        title: "Wearable checks are down for a bit",
        detail:
          "The wearable service is not answering me right now. Nothing is wrong with your sensor. This run opens again when it is back.",
        fix: { kind: "none" },
        tone: "wait",
      };
  }
}

/** Lobby order: what you can act on first. */
export function slotRank(slot: RunSlot): number {
  switch (slot.kind) {
    case "in-run":
      return 0;
    case "playable":
      return 1;
    case "locked":
      return 2;
    case "closed":
      return slot.joined ? 3 : 4;
    case "cannot-pay":
      return 5;
  }
}
