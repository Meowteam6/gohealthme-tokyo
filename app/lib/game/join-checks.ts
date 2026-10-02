// The reads a join depends on, besides the chain and the sensor, mapped to the
// states runSlotOf decides on (lib/game/lobby.ts). Pure and node-tested; the
// hook that gathers them is lib/game/useJoinChecks.ts.
//
// The rule every mapper here follows: a read that has not answered is
// "loading" (the stake is held on a skeleton), and a read that failed is
// "error" (the stake is held behind a retry). Neither ever maps to the
// permissive answer. Both staking surfaces (the run page and the dare link)
// and the lobby read these same four states, so they cannot disagree.

import type { ApprovalModeAnswer, LaneAvailability } from "@/lib/game/lanes";
import type {
  GateState,
  PayoutState,
  VerifierState,
} from "@/lib/game/lobby";
import type { AccessStatus } from "@/lib/useAccess";
import type { HumanProof, HumanStatus } from "@/lib/game/character";
import { challengeCreatePausedDetail, type MoneyInState } from "@/lib/switches";

/**
 * The closed-beta gate is off only for the Playwright suite
 * (playwright.config.ts). The same flag AccessGate and the server's isAllowed
 * read, so the three agree. Never set on a deployed environment.
 */
export function accessGateDisabled(): boolean {
  return process.env.NEXT_PUBLIC_ACCESS_GATE_DISABLED === "1";
}

export interface GateInputs {
  gateDisabled: boolean;
  /** gatePassed() from lib/game/character.ts. */
  gate: boolean;
  /** CharacterView.gateLoading. */
  gateLoading: boolean;
  address: string | null;
  access: { status: AccessStatus; loading: boolean; error: boolean };
}

/**
 * Where this wallet stands on the closed-beta gate. /c/<token> is a public
 * path, so AccessGate never runs there: this is what keeps an unapproved
 * wallet from staking into a dare it then cannot open.
 */
export function gateStateOf(i: GateInputs): GateState {
  if (i.gateDisabled || i.gate) return "passed";
  // No wallet: the sign-in lock answers first, nothing to read yet.
  if (i.address === null) return "passed";
  if (i.gateLoading || i.access.loading) return "loading";
  if (i.access.error) return "error";
  if (i.access.status === "pending") return "pending";
  return "not-approved";
}

/** SPOTTER's document checker, from the /api/proof/status query. */
export function verifierStateOf(q: {
  available: boolean | undefined;
  isError: boolean;
}): VerifierState {
  if (q.available !== undefined) return q.available ? "available" : "off";
  return q.isError ? "error" : "loading";
}

/** What the approval-mode probe answered, including "not yet" and "failed". */
export type ApprovalModeView = ApprovalModeAnswer | "loading" | "error";

/** The approval probe (lib/game/useLaneProbe.ts) to a mode. A route that is
 *  missing or reports itself unconfigured (404/501/503) means the step is not
 *  part of this build: off. An answer with no usable mode is an error. */
export function approvalModeOf(probe: {
  lane: LaneAvailability | "loading";
  value: ApprovalModeAnswer | null;
}): ApprovalModeView {
  if (probe.lane === "loading") return "loading";
  if (probe.lane === "off") return "off";
  if (probe.lane === "error" || probe.value === null) return "error";
  return probe.value;
}

/**
 * Whether a challenge can be created right now. Checked before the form, and
 * again on submit, never after the deposit. The document checker and the
 * payout rule come first (a challenge nobody could be checked or paid on);
 * then new money (KILL_BASE_MONEY_IN): a new challenge is new money, and its
 * creator's own stake could not go in while the pause holds. The create
 * preflight (/api/challenges/health) refuses on the same switch, so a flip
 * between page load and submit still stops before any money moves.
 *
 * Nothing about the creator themself stops a create (Andre, 2026-10-02, "Pay
 * on the verdict"): a list player or an admin is paid on the verdict, so
 * their own stake can always follow their extra. The "needs-world" block that
 * sent them to World ID first is retired.
 */
