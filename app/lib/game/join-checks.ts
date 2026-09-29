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
 * Last, the creator themself (`creator`, optional): a list player or an admin
 * on a build where a hit is confirmed with World ID could never stake in the
 * challenge they are about to fund (collectNeedsWorldOf, the lobby's
 * "world-to-collect" lock), and the create moves their extra BEFORE their own
 * stake. So the form says so first, with World ID as the fix, and holds while
 * that answer is still being read.
 */
export type CreateBlock =
  | { kind: "ok" }
  | { kind: "checking" }
  | { kind: "retry"; title: string }
  | { kind: "paused"; title: string; detail: string }
  | {
      kind: "needs-world";
      title: string;
      detail: string;
      fix: { label: string; href: string };
    };

/** Where the create form sends a creator to add World ID, and back. */
const CREATE_PATH = "/challenge/new";

export function challengeCreateBlock(
  verifier: VerifierState,
  payouts: PayoutState,
  money: { state: MoneyInState; reason: string | null },
  creator?: { collectNeedsWorld: boolean; checking: boolean },
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
  if (
    verifier === "loading" ||
    payouts === "loading" ||
    money.state === "loading" ||
    creator?.checking === true
  ) {
    return { kind: "checking" };
  }
  if (creator?.collectNeedsWorld === true) {
    return {
      kind: "needs-world",
      title: "Hits here are confirmed with World ID",
      detail:
        "Before I pay a hit here, the player confirms it with World ID, and you got in through the list without it. Your own stake could not go in, so I am not letting you put money into a new challenge yet. Add World ID once and you can start one. Nothing has been charged.",
      fix: {
        label: "Add World ID",
        href: `/character?step=human&next=${encodeURIComponent(CREATE_PATH)}`,
      },
    };
  }
  return { kind: "ok" };
}

/**
 * True when this player could lose a stake but never collect a hit: they are
 * a proven human through the list (or an admin) on a World-on build, and a
 * hit here is confirmed with World ID before it pays (WORLD_APPROVAL_MODE=
 * world). A miss is recorded without any confirmation, so without World ID
 * the stake could only go one way. The join says so before the stake, with
 * World ID as the fix (lib/game/lobby.ts "world-to-collect").
 *
 * Only where the list path newly opened the join (World on, 2026-09-30); a
 * mocked confirmation anyone can give, an off one, or a mode still being read
 * (the join already holds on that) never trips it.
 */
export function collectNeedsWorldOf(i: {
  worldLane: LaneAvailability | "loading";
  approvalMode: ApprovalModeView;
  human: HumanStatus | null;
  humanProof: HumanProof | null;
}): boolean {
  return (
    i.worldLane === "on" &&
    i.approvalMode === "world" &&
    i.human === "verified" &&
    i.humanProof !== "world"
  );
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
