"use client";

// The landing's and the lobby's chain reads for the open runs: every pool (the
// same ["pools"] query and shape useLobby reads, so the two share one cache),
// how many players are in each live run, and the commitment fee. Browser-side,
// like the lobby: the public RPC answers these reads directly.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ContractNotConfiguredError,
  fetchCommitmentFeeBps,
  fetchPools,
  getArcPublicClient,
  getHealthPoolsAddress,
  healthPoolsAbi,
  type PoolInfo,
} from "@/lib/contract";
import { poolPhase } from "@/lib/pool-lifecycle";
import { openLandingRuns, pickFeaturedRun, type OpenRun } from "@/lib/game/landing";

/** The ["pools"] query, identical in key and shape to useLobby's. */
export function usePoolsQuery() {
  return useQuery({
    queryKey: ["pools"],
    queryFn: async () => ({
      pools: await fetchPools(),
      asOfSeconds: BigInt(Math.floor(Date.now() / 1000)),
    }),
    refetchInterval: 45_000,
  });
}

async function fetchPlayerCounts(ids: readonly bigint[]): Promise<Map<string, number>> {
  const address = getHealthPoolsAddress();
  if (address === null) throw new ContractNotConfiguredError();
  const client = getArcPublicClient();
  const counts = await Promise.all(
    ids.map((id) =>
      client.readContract({ address, abi: healthPoolsAbi, functionName: "participantCount", args: [id] }),
    ),
  );
  return new Map(ids.map((id, i) => [id.toString(), Number(counts[i])]));
}

/** Players in each live pool, read in one batch. Null entries while loading. */
export function usePlayerCounts(pools: readonly PoolInfo[] | undefined, asOfSeconds: bigint | undefined) {
  const ids = useMemo(
    () =>
      pools === undefined || asOfSeconds === undefined
        ? []
        : pools.filter((p) => poolPhase(p, asOfSeconds) === "live").map((p) => p.id),
    [pools, asOfSeconds],
  );
  return useQuery({
    queryKey: ["player-counts", ids.map(String).join(",")],
    queryFn: () => fetchPlayerCounts(ids),
    enabled: ids.length > 0,
    refetchInterval: 45_000,
    retry: 1,
  });
}

export type OpenRunsStatus = "loading" | "error" | "not-configured" | "ready";

export interface OpenRunsView {
  status: OpenRunsStatus;
  runs: OpenRun[];
  featured: OpenRun | null;
  /** commitmentFeeBps; null while loading or when the read failed. */
  feeBps: number | null;
  /** True once every live run's player count has read. */
  countsReady: boolean;
  retry: () => void;
}

export function useOpenRuns(): OpenRunsView {
  const poolsQuery = usePoolsQuery();
  const pools = poolsQuery.data?.pools;
  const asOf = poolsQuery.data?.asOfSeconds;
  const countsQuery = usePlayerCounts(pools, asOf);
  const feeQuery = useQuery({
    queryKey: ["commitment-fee-bps"],
    queryFn: fetchCommitmentFeeBps,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const runs = useMemo(
    () =>
      pools === undefined || asOf === undefined
        ? []
        : openLandingRuns(pools, asOf, countsQuery.data ?? new Map()),
    [pools, asOf, countsQuery.data],
  );

  const status: OpenRunsStatus =
    poolsQuery.error instanceof ContractNotConfiguredError
      ? "not-configured"
      : poolsQuery.isError
        ? "error"
        : pools === undefined
          ? "loading"
          : "ready";

  // Hold the hero on its skeleton until the counts and the fee land, so it
  // never features one run and then swaps to another, or states a sentence
  // and then rewrites it with figures.
  const countsReady = runs.length === 0 || countsQuery.isSuccess || countsQuery.isError;
  const feeSettled = feeQuery.isSuccess || feeQuery.isError;

  return {
    status: status === "ready" && !(countsReady && feeSettled) ? "loading" : status,
    runs,
    featured: countsReady ? pickFeaturedRun(runs) : null,
    feeBps: feeQuery.data ?? null,
    countsReady,
    retry: () => {
      void poolsQuery.refetch();
      void countsQuery.refetch();
      void feeQuery.refetch();
    },
  };
}
