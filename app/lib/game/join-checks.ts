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
