// The lobby's one decision per run: can this player enter it, and if not, why
// and what fixes it. Pure and node-tested.
//
// It composes decisions that already exist rather than re-deriving them: the
// pool lifecycle (lib/pool-lifecycle.ts), payability, and the wearable join
// gate (lib/wearable-join-gate.ts), which both staking surfaces must keep
// using. What is new is where the answer shows up: as a lock on the lobby row
// and on the run page, with its fix, before any stake - instead of five
// separate refusal screens at the join.

import { proofPolicyOf, type PoolInfo } from "@/lib/contract";
import { poolCanPay, poolPhase, type PoolPhase } from "@/lib/pool-lifecycle";
import { hideDocumentPools, hideEmptyCancelledPools } from "@/lib/pool-visibility";
import { wearableJoinBlock, type JoinBlock } from "@/lib/wearable-join-gate";
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
  | { kind: "outage" }
  /** Signed in, World is not how this player got in, and the closed-beta list
   *  has not approved them. Ordered after not-human. */
  | { kind: "not-approved"; pending: boolean }
  /** An upload-proof run while SPOTTER's document checker is off for this
   *  build. The run stays visible (a dare link must never just vanish); the
   *  stake does not. */
  | { kind: "verifier-off" }
  /** The World ID payout confirmation is switched on and cannot run on this
   *  build, so no win could pay. Nobody stakes into that. */
  | { kind: "payouts-paused" }
  /** A read the join depends on keeps failing. The stake is held, never
   *  offered on a guess, and the fix is a retry. */
  | { kind: "check-failed"; check: JoinCheck };

/** The reads a join depends on besides the chain and the sensor. */
export type JoinCheck = "human" | "access" | "payouts" | "verifier";

/** World proof-of-human for this build: on, off, not known yet, or the read
 *  failed. "error" is never "off": that is how an unverified wallet got a
 *  stake button on a World-on build. */
export type HumanLane = "on" | "off" | "loading" | "error";

/** The closed-beta gate for this wallet. "passed" covers the admin, an
 *  approved allowlist entry, a World-verified human, and a build with the gate
 *  switched off for the test suite. */
export type GateState = "passed" | "loading" | "error" | "pending" | "not-approved";

/** SPOTTER's document checker for this build. */
export type VerifierState = "available" | "off" | "loading" | "error";

/** Whether a verified win can actually pay on this build (the World ID payout
 *  confirmation, when switched on, has what it needs). */
export type PayoutState = "ready" | "misconfigured" | "loading" | "error";

export type RunSlot =
  | { kind: "playable" }
  | { kind: "in-run" }
  | { kind: "locked"; lock: RunLock }
  | { kind: "closed"; joined: boolean }
  | { kind: "cannot-pay" }
  /** Something the join depends on is still being read. The surface shows a
   *  skeleton: the stake is never offered and then taken back. */
  | { kind: "checking" };

export interface RunSlotInput {
  phase: PoolPhase;
  /** A cancelled run takes no new players; its players take their stake back. */
  cancelled?: boolean;
  canPay: boolean;
  joined: boolean;
  address: string | null;
  /** From wearableJoinBlock, unchanged. */
  joinBlock: JoinBlock;
  /** World proof-of-human for this build. */
  worldLane: HumanLane;
  humanVerified: boolean;
  /** The closed-beta gate for this wallet. */
  gate: GateState;
  /** True when the run's proof floor is an upload (document or photo), which
   *  only SPOTTER's document checker can verify. */
  needsDocumentVerifier: boolean;
  verifier: VerifierState;
  payouts: PayoutState;
  /** Label of the player's paired device, for the cannot-measure copy. */
  deviceLabel: string | null;
}

/** Upload-floor runs need SPOTTER's document checker; the same predicate
 *  lib/pool-visibility.ts hides them by. */
export function needsDocumentVerifier(goalSpec: string): boolean {
  return proofPolicyOf(goalSpec).floor !== "wearable";
}

const CHECKING: RunSlot = { kind: "checking" };
function locked(lock: RunLock): RunSlot {
  return { kind: "locked", lock };
}

