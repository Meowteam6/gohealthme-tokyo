"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchCommitmentFeeBps } from "@/lib/contract";

/** commitmentFeeBps from chain. `bps` is null while loading or when the read
 *  failed; screens then state no figure that depends on it. */
export function useCommitmentFee(enabled = true): { bps: number | null; loading: boolean } {
  const query = useQuery({
    queryKey: ["commitment-fee-bps"],
    queryFn: fetchCommitmentFeeBps,
    enabled,
    staleTime: 5 * 60_000,
  });
  return { bps: query.data ?? null, loading: enabled && query.isLoading };
}