export type CreateBlock =
  | { kind: "ok" }
  | { kind: "checking" }
  | { kind: "retry"; title: string }
  | { kind: "paused"; title: string; detail: string };

export function challengeCreateBlock(
  verifier: VerifierState,
  payouts: PayoutState,
  money: { state: MoneyInState; reason: string | null },
): CreateBlock {
  if (verifier === "off") {
    return {
      kind: "paused",
      title: "Challenges are paused for now",
      detail:
        "A challenge is proven with an upload, and my document checker is paused on this build. I am not letting you put money on a goal I cannot check. Wearable challenges still work, and nothing has been charged.",
    };
  }
  if (payouts === "misconfigured") {
    return {
      kind: "paused",
      title: "Challenges are paused for now",
      detail:
        "Players who hit confirm with World ID before the contract pays, and that step is not set up here right now. I am not letting you put money on a challenge that could not pay out. Nothing has been charged.",
    };
  }
  if (money.state === "paused") {
    return {
      kind: "paused",
      title: "Challenges are paused for now",
      detail: challengeCreatePausedDetail(money.reason, "has been"),
    };
  }
  if (verifier === "error") return { kind: "retry", title: "I could not check my document checker just now" };
  if (payouts === "error") return { kind: "retry", title: "I could not check how payouts work here just now" };
  if (money.state === "error") return { kind: "retry", title: "I could not check whether stakes are open just now" };
  if (verifier === "loading" || payouts === "loading" || money.state === "loading") {
    return { kind: "checking" };
  }
  return { kind: "ok" };
}

/**
 * Retired (Andre, 2026-10-02, "Pay on the verdict"): always false. It named a
 * list player or an admin on a build where a hit was confirmed with World ID,
 * who could lose a stake but never collect a hit. SPOTTER now pays them on
 * the verdict (lib/server/agent/approval.ts payoutConfirmFor), so nobody
 * needs World ID to collect. Kept only until its last callers drop it
 * (lib/game/useJoinChecks.ts, and the collectNeedsWorld field PoolDetail and
 * ChallengeAccept still pass to runSlotOf, which ignores it).
 *
 * @deprecated Nobody needs World ID to collect; delete with its callers.
 */
export function collectNeedsWorldOf(input: {
  worldLane: LaneAvailability | "loading";
  approvalMode: ApprovalModeView;
  human: HumanStatus | null;
  humanProof: HumanProof | null;
}): boolean {
  void input;
  return false;
}

/** How a player's hit is released: a World ID confirm, or SPOTTER pays it on
 *  the wearable verdict with no extra step. */
export type PayoutPath = "world" | "verdict";

/**
 * The client mirror of the server's payoutConfirmFor (Andre, 2026-10-02,
 * "Pay on the verdict"). A World-verified player confirms each payout with
 * World ID wherever the confirmation is switched on; a list player or an
 * admin is paid on the verdict, whatever the build; with the confirmation off
 * everyone is. A wallet that is not proven human reads "world", never the
 * verdict, though the join never lets it stake. Null while the mode is still
 * being read or its read failed: copy waits rather than guessing.
 */
export function payoutPathOf(i: {
  approvalMode: ApprovalModeView;
  humanProof: HumanProof | null;
}): PayoutPath | null {
  if (i.approvalMode === "loading" || i.approvalMode === "error") return null;
  if (i.approvalMode === "off") return "verdict";
  if (i.humanProof === "list" || i.humanProof === "admin") return "verdict";
  return "world";
}

/** Whether a verified win can pay on this build. */
export function payoutStateOf(mode: ApprovalModeView): PayoutState {
  switch (mode) {
    case "off":
    case "mock":
    case "world":
      return "ready";
    case "misconfigured":
      return "misconfigured";
    case "loading":
      return "loading";
    case "error":
      return "error";
  }
}