/**
 * Order encodes what is most useful to say:
 *  1. A closed run is closed; a run that cannot pay is never offered.
 *  2. Already in: the stake is spent and nothing should stand in front of it.
 *  3. Build-wide limits every player hits alike: the document checker is off
 *     for an upload run, or payouts cannot be confirmed on this build.
 *  4. Nobody signed in.
 *  5. The device can never measure this goal (a hardware fact, not a delay).
 *  6. The provider is down (clears on its own).
 *  7. Not proven human (World on).
 *  8. Not on the closed-beta list.
 *  9. No sensor, then sensor not checked this visit.
 * Any of those reads still loading holds the slot on "checking", and one that
 * failed locks it with a retry. Neither ever falls through to "playable".
 */
export function runSlotOf(input: RunSlotInput): RunSlot {
  if (input.phase !== "live" || input.cancelled === true) {
    return { kind: "closed", joined: input.joined };
  }
  if (!input.canPay) return { kind: "cannot-pay" };
  if (input.joined) return { kind: "in-run" };

  if (input.needsDocumentVerifier) {
    if (input.verifier === "off") return locked({ kind: "verifier-off" });
    if (input.verifier === "loading") return CHECKING;
    if (input.verifier === "error") return locked({ kind: "check-failed", check: "verifier" });
  }
  if (input.payouts === "misconfigured") return locked({ kind: "payouts-paused" });
  if (input.payouts === "loading") return CHECKING;
  if (input.payouts === "error") return locked({ kind: "check-failed", check: "payouts" });

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

  if (input.worldLane === "loading") return CHECKING;
  if (input.worldLane === "error") return locked({ kind: "check-failed", check: "human" });
  if (input.worldLane === "on" && !input.humanVerified) {
    return { kind: "locked", lock: { kind: "not-human" } };
  }

  if (input.gate === "loading") return CHECKING;
  if (input.gate === "error") return locked({ kind: "check-failed", check: "access" });
  if (input.gate === "pending") return locked({ kind: "not-approved", pending: true });
  if (input.gate === "not-approved") return locked({ kind: "not-approved", pending: false });

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
  /** Read the failed check again, in place. */
  | { kind: "retry"; label: string }
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
    case "not-approved":
      return lock.pending
        ? {
            title: "You are on the waitlist",
            detail:
              "The beta is invite-only for now. Your request is in, and this run opens for you the moment it is approved. Nothing has been charged.",
            fix: { kind: "link", label: "See my request", href: `/character?next=${next}` },
            tone: "wait",
          }
        : {
            title: "Get into the beta to enter",
            detail:
              "The beta is invite-only for now, and this wallet is not on the list yet. Ask for a spot and this run opens for you once you are in. Nothing has been charged.",
            fix: { kind: "link", label: "Get in", href: `/character?next=${next}` },
            tone: "fixable",
          };
    case "verifier-off":
      return {
        title: "I cannot check uploads right now",
        detail:
          "This run is scored on a record you upload, and my document checker is paused on this build. I am not taking stakes I cannot check. It opens again when the checker is back. Nothing has been charged.",
        fix: { kind: "none" },
        tone: "wait",
      };
    case "payouts-paused":
      return {
        title: "Payouts are paused on this build",
        detail:
          "Winners confirm with World ID before I pay, and that step is not set up here right now. I am not taking stakes that could not pay out. Nothing has been charged.",
        fix: { kind: "none" },
        tone: "wait",
      };
    case "check-failed":
      return {
        title: CHECK_FAILED_TITLE[lock.check],
        detail:
          "It did not answer, so I am holding the stake instead of guessing. Nothing has been charged.",
        fix: { kind: "retry", label: "Check again" },
        tone: "fixable",
      };
  }
}

const CHECK_FAILED_TITLE: Record<JoinCheck, string> = {
  human: "I could not check your World ID just now",
  access: "I could not check the beta list just now",
  payouts: "I could not check how payouts run here just now",
  verifier: "I could not check my document checker just now",
};

// ------------------------------------------------------------ the lobby list

export interface LobbyRow {
  pool: PoolInfo;
  phase: PoolPhase;
  slot: RunSlot;
  highlighted: boolean;
}

export interface LobbyInput {
  pools: readonly PoolInfo[];
  asOfSeconds: bigint;
  verifier: VerifierState;
  payouts: PayoutState;
  gate: GateState;
  /** Pool ids (decimal strings) this wallet has entered. */
  joined: ReadonlySet<string>;
  /** A run to put first and mark (the challenge link's run). */
  highlightId: string | null;
  address: string | null;
  providerDown: string | null;
  viewerMetrics: readonly WearableMetric[] | null;
  capabilityPending: boolean;
  needsDevice: boolean;
  worldLane: HumanLane;
  humanVerified: boolean;
  deviceLabel: string | null;
}

