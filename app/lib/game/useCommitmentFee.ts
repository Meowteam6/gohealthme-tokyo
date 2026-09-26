"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchCommitmentFeeBps } from "@/lib/contract";

/** commitmentFeeBps from chain: a number once read, null while loading or
 *  when the read failed (screens then state no figure that depends on it). */
export function useCommitmentFee(enabled = true): number | null {
  const query = useQuery({
    queryKey: ["commitment-fee-bps"],
    queryFn: fetchCommitmentFeeBps,
    enabled,
    staleTime: 5 * 60_000,
  });
  return query.data ?? null;
}
