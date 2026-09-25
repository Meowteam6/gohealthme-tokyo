"use client";

import { useQuery } from "@tanstack/react-query";

export interface ProofStatus {
  document: { available: boolean; reason: string; mocked?: boolean };
  wearable: { available: boolean };
}

export const PROOF_STATUS_QUERY_KEY = ["proof-status"] as const;

export async function fetchProofStatus(): Promise<ProofStatus> {
  const res = await fetch("/api/proof/status");
  if (!res.ok) throw new Error(`proof status responded ${res.status}`);
  return (await res.json()) as ProofStatus;
}

/**
 * The document checker as the join needs it: known available, known off,
 * still loading, or the read failed. The join holds the stake on the last two
 * (lib/game/join-checks.ts verifierStateOf) instead of guessing.
 */
export function useDocumentProofQuery(): {
  available: boolean | undefined;
  isError: boolean;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: PROOF_STATUS_QUERY_KEY,
    queryFn: fetchProofStatus,
    staleTime: 60_000,
  });
  return {
    available: query.data?.document.available,
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}

/**
 * True only once the server has said documents can be verified. Until the
 * answer arrives it is false: a brief flicker of a hidden pool is cheaper than
 * offering one nobody can be verified on.
 */
export function useDocumentProofAvailable(): boolean {
  const query = useQuery({
    queryKey: PROOF_STATUS_QUERY_KEY,
    queryFn: fetchProofStatus,
    staleTime: 60_000,
  });
  return query.data?.document.available === true;
}
