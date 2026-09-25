"use client";

// The join's non-chain reads, gathered once for the lobby, the run page and
// the dare link: World proof-of-human, the closed-beta gate, SPOTTER's
// document checker and the World ID payout confirmation. The mapping to lock
// states is lib/game/join-checks.ts; the decision is runSlotOf.

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
  PayoutState,
  VerifierState,
} from "@/lib/game/lobby";
import type { CharacterView } from "@/lib/game/useCharacter";
import { useDocumentProofQuery } from "@/lib/useProofStatus";

export interface JoinChecks {
  worldLane: HumanLane;
  humanVerified: boolean;
  gate: GateState;
  verifier: VerifierState;
  payouts: PayoutState;
  approvalMode: ApprovalModeView;
  /** Read every check again (the "Check again" fix on a failed one). */
  retry: () => void;
}

export function useJoinChecks(view: CharacterView): JoinChecks {
  const approval = useApprovalProbe();
  const proof = useDocumentProofQuery();

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
  const retry = useCallback(() => {
    refresh();
    refetchApproval();
    refetchProof();
  }, [refresh, refetchApproval, refetchProof]);

  return {
    worldLane: view.worldLane,
    humanVerified: view.character?.human === "verified",
    gate,
    verifier: verifierStateOf(proof),
    payouts: payoutStateOf(approval.mode),
    approvalMode: approval.mode,
    retry,
  };
}