export interface Lobby {
  /** The highlighted run, when there is one and it is readable. */
  highlighted: LobbyRow | null;
  /** Runs this wallet is in and still playing. */
  mine: LobbyRow[];
  /** Live runs this wallet can enter or is locked out of, playable first. */
  open: LobbyRow[];
  /** Ended runs, most recent first. */
  closed: LobbyRow[];
}

/**
 * The lobby, decided once. Same visibility rules the V3 board had: a run that
 * can never pay is not offered, private dares stay off the public board,
 * document runs hide while their verifier is off, and cancelled empty pools
 * are noise.
 *
 * The challenge link's own run is exempt from every one of those filters: the
 * invitee came for that run, so it always shows, and when it cannot be entered
 * it shows its lock (verifier off, cannot pay, closed) instead of vanishing.
 */
export function buildLobby(input: LobbyInput): Lobby {
  const isHighlight = (p: PoolInfo): boolean => p.id.toString() === input.highlightId;
  const highlight = input.pools.filter(isHighlight);
  const payable = input.pools.filter(
    (p) => !isHighlight(p) && poolCanPay(p) && p.initiative !== "challenge",
  );
  const { visible } = hideDocumentPools(payable, input.verifier === "available");
  const shown = [...highlight, ...hideEmptyCancelledPools(visible)];

  const rows: LobbyRow[] = shown.map((pool) => {
    const id = pool.id.toString();
    const joined = input.joined.has(id);
    const phase = poolPhase(pool, input.asOfSeconds);
    const joinBlock = wearableJoinBlock({
      goalSpec: pool.goalSpec,
      address: input.address,
      joined,
      providerDown: input.providerDown,
      viewerMetrics: input.viewerMetrics,
      capabilityPending: input.capabilityPending,
      needsDevice: input.needsDevice,
    });
    return {
      pool,
      phase,
      highlighted: id === input.highlightId,
      slot: runSlotOf({
        phase,
        cancelled: pool.cancelled,
        canPay: poolCanPay(pool),
        joined,
        address: input.address,
        joinBlock,
        worldLane: input.worldLane,
        humanVerified: input.humanVerified,
        gate: input.gate,
        needsDocumentVerifier: needsDocumentVerifier(pool.goalSpec),
        verifier: input.verifier,
        payouts: input.payouts,
        deviceLabel: input.deviceLabel,
      }),
    };
  });

  const byUrgency = (a: LobbyRow, b: LobbyRow): number => {
    const rank = slotRank(a.slot) - slotRank(b.slot);
    if (rank !== 0) return rank;
    if (a.pool.periodEnd === b.pool.periodEnd) return 0;
    return a.pool.periodEnd < b.pool.periodEnd ? -1 : 1;
  };

  const highlighted = rows.find((r) => r.highlighted) ?? null;
  const rest = rows.filter((r) => !r.highlighted);
  return {
    highlighted,
    mine: rest.filter((r) => r.slot.kind === "in-run").sort(byUrgency),
    open: rest
      .filter(
        (r) =>
          r.slot.kind === "playable" ||
          r.slot.kind === "locked" ||
          r.slot.kind === "checking",
      )
      .sort(byUrgency),
    closed: rest
      .filter((r) => r.slot.kind === "closed")
      .sort((a, b) => (a.pool.periodEnd > b.pool.periodEnd ? -1 : 1)),
  };
}

/** True when some run is locked only on the one-tap sensor check, so the
 *  lobby shows one button instead of a lock per row. */
export function lobbyNeedsSensorCheck(lobby: Lobby): boolean {
  return [lobby.highlighted, ...lobby.open]
    .filter((r): r is LobbyRow => r !== null)
    .some((r) => r.slot.kind === "locked" && r.slot.lock.kind === "sensor-unchecked");
}

/** Lobby order: what you can act on first. */
export function slotRank(slot: RunSlot): number {
  switch (slot.kind) {
    case "in-run":
      return 0;
    case "playable":
      return 1;
    case "locked":
    case "checking":
      return 2;
    case "closed":
      return slot.joined ? 3 : 4;
    case "cannot-pay":
      return 5;
  }
}
