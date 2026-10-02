"use client";

// The join's non-chain reads, gathered once for the lobby, the run page and
// the dare link: World proof-of-human, the closed-beta gate, SPOTTER's
// document checker, the World ID payout confirmation and the pre-launch
// kill switches (new money paused). The mapping to lock states is
// lib/game/join-checks.ts; the decision is runSlotOf.

import { useCallback } from "react";
import { useApprovalProbe } from "@/components/game/ApprovalNote";
import {
  accessGateDisabled,
  gateStateOf,
  payoutStateOf,
  verifierStateOf,
  type ApprovalModeView,
} from "@/lib/game/join-checks";
import type {
  GateState,
  HumanLane,
  MoneyInState,
  PayoutState,
  VerifierState,
} from "@/lib/game/lobby";
import type { CharacterView } from "@/lib/game/useCharacter";
import { useSwitches } from "@/lib/game/useSwitches";
import { useDocumentProofQuery } from "@/lib/useProofStatus";

export interface JoinChecks {
  worldLane: HumanLane;
  humanVerified: boolean;
  gate: GateState;
  verifier: VerifierState;
  payouts: PayoutState;
  approvalMode: ApprovalModeView;
  /** Whether new money may go in on this build (KILL_BASE_MONEY_IN). */
  moneyIn: MoneyInState;
  /** The operator's note for a pause, or null. */
  switchReason: string | null;
  /** Read every check again (the "Check again" fix on a failed one). */
  retry: () => void;
}

export function useJoinChecks(view: CharacterView): JoinChecks {
  const approval = useApprovalProbe();
  const proof = useDocumentProofQuery();
  const switches = useSwitches();

  const gate = gateStateOf({
    gateDisabled: accessGateDisabled(),
    gate: view.gate,
    gateLoading: view.gateLoading,
    address: view.address,
    access: {
      status: view.access.status,
      loading: view.access.loading,
      error: view.access.error,
    },
  });

  const { refresh } = view;
  const { refetch: refetchApproval } = approval;
  const { refetch: refetchProof } = proof;
  const { refetch: refetchSwitches } = switches;
  const retry = useCallback(() => {
    refresh();
    refetchApproval();
    refetchProof();
    refetchSwitches();
  }, [refresh, refetchApproval, refetchProof, refetchSwitches]);

  // A World-on build where the human answer is still being read (World's own
  // status, or the list read that can also prove it): hold the stake on a
  // skeleton instead of flashing "prove you are one human" at a list player.
  const worldLane: HumanLane =
    view.worldLane === "on" && view.character?.human === "unknown" ? "loading" : view.worldLane;

  return {
    worldLane,
    humanVerified: view.character?.human === "verified",
    gate,
    verifier: verifierStateOf(proof),
    payouts: payoutStateOf(approval.mode),
    approvalMode: approval.mode,
    moneyIn: switches.moneyIn,
    switchReason: switches.reason,
    retry,
  };
}
