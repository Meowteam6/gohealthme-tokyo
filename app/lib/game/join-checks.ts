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
 * Whether a dare can be created right now. Every dare the create form makes
 * is an upload-proof run (CreateChallenge encodeGoal), so with the document
 * checker off it would fund a reward nobody can ever be verified on. Checked
 * before the form, and again on submit, never after the deposit.
 */
export type CreateBlock =
  | { kind: "ok" }
  | { kind: "checking" }
  | { kind: "retry"; title: string }
  | { kind: "paused"; title: string; detail: string };

export function challengeCreateBlock(
  verifier: VerifierState,
  payouts: PayoutState,
): CreateBlock {
  if (verifier === "off") {
    return {
      kind: "paused",
      title: "Challenges are paused for now",
      detail:
        "A challenge is proven with an upload, and my document checker is paused on this build. I am not letting you put money on a goal I cannot check. Wearable runs still work, and nothing has been charged.",
    };
  }
  if (payouts === "misconfigured") {
    return {
      kind: "paused",
      title: "Challenges are paused for now",
      detail:
        "Winners confirm with World ID before I pay, and that step is not set up here right now. I am not letting you fund a reward that could not pay out. Nothing has been charged.",
    };
  }
  if (verifier === "error") return { kind: "retry", title: "I could not check my document checker just now" };
  if (payouts === "error") return { kind: "retry", title: "I could not check how payouts run here just now" };
  if (verifier === "loading" || payouts === "loading") return { kind: "checking" };
  return { kind: "ok" };
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
